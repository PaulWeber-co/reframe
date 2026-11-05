#!/usr/bin/env python3
"""Measure room brightness with the webcam, keep nothing.

Every REFRAME_AMBIENT_INTERVAL seconds (in the dark REFRAME_AMBIENT_DARK_INTERVAL)
a few frames are read at 16×12 grey pixels, the median of the last one is the
brightness, and the pixels are discarded at once: no image is ever written. The
exposure is fixed first, otherwise the camera's automatic exposure would
brighten a dark room until it looks like daylight. The webcam LED lights for
about a second per measurement.

Only numbers leave this module, in <run dir>/ambient.json: the dashboard
switches to the night clock in a dark room, and the host agent sets the
backlight from them. While the dashboard's host-state.json says "camera":
false (screen dark or off, or the features that need the reading switched
off) the camera stays off and its LED never lights.

It runs inside reframe_host.py when a camera exists, or by itself:
  reframe_ambient.py           measure in a loop
  reframe_ambient.py --once    one measurement, printed as JSON
"""
import glob
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

CAMERA = os.environ.get("REFRAME_CAMERA_DEVICE", "/dev/video0")
DATA_DIR = Path(os.environ.get("REFRAME_DATA_DIR", "/data"))
RUN_DIR = Path(os.environ.get("REFRAME_RUN_DIR", "/run/reframe"))
HOST_STATE = DATA_DIR / "host-state.json"
INTERVAL = max(10, int(os.environ.get("REFRAME_AMBIENT_INTERVAL", "45")))
DARK_INTERVAL = max(INTERVAL, int(os.environ.get("REFRAME_AMBIENT_DARK_INTERVAL", "120")))
# Fixed exposure in 100 µs units (UVC exposure_time_absolute) and gain
EXPOSURE = os.environ.get("REFRAME_CAMERA_EXPOSURE", "156")
GAIN = os.environ.get("REFRAME_CAMERA_GAIN", "0")
FRAMES = 4  # the first frames after switching the camera on are too dark
DARK_ON = max(0, min(254, int(os.environ.get("REFRAME_AMBIENT_DARK_ON", "16"))))
DARK_OFF = max(DARK_ON + 1, min(255, int(os.environ.get("REFRAME_AMBIENT_DARK_OFF", "25"))))
PIXEL_COUNT = 16 * 12


def log(message):
    print(f"reframe-ambient: {message}", file=sys.stderr, flush=True)


def camera_present():
    """A camera exists, and measuring was not switched off (REFRAME_AMBIENT=off)."""
    if os.environ.get("REFRAME_AMBIENT", "auto").lower() in ("off", "0", "no"):
        return False
    return Path(CAMERA).exists() or bool(glob.glob("/dev/video*"))


def camera_wanted(host_state=HOST_STATE):
    """False only when the dashboard explicitly switched the camera off; a
    missing or broken file keeps the sensor running."""
    try:
        state = json.loads(Path(host_state).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return True
    return not (isinstance(state, dict) and state.get("camera") is False)


def lock_exposure():
    """Manual exposure and fixed gain, best effort: control names differ
    between kernels (auto_exposure / exposure_auto) and cameras."""
    v4l2 = shutil.which("v4l2-ctl")
    if not v4l2:
        return
    for controls in (
        f"auto_exposure=1,exposure_time_absolute={EXPOSURE}",
        f"exposure_auto=1,exposure_absolute={EXPOSURE}",
        f"gain={GAIN}",
        "white_balance_automatic=0",
    ):
        subprocess.run([v4l2, "-d", CAMERA, f"--set-ctrl={controls}"], stdin=subprocess.DEVNULL, capture_output=True, timeout=5, check=False)


def median_level(raw):
    """The last 16×12 grey frame of ffmpeg's raw output → median brightness 0 … 255."""
    if len(raw) < PIXEL_COUNT or len(raw) % PIXEL_COUNT:
        raise RuntimeError("the webcam returned no complete brightness frame")
    return int(statistics.median(raw[-PIXEL_COUNT:]))


def measure_camera():
    lock_exposure()
    result = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
            "-f", "video4linux2", "-video_size", "640x480", "-i", CAMERA, "-frames:v", str(FRAMES),
            "-vf", "scale=16:12:flags=area,format=gray", "-pix_fmt", "gray",
            "-f", "rawvideo", "pipe:1",
        ],
        check=True, capture_output=True, timeout=15,
    )
    level = median_level(result.stdout)
    del result  # the pixels go right away
    return level


class Sensor:
    def __init__(self, measure=measure_camera, run_dir=RUN_DIR, host_state=HOST_STATE):
        self.measure = measure
        self.run_dir = Path(run_dir)
        self.host_state = host_state
        self.dark = False

    def write_state(self, state):
        self.run_dir.mkdir(parents=True, exist_ok=True)
        target = self.run_dir / "ambient.json"
        fd, temporary = tempfile.mkstemp(prefix="ambient.", dir=self.run_dir, text=True)
        try:
            os.fchmod(fd, 0o644)
            with os.fdopen(fd, "w", encoding="utf-8") as file:
                json.dump(state, file, separators=(",", ":"))
                file.write("\n")
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def unavailable(self, paused=False):
        return {
            "available": False, "paused": paused, "level": None, "ambientPercent": None,
            "dark": self.dark, "capturedAt": round(time.time() * 1000), "intervalSeconds": DARK_INTERVAL,
        }

    def next_dark(self, level):
        """Dark from DARK_ON down, light again from DARK_OFF up, nothing in between (no flicker)."""
        if self.dark and level >= DARK_OFF:
            return False
        if not self.dark and level <= DARK_ON:
            return True
        return self.dark

    def measure_once(self):
        try:
            level = self.measure()
            self.dark = self.next_dark(level)
            state = {
                "available": True, "paused": False, "level": level, "ambientPercent": round(level * 100 / 255),
                "dark": self.dark, "capturedAt": round(time.time() * 1000), "intervalSeconds": DARK_INTERVAL if self.dark else INTERVAL,
            }
        except (OSError, RuntimeError, subprocess.SubprocessError, ValueError) as error:
            log(str(error))
            state = self.unavailable()
        try:
            self.write_state(state)
        except OSError as error:
            log(str(error))
        return state

    def run(self, stop):
        """Checks the dashboard's wish every second, measures when one is due:
        a screen that wakes up gets a fresh reading at once, not after 45 s."""
        next_measurement = 0.0
        paused = False
        while not stop.is_set():
            if not camera_wanted(self.host_state):
                if not paused:
                    try:
                        self.write_state(self.unavailable(paused=True))
                    except OSError as error:
                        log(str(error))
                    paused = True
                next_measurement = 0.0
            else:
                paused = False
                if time.monotonic() >= next_measurement:
                    self.measure_once()
                    next_measurement = time.monotonic() + (DARK_INTERVAL if self.dark else INTERVAL)
            stop.wait(1)


def run(stop):
    Sensor().run(stop)


if __name__ == "__main__":
    if "--once" in sys.argv:
        json.dump(Sensor().measure_once(), sys.stdout, indent=2)
        print()
    else:
        event = threading.Event()
        run(event)
