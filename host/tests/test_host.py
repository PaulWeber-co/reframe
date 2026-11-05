"""Tests for the host helpers: python3 -m unittest discover -s host/tests"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import reframe_ambient as ambient  # noqa: E402
import reframe_host as host  # noqa: E402
import reframe_media as media  # noqa: E402
import reframe_services as services  # noqa: E402


class TempDir(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

    def write(self, name, content):
        path = self.dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content if isinstance(content, str) else json.dumps(content))
        return path


class WishTests(unittest.TestCase):
    def test_defaults_and_validation(self):
        self.assertEqual(host.normalize_wish(None), host.DEFAULT_WISH)
        self.assertEqual(host.normalize_wish("nonsense"), host.DEFAULT_WISH)
        wish = host.normalize_wish({"display": "sleep", "kiosk": False, "backlight": 40, "camera": False, "evil": "rm -rf"})
        self.assertEqual(wish, {"display": "sleep", "kiosk": False, "backlight": 40, "camera": False})
        self.assertNotIn("evil", wish)

    def test_bad_values_fall_back(self):
        for backlight in (0, 101, True, "bright", None, 3.5):
            self.assertEqual(host.normalize_wish({"backlight": backlight})["backlight"], "auto", backlight)
        self.assertEqual(host.normalize_wish({"backlight": "off"})["backlight"], "off")
        self.assertEqual(host.normalize_wish({"display": "party"})["display"], "on")
        self.assertEqual(host.normalize_wish({"kiosk": "yes"})["kiosk"], True)

    def test_curve_stays_between_min_and_max(self):
        self.assertEqual(host.curve_percent(0), host.MIN_BACKLIGHT)
        self.assertEqual(host.curve_percent(255), host.MAX_BACKLIGHT)
        values = [host.curve_percent(level) for level in range(0, 256, 15)]
        self.assertEqual(values, sorted(values))


class AmbientReadingTests(TempDir):
    NOW = 1_800_000_000_000

    def reading(self, **extra):
        state = {"available": True, "level": 100, "capturedAt": self.NOW - 10_000, "intervalSeconds": 45, **extra}
        return self.write("ambient.json", state)

    def test_fresh_reading(self):
        self.assertEqual(host.ambient_level(self.reading(), now=self.NOW), 100)

    def test_old_missing_or_broken_readings_do_not_count(self):
        self.assertIsNone(host.ambient_level(self.reading(capturedAt=self.NOW - 200_000), now=self.NOW), "older than two intervals")
        self.assertIsNone(host.ambient_level(self.reading(capturedAt=self.NOW + 60_000), now=self.NOW), "from the future")
        self.assertIsNone(host.ambient_level(self.reading(available=False), now=self.NOW))
        self.assertIsNone(host.ambient_level(self.reading(level=300), now=self.NOW))
        self.assertIsNone(host.ambient_level(self.dir / "missing.json", now=self.NOW))
        self.assertIsNone(host.ambient_level(self.write("broken.json", "{"), now=self.NOW))

    def test_percent_is_used_when_there_is_no_level(self):
        path = self.write("a.json", {"available": True, "ambientPercent": 50, "capturedAt": self.NOW, "intervalSeconds": 45})
        self.assertEqual(host.ambient_level(path, now=self.NOW), 128)


class BacklightTests(TempDir):
    def agent(self, brightness=100, maximum=200):
        device = self.dir / "sys" / "intel_backlight"
        device.mkdir(parents=True)
        (device / "brightness").write_text(f"{brightness}\n")
        (device / "max_brightness").write_text(f"{maximum}\n")
        return host.Agent(host_state=self.dir / "host-state.json", run_dir=self.dir / "run", kiosk=SimpleNamespace(), sysfs=self.dir / "sys", blank=self.dir / "blank"), device

    def test_a_fixed_percentage(self):
        agent, device = self.agent()
        agent.apply_backlight({"backlight": 50})
        self.assertEqual((device / "brightness").read_text().strip(), "100")
        agent.apply_backlight({"backlight": 80})
        self.assertEqual((device / "brightness").read_text().strip(), "160")
        self.assertEqual(agent.backlight_percent, 80)

    def test_off_and_back_on(self):
        agent, device = self.agent()
        (device / "bl_power").write_text("0\n")
        agent.apply_backlight({"backlight": "off"})
        self.assertEqual((device / "brightness").read_text().strip(), "0")
        self.assertEqual((device / "bl_power").read_text().strip(), "4")
        agent.apply_backlight({"backlight": 30})
        self.assertEqual((device / "bl_power").read_text().strip(), "0")
        self.assertEqual((device / "brightness").read_text().strip(), "60")

    def test_automatic_follows_the_room_and_ignores_small_changes(self):
        agent, device = self.agent(brightness=100)
        agent.apply_backlight({"backlight": "auto"})  # no reading yet: the fallback
        self.assertEqual(agent.backlight_percent, host.FALLBACK_BACKLIGHT)
        now = int(time.time() * 1000)
        (self.dir / "run").mkdir()
        (self.dir / "run" / "ambient.json").write_text(json.dumps({"available": True, "level": 255, "capturedAt": now, "intervalSeconds": 45}))
        agent.apply_backlight({"backlight": "auto"})
        self.assertEqual(agent.backlight_percent, host.MAX_BACKLIGHT)
        before = (device / "brightness").read_text()
        (self.dir / "run" / "ambient.json").write_text(json.dumps({"available": True, "level": 254, "capturedAt": now, "intervalSeconds": 45}))
        agent.apply_backlight({"backlight": "auto"})
        self.assertEqual((device / "brightness").read_text(), before, "no flicker for a tiny change")

    def test_a_machine_without_backlight_is_fine(self):
        agent = host.Agent(host_state=self.dir / "x.json", run_dir=self.dir, kiosk=SimpleNamespace(), sysfs=self.dir / "none", blank=self.dir / "blank")
        agent.apply_backlight({"backlight": 50})
        self.assertIsNone(agent.backlight_percent)


class KioskTests(TempDir):
    def script(self, body):
        path = self.write("kiosk.sh", f"#!/bin/sh\n{body}\n")
        path.chmod(path.stat().st_mode | stat.S_IEXEC)
        return str(path)

    def test_start_and_stop(self):
        kiosk = host.Kiosk(self.script("exec sleep 60"))
        self.addCleanup(kiosk.stop)
        self.assertEqual(kiosk.keep_alive(100.0), "starting")
        self.assertTrue(kiosk.running())
        self.assertEqual(kiosk.keep_alive(101.0), "running")
        kiosk.stop()
        self.assertFalse(kiosk.running())
        kiosk.stop()  # stopping twice is fine

    def test_a_crashing_kiosk_is_restarted_with_growing_pauses(self):
        kiosk = host.Kiosk(self.script("exit 3"))
        self.addCleanup(kiosk.stop)
        self.assertEqual(kiosk.keep_alive(0.0), "starting")
        time.sleep(0.3)
        self.assertEqual(kiosk.keep_alive(1.0), "failed", "crashed: wait before the next try")
        self.assertEqual(kiosk.crashes, 1)
        self.assertEqual(kiosk.keep_alive(3.0), "failed")
        self.assertEqual(kiosk.keep_alive(6.5), "starting", "after the first pause of five seconds")
        time.sleep(0.3)
        kiosk.keep_alive(7.0)
        self.assertEqual(kiosk.crashes, 2)
        self.assertGreaterEqual(kiosk.retry_at, 7.0 + host.RESTART_BACKOFF[1] - 0.001)

    def test_agent_follows_the_wish_and_writes_the_status(self):
        script = self.script("exec sleep 60")
        agent = host.Agent(host_state=self.dir / "host-state.json", run_dir=self.dir / "run", kiosk=host.Kiosk(script), sysfs=self.dir / "none", blank=self.dir / "blank")
        self.addCleanup(agent.shutdown)
        self.write("blank", "0\n")  # the framebuffer switch exists on a real machine
        self.write("host-state.json", {"display": "on", "kiosk": True, "backlight": 50, "camera": True})
        agent.step(now=10.0)
        self.assertTrue(agent.kiosk.running())
        status = json.loads((self.dir / "run" / "status.json").read_text())
        self.assertEqual(status["kiosk"], "starting")
        self.assertEqual(status["wish"]["backlight"], 50)
        self.assertIn("checkedAt", status)

        self.write("host-state.json", {"display": "off", "kiosk": False, "backlight": "off", "camera": False})
        agent.step(now=11.0)
        self.assertFalse(agent.kiosk.running())
        self.assertEqual(json.loads((self.dir / "run" / "status.json").read_text())["kiosk"], "stopped")
        self.assertEqual((self.dir / "blank").read_text().strip(), "4", "the panel is blanked while the kiosk is off")

    def test_a_missing_file_means_everything_on(self):
        agent = host.Agent(host_state=self.dir / "nothing.json", run_dir=self.dir / "run", kiosk=host.Kiosk(self.script("exec sleep 60")), sysfs=self.dir / "none", blank=self.dir / "blank")
        self.addCleanup(agent.shutdown)
        agent.step(now=1.0)
        self.assertTrue(agent.kiosk.running())


class AmbientSensorTests(TempDir):
    def sensor(self, levels):
        readings = iter(levels)
        return ambient.Sensor(measure=lambda: next(readings), run_dir=self.dir / "run", host_state=self.dir / "host-state.json")

    def test_dark_with_hysteresis(self):
        sensor = self.sensor([100, 10, 20, 30, 15])
        states = [sensor.measure_once() for _ in range(5)]
        self.assertEqual([state["dark"] for state in states], [False, True, True, False, True])
        self.assertEqual(states[1]["intervalSeconds"], ambient.DARK_INTERVAL)
        self.assertEqual(states[0]["ambientPercent"], 39)
        written = json.loads((self.dir / "run" / "ambient.json").read_text())
        self.assertEqual(written["level"], 15)
        self.assertEqual(set(written), {"available", "paused", "level", "ambientPercent", "dark", "capturedAt", "intervalSeconds"}, "numbers only, never a picture")

    def test_a_failing_camera_is_reported_not_raised(self):
        def broken():
            raise RuntimeError("no camera")

        sensor = ambient.Sensor(measure=broken, run_dir=self.dir / "run", host_state=self.dir / "x.json")
        state = sensor.measure_once()
        self.assertFalse(state["available"])
        self.assertFalse(json.loads((self.dir / "run" / "ambient.json").read_text())["available"])

    def test_the_dashboard_can_switch_the_camera_off(self):
        self.assertTrue(ambient.camera_wanted(self.dir / "missing.json"))
        self.assertTrue(ambient.camera_wanted(self.write("a.json", "{")))
        self.assertTrue(ambient.camera_wanted(self.write("b.json", {"camera": True})))
        self.assertFalse(ambient.camera_wanted(self.write("c.json", {"camera": False})))

    def test_median_of_the_last_frame(self):
        frame = bytes([10] * 100 + [200] * 92)  # 192 pixels, the median is 10
        self.assertEqual(ambient.median_level(bytes(192) + frame), 10)
        with self.assertRaises(RuntimeError):
            ambient.median_level(b"short")


class ServicesTests(unittest.TestCase):
    def test_sizes_and_percentages(self):
        self.assertEqual(services.parse_size("21.5MiB / 15.4GiB"), round(21.5 * 1024 ** 2))
        self.assertEqual(services.parse_size("1.5GB"), 1_500_000_000)
        self.assertEqual(services.parse_size("512B"), 512)
        self.assertIsNone(services.parse_size("--"))
        self.assertIsNone(services.parse_size("1 parsec"))
        self.assertEqual(services.parse_percent("153.20%", cpus=4), 38.3)
        self.assertIsNone(services.parse_percent("--"))

    def fake_docker(self, containers, stats, missing=False):
        def run(command, **kwargs):
            sub = command[1]
            if sub == "ps":
                out = "\n".join(c["Id"] for c in containers)
            elif sub == "stats":
                out = "\n".join(json.dumps(row) for row in stats) + "\nnot json"
            elif sub == "inspect":
                err = "Error: No such object: gone" if missing else ""
                return SimpleNamespace(stdout=json.dumps(containers), stderr=err, returncode=1 if missing else 0, args=command)
            else:
                raise AssertionError(command)
            return SimpleNamespace(stdout=out, stderr="", returncode=0)

        return run

    def container(self, name, project, status="running", health=None):
        return {
            "Id": f"id-{name}", "Name": f"/{name}", "RestartCount": 0,
            "State": {"Status": status, "StartedAt": "2026-10-01T10:00:00Z", "ExitCode": 0, **({"Health": {"Status": health}} if health else {})},
            "Config": {"Labels": {"com.docker.compose.project": project, "com.docker.compose.service": name}},
            "HostConfig": {"RestartPolicy": {"Name": "always"}},
        }

    def test_collect_joins_inspect_and_stats(self):
        run = self.fake_docker(
            [self.container("web", "shop", health="healthy"), self.container("db", "shop", status="exited")],
            [{"ID": "id-web", "CPUPerc": "50%", "MemUsage": "100MiB / 8GiB"}],
        )
        web, db = services.collect(run=run)
        self.assertEqual((web["project"], web["service"], web["state"], web["health"]), ("shop", "web", "running", "healthy"))
        self.assertEqual(web["memBytes"], 100 * 1024 ** 2)
        self.assertIsNotNone(web["cpuPercent"])
        self.assertIsNone(db["startedAt"], "only running containers have a start time")
        self.assertIsNone(db["cpuPercent"])
        self.assertTrue(all(c["scope"] == "host" for c in (web, db)))

    def test_a_container_that_vanished_is_not_an_error(self):
        run = self.fake_docker([self.container("web", "shop")], [], missing=True)
        self.assertEqual(len(services.collect(run=run)), 1)

    def test_no_containers_and_no_docker(self):
        self.assertEqual(services.collect(run=self.fake_docker([], [])), [])

        def no_docker(command, **kwargs):
            raise FileNotFoundError("docker")

        state = services.sample(run=no_docker)
        self.assertEqual(state["containers"], [])
        self.assertFalse(state["sources"]["host"]["ok"])
        self.assertIn("docker", state["sources"]["host"]["error"])

    def test_the_sample_has_what_the_dashboard_reads(self):
        state = services.sample(run=self.fake_docker([self.container("web", "shop")], []))
        self.assertEqual(set(state), {"capturedAt", "intervalSeconds", "sources", "containers"})
        self.assertTrue(state["sources"]["host"]["ok"])


class MediaTests(TempDir):
    def test_names(self):
        self.assertEqual(media.slug("My Trip 2024!"), "my-trip-2024")
        self.assertEqual(media.slug("  ../../etc  "), "etc")
        self.assertEqual(media.slug("Küste"), "k-ste")
        self.assertEqual(media.slug("x" * 80), "x" * 40)
        self.assertEqual(media.slug("!!!"), "")

    def test_add_converts_and_makes_a_poster(self):
        source = self.write("Flight 1.MOV", "video")
        calls = []
        target = media.add("evening", source, media=self.dir / "media", run=lambda command, **kw: calls.append(command))
        self.assertEqual(target.name, "evening-flight-1.mp4")
        self.assertEqual(len(calls), 2)
        convert, poster = calls
        self.assertIn("-an", convert, "no sound")
        self.assertIn("fps=24", convert[convert.index("-vf") + 1])
        self.assertEqual(poster[-1], str(target.with_suffix(".jpg")))
        self.assertTrue(media.CLIP.match(target.name))

    def test_add_refuses_bad_input(self):
        with self.assertRaises(SystemExit):
            media.add("noon", self.write("a.mov", "x"), media=self.dir, run=lambda *a, **k: None)
        with self.assertRaises(SystemExit):
            media.add("day", self.dir / "missing.mov", media=self.dir, run=lambda *a, **k: None)
        with self.assertRaises(SystemExit):
            media.add("day", self.write("b.mov", "x"), name="!!!", media=self.dir, run=lambda *a, **k: None)

    def test_posters_only_for_clips_without_one(self):
        self.write("media/day-a.mp4", "x")
        self.write("media/day-b.mp4", "x")
        self.write("media/day-b.jpg", "x")
        self.write("media/holiday.mp4", "x")
        calls = []
        made = media.posters(media=self.dir / "media", run=lambda command, **kw: calls.append(command))
        self.assertEqual([path.name for path in made], ["day-a.jpg"])
        self.assertEqual(len(calls), 1)
        self.assertEqual(media.clips(self.dir / "media"), ["day-a", "day-b"])


if __name__ == "__main__":
    unittest.main()
