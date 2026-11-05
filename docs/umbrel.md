# Reframe on umbrelOS

Reframe ships as a **community app store**: this repository is the store. The
two apps are built from the same image as the Docker setup.

| App | What it is | For |
| --- | --- | --- |
| **Reframe** (`reframe-dashboard`) | the dashboard, behind Umbrel's login | any browser, a tablet, a TV |
| **Reframe Display** (`reframe-display`) | the dashboard plus the kiosk on the machine's own screen, brightness and an AirPlay speaker | the old laptop that runs Umbrel |

## Install

1. In umbrelOS open the **App Store**, open the menu at the top right and choose
   **Community App Stores**.
2. Add `https://github.com/PaulWeber-co/reframe`.
3. Install **Reframe** or **Reframe Display** from the new store.

Reframe opens in Umbrel's window and, as an Umbrel app, is protected by
Umbrel's own login. Open its **Settings** (the link in the control center) to
choose your place and connect your calendar.

## Your own clips

The media folder of an app is `~/umbrel/app-data/reframe-display/data/media`
(or `reframe-dashboard`). Put your original there and convert it with the tool in
the app's container; the folder is mounted there as `/media`:

```sh
docker exec reframe-display_web_1 reframe-media add day /media/coast.mov
```

See [media/README.md](../media/README.md) for what the scenes mean.

## How the display app gets the screen without a privileged container

It does not need one. umbrelOS has a **GPU permission** for apps: with
`permissions: [GPU]` in `umbrel-app.yml`, umbrelOS adds `/dev/dri` (and the
matching groups) to the app's containers itself. The kiosk maps `/dev/input` and
mounts `/run/udev` read-only, and runs `cage` without a seat daemon. No
`privileged`, no extra capabilities. [hardware.md](hardware.md) explains the
details and what has and has not been verified.

## What has and has not been verified

Checked against the umbrelOS source (the 2.0 code in the
[umbrelOS container fork](https://github.com/PaulWeber-co/umbrel2.0docker)):

- a community store is a repository with `umbrel-app-store.yml` at the top and
  `<app-id>/umbrel-app.yml` one level down; the app id has to start with the
  store id (`reframe`), which it does,
- when an app is installed, the **whole app folder** is copied into the app's
  data folder (with `rsync`, minus `.gitkeep` files), so `shairport-sync.conf`
  of the Display app does land next to `docker-compose.yml` and the empty
  folders under `data/` are created,
- umbrelOS names containers `<app-id>_<service>_1`, which is what `APP_HOST` of
  the proxy uses,
- the manifest fields pass umbrelOS's own validation (`modules/apps/schema.ts`).

**Not tried:** installing the apps on a running umbrelOS, the GPU permission
handing the card to the kiosk, and the kiosk taking over a real screen.

## Why the official store is a different question

The official [Umbrel App Store](https://github.com/getumbrel/umbrel-apps) has
packaging rules (in the repository's `.agents/skills/umbrel-package-app`). The
ones that matter here:

| Rule | Reframe |
| --- | --- |
| Do not use `privileged: true`, broad host mounts, device mounts or extra capabilities without strong justification | the dashboard app uses none. The display app needs the input devices and `/run/udev`, and its AirPlay container `/dev/snd`, the D-Bus and avahi sockets: these are host and device mounts |
| Do not map `/dev/dri` yourself, use the `GPU` permission | the display app uses the permission |
| Do not mount the Docker socket | not mounted in the Umbrel apps (only the optional `services` profile of the plain Docker setup uses it) |
| `network_mode: host` only for LAN discovery | the AirPlay container does, for multicast; the web service does not |
| Pin every image as `name:tag@sha256:<digest>`, public, multi-arch, no `latest`, no `build:` | `scripts/pin-umbrel-image.sh <version>` pins it after a release; the image workflow publishes amd64 and arm64; the GHCR package has to be made public |
| Data below `${APP_DATA_DIR}/data/…`, empty folders committed with `.gitkeep` | done |
| Omit `icon`, use `gallery: []` and `releaseNotes: ""` for a new app | the community store keeps icon and gallery (the community store may use them); strip them in the pull request |

So the plain **Reframe** app is a realistic candidate for the official store
once the image is pinned. **Reframe Display** is a community app: its device and
host mounts, and AirPlay's sockets, are the kind of thing a review asks to
justify, and Umbrel's reviewers decide. Read their current guide before
submitting, the rules change.

## umbrelOS itself in a container

That is a different project and lives in the
[umbrelOS container fork](https://github.com/PaulWeber-co/umbrel2.0docker),
because it contains Umbrel's source code under its own license.
