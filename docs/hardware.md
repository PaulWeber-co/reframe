# Hardware: driving a laptop's screen from a container

The dashboard itself runs anywhere. Showing it on the laptop's own display from
a container is the part that depends on your machine, and it is the part that
has not yet been verified on real hardware. This page says what the setup does,
what can go wrong, and how to find out in ten minutes.

## What the kiosk container does

`docker compose --profile kiosk up` starts a container that

1. runs `seatd`, a small seat manager that lets a program take over the display
   and the input devices without a login session,
2. runs `cage`, a Wayland compositor that shows exactly one program full screen,
3. runs Chromium inside it, pointed at the dashboard on `127.0.0.1`,
4. sets the backlight through `/sys/class/backlight` and, if there is a webcam
   and you leave it on, measures the room brightness with it.

For that it needs the display (`/dev/dri`), the input devices (`/dev/input`), a
free virtual console, the backlight and the camera. That is why it is
**privileged** and mounts `/dev`. Nothing in it listens on a network port, and
it only ever loads the dashboard (see [SECURITY.md](../SECURITY.md)).

## What the laptop must be

- **Linux** with an Intel, AMD or (open driver) NVIDIA GPU that has a KMS
  driver. Most laptops from the last ten years qualify. The Raspberry Pi 5 does
  too; boards without KMS do not.
- **Not showing a desktop.** If a login screen or desktop session owns the
  display, the kiosk cannot take it. Use a server install, or stop the display
  manager (`sudo systemctl disable --now gdm lightdm sddm`).
- **Docker** with Compose v2, and `avahi-daemon` if you want `reframe.local`.
- umbrelOS qualifies, since it has no desktop at all.

## Ten-minute check

```sh
docker compose --profile kiosk up -d
docker compose logs -f kiosk
```

| You see | It means |
| --- | --- |
| the dashboard on the screen | it works; open `/control` on a phone and set the schedule |
| `reframe-kiosk: waiting for the dashboard` for more than a minute | the server container is not up: `docker compose logs reframe` |
| `seatd` / `cage` errors about `drm`, `card0`, `Permission denied` | the display is taken by another session, or the GPU has no KMS driver: `ls /dev/dri`, `sudo systemctl status display-manager` |
| `cage` errors about `libseat` | no free virtual console: `chvt 7` once on the machine, or run from a console login rather than SSH only |
| the screen stays black but the log is clean | the backlight: `ls /sys/class/backlight`, then `cat /sys/class/backlight/*/brightness` |
| the video in the background is jerky | no hardware decoding: check `ls /dev/dri/renderD*`; or switch videos off in the control center for a still picture |
| no brightness change | the machine has no backlight device (a desktop with a monitor), or `REFRAME_BACKLIGHT_PATH` points elsewhere |

The control center (`/control`, "System" section) shows what the agent reports:
kiosk running or not, brightness, power source, webcam.

## The webcam sensor

Off if there is no camera. When on, it takes a few frames now and then at 16 by
12 grey pixels, keeps the median in memory, and writes one number to
`/run/reframe/ambient.json`. No picture is stored or sent anywhere. The
camera's LED lights for about a second per measurement, and the camera is not
used at all while the screen is dark or the "dark room" and "automatic
brightness" options are off. Switch it off completely with `REFRAME_AMBIENT=off`.

## Sound for AirPlay

The `airplay` profile plays to the machine's default ALSA device. A desktop
sound server (PipeWire, PulseAudio) holding the sound card blocks it. On a
server install it just works, with the laptop's speakers or headphone jack.

## Please report what you find

Open an issue (title "Hardware report: <machine>") with the machine and GPU
(`lspci | grep -i vga`), the OS, what worked and what did not, and the output of
`docker compose logs kiosk`. A line each for "display", "brightness", "webcam",
"sound" is plenty.
