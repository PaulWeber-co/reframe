#!/usr/bin/env python3
"""Collect the Docker containers of this machine for the "Services" tile.

Docker is asked every REFRAME_SERVICES_INTERVAL seconds; the result goes to
<run dir>/services.json, which the dashboard (server/widgets/services.js)
groups by compose project and shows. On umbrelOS this lists every Umbrel app.

This is the one part of Reframe that needs the Docker socket, which is
root-equivalent, so it is a separate container (compose profile "services")
and the dashboard server itself never gets near it. Only names, states and
resource figures are written, never environment variables, logs or other
container details.

  reframe_services.py          collect in a loop
  reframe_services.py --once   one round, printed as JSON
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DOCKER = os.environ.get("REFRAME_DOCKER", "docker")
RUN_DIR = Path(os.environ.get("REFRAME_RUN_DIR", "/run/reframe"))
OUTPUT_FILE = RUN_DIR / "services.json"
INTERVAL = max(10, int(os.environ.get("REFRAME_SERVICES_INTERVAL", "30")))
TIMEOUT = 25
CPUS = os.cpu_count() or 1

UNITS = {
    "b": 1, "kb": 1000, "mb": 1000 ** 2, "gb": 1000 ** 3, "tb": 1000 ** 4,
    "kib": 1024, "mib": 1024 ** 2, "gib": 1024 ** 3, "tib": 1024 ** 4,
}
SIZE = re.compile(r"^\s*([\d.]+)\s*([a-zA-Z]*)")


def parse_size(text):
    """'21.5MiB / 15.4GiB' -> bytes of the first part, or None."""
    match = SIZE.match(str(text).split("/")[0])
    if not match:
        return None
    factor = UNITS.get(match.group(2).lower() or "b")
    return round(float(match.group(1)) * factor) if factor else None


def parse_percent(text, cpus=CPUS):
    """'153.20%' (Docker: 100 % per core) -> share of the whole machine."""
    try:
        return round(float(str(text).strip().rstrip("%")) / cpus, 1)
    except ValueError:
        return None


def docker(*args, run=subprocess.run):
    result = run([DOCKER, *args], check=True, capture_output=True, text=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL)
    return result.stdout


def inspect(ids, run=subprocess.run):
    """docker inspect for many ids. A container that went away since "ps"
    (an app restarting) makes docker fail with "No such object", but it still
    prints the others: those count, the missing one is simply not there."""
    result = run([DOCKER, "inspect", *ids], capture_output=True, text=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL)
    try:
        found = json.loads(result.stdout or "null")
    except ValueError:
        found = None
    if isinstance(found, list) and (result.returncode == 0 or "No such object" in result.stderr):
        return found
    raise subprocess.CalledProcessError(result.returncode, result.args, result.stdout, result.stderr)


def collect(run=subprocess.run):
    """All containers as plain dictionaries."""
    ids = docker("ps", "--all", "--quiet", "--no-trunc", run=run).split()
    if not ids:
        return []
    stats = {}
    for line in docker("stats", "--no-stream", "--no-trunc", "--format", "{{json .}}", run=run).splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        stats[row.get("ID", "")] = row
    containers = []
    for info in inspect(ids, run=run):
        state = info.get("State") or {}
        labels = (info.get("Config") or {}).get("Labels") or {}
        name = str(info.get("Name", "")).lstrip("/")
        row = stats.get(info.get("Id", ""), {})
        running = state.get("Status") == "running"
        containers.append({
            "scope": "host",
            "name": name,
            "project": labels.get("com.docker.compose.project") or name,
            "service": labels.get("com.docker.compose.service") or name,
            "state": state.get("Status", "unknown"),
            "health": (state.get("Health") or {}).get("Status"),
            "exitCode": state.get("ExitCode"),
            "restartPolicy": ((info.get("HostConfig") or {}).get("RestartPolicy") or {}).get("Name") or "no",
            "restartCount": info.get("RestartCount", 0),
            "startedAt": state.get("StartedAt") if running else None,
            "cpuPercent": parse_percent(row.get("CPUPerc", "")) if running and row else None,
            "memBytes": parse_size(row.get("MemUsage", "")) if running and row else None,
        })
    return containers


def sample(run=subprocess.run):
    try:
        containers, source = collect(run=run), {"ok": True, "error": None}
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        message = str(getattr(error, "stderr", None) or error).strip()
        containers, source = [], {"ok": False, "error": message.splitlines()[-1][:200] if message else "error"}
    return {"capturedAt": round(time.time() * 1000), "intervalSeconds": INTERVAL, "sources": {"host": source}, "containers": containers}


def write_state(state, target=OUTPUT_FILE):
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f"{target.stem}.", dir=target.parent, text=True)
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(state, file, separators=(",", ":"))
            file.write("\n")
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    if "--once" in sys.argv:
        json.dump(sample(), sys.stdout, indent=2)
        print()
        return
    reported = None
    while True:
        started = time.monotonic()
        state = sample()
        try:
            write_state(state)
        except OSError as error:
            print(f"reframe-services: {error}", file=sys.stderr, flush=True)
        # A problem is logged once, not every interval
        error = state["sources"]["host"]["error"]
        if error != reported:
            print(f"reframe-services: {error or 'Docker is reachable'}", file=sys.stderr, flush=True)
            reported = error
        time.sleep(max(1, INTERVAL - (time.monotonic() - started)))


if __name__ == "__main__":
    main()
