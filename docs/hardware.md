# Hardware: driving a laptop's screen from a container

The dashboard itself runs anywhere. Showing it on the laptop's own display from
a container is the part that depends on your machine. This page says what the
setup does, what is verified and what is not, and how to find out in ten
minutes.

## Two ways, from least to most rights

| Profile | Rights | What works |
| --- | --- | --- |
| `kiosk` (default) | no privileged mode, no capabilities; only `/dev/dri`, `/dev/input` and the udev database (read-only) | the picture, touch and mouse; brightness by dimming the page; "off" shows black |
| `kiosk-full` | privileged container, a seat daemon, all of `/dev` | everything above, plus the real backlight, powering the panel down, the webcam sensor |

Start with `kiosk`. If it does not show the dashboard on your machine, try
`kiosk-full`. Use one of them, not both.

## How the rights-free variant gets the screen

A container cannot take a screen over the way a desktop session does, but it
does not have to be privileged either. What it needs:

- **The graphics card**, `/dev/dri`. On Linux, the first program that opens the
  card while nobody else is showing anything becomes its "master" and may set
  the screen mode. `cage` (a Wayland compositor that shows exactly one program)
  does that itself, with libseat's *noop* backend: no seat daemon, no virtual
  console. On umbrelOS the GPU permission in the app manifest hands `/dev/dri` to
  the app, so the compose file does not map it.
- **The input devices**, `/dev/input`, for touch screens, mice and keyboards,
  plus `/run/udev` read-only: without the udev database the compositor cannot
  tell what a device is.
- **Nothing else.** Chromium runs with `--no-sandbox` because its sandbox needs
  rights a container does not have; it only ever shows the dashboard on
  `127.0.0.1`.

What a container without privileges **cannot** do is write to `/sys`. So:

- **Brightness** is set in the page: the dashboard darkens itself by what the
  backlight would have been (never darker than 12 percent of full). The panel's
  real backlight stays where it is, so this saves no power. To give the
  container the real backlight, run `scripts/backlight-mount.sh` (see below).
- **Off** cannot power the panel down, so the screen shows black instead. The
  control center says so in its System section. With the real backlight mounted,
  the panel does switch off.
- **The webcam sensor** needs the camera device: add
  `- /dev/video0:/dev/video0` to the `devices` of the `kiosk` service.

## What is verified, and what is not

| | |
| --- | --- |
| The scripts, Chromium's flags, `cage` starting without a seat daemon and showing the dashboard | **verified** on a machine without a screen, with the headless backend (`scripts/kiosk-headless-check.sh`, also run in CI) |
| Taking over a real display through `/dev/dri` | **not verified**: that needs a real graphics card and depends on it |
| Input devices through `/dev/input` and udev | **not verified** |
| The Umbrel GPU permission handing `/dev/dri` to the app | read from umbrelOS's source (`modules/apps/app.ts`, `hardware/gpu.ts`), **not tried** |

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
| `cage` errors about `drm`, `card0`, `Permission denied` or `Device or resource busy` | the display is taken by another session, or the GPU has no KMS driver: `ls /dev/dri`, `sudo systemctl status display-manager`. Try `kiosk-full` |
| `cage` errors about `libseat` or the session | the seat-less start did not work here: try `kiosk-full` |
| the screen stays black but the log is clean | look at the control center: the screen may be on "black", or the software dimming set very dark |
| touch or mouse does nothing | `ls /dev/input`, and check that `/run/udev` exists on the host |
| the video in the background is jerky | no hardware decoding: check `ls /dev/dri/renderD*`; or switch videos off in the control center for a still picture |

The control center (`/control`, "System" section) shows what the agent reports:
kiosk running or not, brightness (and whether it is "software"), power source,
webcam.

## The real backlight, without privileges

```sh
scripts/backlight-mount.sh > compose.override.yaml
docker compose --profile kiosk up -d
```

The script finds the backlight folder of this machine
(`/sys/devices/.../intel_backlight` or similar) and prints a compose override
that mounts it into the container as `/backlight`, outside `/sys` because some
security profiles block writes below it, and sets `REFRAME_BACKLIGHT_PATH`. If
the machine has no backlight (a desktop with a monitor), the script says so.

## Trying the kiosk without a screen

```sh
sudo apt install cage grim     # plus Chromium or Chrome and Node
REFRAME_CHROMIUM=chromium scripts/kiosk-headless-check.sh
```

It starts the demo server, `cage` with the headless backend and Chromium in
kiosk mode, and checks the picture the compositor draws. Useful on a server,
and it is what CI runs.

## The webcam sensor

Off if there is no camera device in the container. When on, it takes a few
frames now and then at 16 by 12 grey pixels, keeps the median in memory, and
writes one number to `/run/reframe/ambient.json`. No picture is stored or sent
anywhere. The camera's LED lights for about a second per measurement, and the
camera is not used at all while the screen is dark or the "dark room" and
"automatic brightness" options are off. Switch it off completely with
`REFRAME_AMBIENT=off`.

## Sound for AirPlay

The `airplay` profile plays to the machine's default ALSA device. A desktop
sound server (PipeWire, PulseAudio) holding the sound card blocks it. On a
server install it just works, with the laptop's speakers or headphone jack.

## Please report what you find

Open an issue (title "Hardware report: <machine>") with the machine and GPU
(`lspci | grep -i vga`), the OS, which profile you used, what worked and what
did not, and the output of `docker compose logs kiosk`. A line each for
"display", "touch or mouse", "brightness", "webcam", "sound" is plenty.
