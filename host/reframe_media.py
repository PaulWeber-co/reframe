#!/usr/bin/env python3
"""Prepare your own video clips for the wall.

Reframe plays clips from the media folder behind the tiles. A clip is a file
named <scene>-<name>.mp4, with a still picture <scene>-<name>.jpg next to it
(shown when videos are switched off). The scenes are the times of day:

  morning   first light, until a few hours after sunrise
  day       the rest of the day
  evening   around sunset
  late      after sunset and through the night

  reframe_media.py add <scene> <file> [name]   convert a clip and add it
  reframe_media.py posters                     make the missing still pictures
  reframe_media.py list                        what is in the media folder

"add" turns any video into what a wall display can play without effort: 1080p,
24 frames per second, a limited bit rate and no sound, so a laptop stays cool
and quiet. Your original is not touched. Drone footage, a time-lapse of your
street, a screen saver: whatever you are allowed to show. Reframe ships no clips.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

MEDIA_DIR = Path(os.environ.get("REFRAME_MEDIA_DIR", "/media"))
SCENES = ("morning", "day", "evening", "late")
CLIP = re.compile(r"^(morning|day|evening|late)-([a-z0-9][a-z0-9-]*)\.mp4$")
NAME = re.compile(r"[^a-z0-9]+")


def slug(text):
    """'My Trip 2024!' → 'my-trip-2024'"""
    return NAME.sub("-", text.lower()).strip("-")[:40]


def clips(media=MEDIA_DIR):
    return sorted(path.stem for path in Path(media).glob("*.mp4") if CLIP.match(path.name))


def convert_command(source, target):
    return [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-an", "-vf", "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=24,format=yuv420p",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-maxrate", "6M", "-bufsize", "12M",
        "-movflags", "+faststart", str(target),
    ]


def poster_command(video, target):
    return ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-ss", "1", "-i", str(video), "-frames:v", "1", "-q:v", "3", str(target)]


def add(scene, source, name=None, media=MEDIA_DIR, run=subprocess.run):
    if scene not in SCENES:
        raise SystemExit(f"scene must be one of {', '.join(SCENES)}")
    source = Path(source)
    if not source.is_file():
        raise SystemExit(f"{source}: no such file")
    name = slug(name or source.stem)
    if not name:
        raise SystemExit("the name has no letters or digits")
    media = Path(media)
    media.mkdir(parents=True, exist_ok=True)
    target = media / f"{scene}-{name}.mp4"
    run(convert_command(source, target), check=True)
    run(poster_command(target, target.with_suffix(".jpg")), check=True)
    return target


def posters(media=MEDIA_DIR, run=subprocess.run):
    made = []
    for stem in clips(media):
        video = Path(media) / f"{stem}.mp4"
        poster = video.with_suffix(".jpg")
        if not poster.exists():
            run(poster_command(video, poster), check=True)
            made.append(poster)
    return made


def main(argv):
    if len(argv) >= 4 and argv[1] == "add":
        target = add(argv[2], argv[3], argv[4] if len(argv) > 4 else None)
        print(f"added {target.name}")
    elif len(argv) == 2 and argv[1] == "posters":
        made = posters()
        print(f"made {len(made)} still picture(s)")
    elif len(argv) == 2 and argv[1] == "list":
        for stem in clips():
            print(stem)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
