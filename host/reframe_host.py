#!/usr/bin/env python3
"""Carry out what the dashboard decided about the display.

The dashboard server runs without privileges and without access to the
hardware. It decides what the wall display shows (server/control.js) and
writes that wish to <data dir>/host-state.json. This agent, which runs in the
kiosk container, is the only part that acts on it:

  kiosk      start or stop the kiosk browser (reframe-kiosk.sh); while it is
             stopped the panel is switched off as well
  backlight  "auto" follows the room brightness that reframe_ambient measures,
             a number is a fixed percentage, "off" switches the backlight off
  camera     read by reframe_ambient itself: no measurement while it is false

A container without privileges cannot write to /sys, so it can neither set the
backlight nor power the panel down. The agent notices and falls back: the
brightness it would have set goes to the page as "softwareDim" (the kiosk page
darkens itself), and "off" keeps the browser running so the page shows black.

Every value is validated, so the dashboard can never ask for more than these
switches. A missing or broken file means "everything on". What actually runs
goes to <run dir>/status.json, which the control center shows.

  reframe_host.py              the agent (checks the wish every second)
"""
import json
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

DATA_DIR = Path(os.environ.get("REFRAME_DATA_DIR", "/data"))
RUN_DIR = Path(os.environ.get("REFRAME_RUN_DIR", "/run/reframe"))
HOST_STATE = DATA_DIR / "host-state.json"
KIOSK_COMMAND = os.environ.get("REFRAME_KIOSK_COMMAND", str(Path(__file__).with_name("reframe-kiosk.sh")))
FRAMEBUFFER_BLANK = Path(os.environ.get("REFRAME_FRAMEBUFFER_BLANK", "/sys/class/graphics/fb0/blank"))
STATUS_REFRESH_SECONDS = 60
RESTART_BACKOFF = (5, 15, 60)  # seconds between restarts of a crashing kiosk

DEFAULT_WISH = {"display": "on", "kiosk": True, "backlight": "auto", "camera": True}


def env_int(name, default, low, high):
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError:
        value = default
    return max(low, min(high, value))


MIN_BACKLIGHT = env_int("REFRAME_BACKLIGHT_MIN_PERCENT", 8, 1, 100)
MAX_BACKLIGHT = env_int("REFRAME_BACKLIGHT_MAX_PERCENT", 85, MIN_BACKLIGHT, 100)
FALLBACK_BACKLIGHT = env_int("REFRAME_BACKLIGHT_FALLBACK_PERCENT", 50, MIN_BACKLIGHT, MAX_BACKLIGHT)
try:
    GAMMA = max(0.1, min(3.0, float(os.environ.get("REFRAME_BACKLIGHT_GAMMA", "0.65"))))
except ValueError:
    GAMMA = 0.65


def log(message):
    print(f"reframe-host: {message}", file=sys.stderr, flush=True)


def normalize_wish(raw):
    """host-state.json → a wish with only known keys and valid values."""
    wish = dict(DEFAULT_WISH)
    if not isinstance(raw, dict):
        return wish
    if raw.get("display") in ("on", "night", "sleep", "off"):
        wish["display"] = raw["display"]
    for key in ("kiosk", "camera"):
        if isinstance(raw.get(key), bool):
            wish[key] = raw[key]
    backlight = raw.get("backlight")
    if backlight in ("auto", "off"):
        wish["backlight"] = backlight
    elif isinstance(backlight, int) and not isinstance(backlight, bool) and 1 <= backlight <= 100:
        wish["backlight"] = backlight
    return wish


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def ambient_level(path, now=None):
    """The room brightness (0 … 255) while the reading is fresh, else None."""
    state = read_json(path)
    if not isinstance(state, dict) or not state.get("available"):
        return None
    now = time.time() * 1000 if now is None else now
    try:
        captured = float(state["capturedAt"])
        interval = float(state.get("intervalSeconds") or 45)
        level = state.get("level")
        if level is None:
            level = round(float(state["ambientPercent"]) * 255 / 100)
        level = int(level)
    except (KeyError, TypeError, ValueError):
        return None
    if not 0 <= level <= 255 or now - captured > 2 * interval * 1000 or captured > now + 5000:
        return None
    return level


def curve_percent(level):
    """Room brightness 0 … 255 → backlight percent between min and max."""
    return round(MIN_BACKLIGHT + (MAX_BACKLIGHT - MIN_BACKLIGHT) * (level / 255) ** GAMMA)


def backlight_device(sysfs="/sys/class/backlight"):
    configured = os.environ.get("REFRAME_BACKLIGHT_PATH")
    candidates = [Path(configured)] if configured else sorted(Path(sysfs).glob("*"))
    for candidate in candidates:
        if (candidate / "brightness").is_file() and (candidate / "max_brightness").is_file():
            return candidate
    return None


def write_if_different(path, value):
    try:
        if path.read_text().strip() == str(value):
            return False
        path.write_text(f"{value}\n")
        return True
    except FileNotFoundError:
        return False  # this machine has no such switch
    except OSError as error:
        log(f"{path}: {error}")
        return False


class Kiosk:
    """The kiosk browser as a child process: started and stopped on request,
    restarted with a growing pause when it crashes."""

    def __init__(self, command=KIOSK_COMMAND):
        self.command = command
        self.process = None
        self.crashes = 0
        self.retry_at = 0.0

    def running(self):
        return self.process is not None and self.process.poll() is None

    def start(self, now):
        if self.running():
            return
        self.process = subprocess.Popen([self.command], stdin=subprocess.DEVNULL, start_new_session=True)
        self.retry_at = now + 5  # a start that survives five seconds is not a crash

    def stop(self):
        process, self.process = self.process, None
        self.crashes = 0
        if process is None or process.poll() is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=5)
        except (ProcessLookupError, PermissionError):
            pass

    def keep_alive(self, now):
        """Call every round while the kiosk should run: restarts it after a crash."""
        if self.running():
            if now > self.retry_at:
                self.crashes = 0
            return "running"
        if self.process is not None:
            log(f"kiosk ended with code {self.process.poll()}")
            self.process = None
            self.crashes += 1
            self.retry_at = now + RESTART_BACKOFF[min(self.crashes, len(RESTART_BACKOFF)) - 1]
        if now >= self.retry_at:
            self.start(now)
            return "starting"
        return "failed"


class Agent:
    def __init__(self, host_state=HOST_STATE, run_dir=RUN_DIR, kiosk=None, sysfs="/sys/class/backlight", blank=FRAMEBUFFER_BLANK):
        self.host_state = Path(host_state)
        self.run_dir = Path(run_dir)
        self.kiosk = kiosk or Kiosk()
        self.sysfs = sysfs
        self.blank = Path(blank)
        self.applied = None
        self.last_level = None  # the last good room reading, a guess after a wake-up
        self.backlight_percent = None
        self.control = "hardware"  # "software": the page dims itself, see apply_backlight
        self.software_dim = None
        self.power_down = True
        self.kiosk_state = "stopped"
        self.last_status = None
        self.status_written = 0.0

    def can_power_down(self):
        """Can this container switch the panel off (backlight or framebuffer)?"""
        device = backlight_device(self.sysfs)
        if device is not None and os.access(device / "brightness", os.W_OK):
            return True
        return os.access(self.blank, os.W_OK)

    def apply_kiosk(self, wish, now):
        # Without a way to power the panel down, "off" would only leave the last
        # picture on a lit screen: keep the browser running, the page shows black
        run = wish["kiosk"] or not self.power_down
        if self.applied is None or self.applied["kiosk"] != run:
            if run:
                write_if_different(self.blank, 0)
                self.kiosk.retry_at = 0.0
            else:
                self.kiosk.stop()
                write_if_different(self.blank, 4)
            log(f"kiosk {'on' if run else 'off'}")
        self.kiosk_state = self.kiosk.keep_alive(now) if run else "stopped"

    def apply_backlight(self, wish):
        level = ambient_level(self.run_dir / "ambient.json")
        if level is not None:
            self.last_level = level
        setting = wish["backlight"]
        percent = None
        if setting != "off":
            percent = curve_percent(self.last_level) if setting == "auto" and self.last_level is not None else FALLBACK_BACKLIGHT if setting == "auto" else setting
        device = backlight_device(self.sysfs)
        if device is None or not os.access(device / "brightness", os.W_OK):
            # No backlight, or a read-only /sys: the page darkens itself. Without a
            # room reading there is nothing to follow, and a made-up 50 percent
            # would leave the wall dim for no reason: then it does not dim
            self.control = "software"
            blind = setting == "auto" and self.last_level is None
            self.software_dim = None if blind else percent
            self.backlight_percent = self.software_dim
            return
        self.control = "hardware"
        self.software_dim = None
        try:
            maximum = int((device / "max_brightness").read_text().strip())
            current = int((device / "brightness").read_text().strip())
        except (OSError, ValueError) as error:
            log(f"backlight: {error}")
            return
        if maximum <= 0:
            return
        power = device / "bl_power"
        target = 0 if percent is None else max(1, round(maximum * percent / 100))
        if power.is_file():
            write_if_different(power, 4 if setting == "off" else 0)
        # Small changes are skipped, so the panel does not flicker between readings
        if target == 0 or current == 0 or abs(current - target) >= max(1, round(maximum * 0.01)):
            if write_if_different(device / "brightness", target):
                current = target
        self.backlight_percent = round(current * 100 / maximum)

    def write_status(self, now):
        status = {
            "wish": self.applied,
            "kiosk": self.kiosk_state,
            "backlightPercent": self.backlight_percent,
            "backlightControl": self.control,
            "softwareDim": self.software_dim,
            "powerDown": self.power_down,
            "ambientLevel": self.last_level,
        }
        if status == self.last_status and now - self.status_written < STATUS_REFRESH_SECONDS:
            return
        self.last_status = status
        self.status_written = now
        try:
            self.run_dir.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix="status.", dir=self.run_dir, text=True)
            try:
                os.fchmod(fd, 0o644)
                with os.fdopen(fd, "w", encoding="utf-8") as file:
                    json.dump({**status, "checkedAt": round(time.time() * 1000)}, file, separators=(",", ":"))
                    file.write("\n")
                os.replace(temporary, self.run_dir / "status.json")
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
        except OSError as error:
            log(f"status: {error}")

    def step(self, now=None):
        now = time.monotonic() if now is None else now
        wish = normalize_wish(read_json(self.host_state))
        self.power_down = self.can_power_down()
        self.apply_kiosk(wish, now)
        self.applied = wish
        self.apply_backlight(wish)
        self.write_status(now)

    def shutdown(self):
        self.kiosk.stop()


def main(argv):
    if len(argv) > 1:
        print(__doc__, file=sys.stderr)
        return 2
    agent = Agent()
    stop = threading.Event()
    for name in (signal.SIGTERM, signal.SIGINT):
        signal.signal(name, lambda *_: stop.set())

    # The webcam sensor runs next to the agent when there is a camera
    try:
        import reframe_ambient

        if reframe_ambient.camera_present():
            threading.Thread(target=reframe_ambient.run, args=(stop,), daemon=True).start()
    except ImportError as error:
        log(f"no ambient sensor: {error}")

    while not stop.is_set():
        try:
            agent.step()
        except Exception as error:  # never die on one bad round
            log(f"error: {error}")
        stop.wait(1)
    agent.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
