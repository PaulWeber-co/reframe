# Reframe on umbrelOS

Reframe ships as a **community app store**: this repository is the store. The
two apps are built from the same image as the Docker setup.

| App | What it is | For |
| --- | --- | --- |
| **Reframe** (`reframe-dashboard`) | the dashboard, behind Umbrel's login | any browser, a tablet, a TV |
| **Reframe Display** (`reframe-display`) | the dashboard plus the kiosk on the machine's own screen, brightness, webcam sensor and an AirPlay speaker | the old laptop that runs Umbrel |

## Install

1. In umbrelOS open the **App Store**, open the menu at the top right and choose
   **Community App Stores**.
2. Add `https://github.com/PaulWeber-co/reframe`.
3. Install **Reframe** or **Reframe Display** from the new store.

Reframe opens in Umbrel's window and, as an Umbrel app, is protected by
Umbrel's own login. Open its **Settings** (the link in the control center) to
choose your place and connect your calendar.

## Your own clips

The media folder of the app is `~/umbrel/app-data/reframe-dashboard/media`
(or `reframe-display`). Copy clips there converted as described in
[media/README.md](../media/README.md); the `reframe-media` tool is in the app's
container: `docker exec reframe-display_web_1 reframe-media add day /path/clip.mov`
after copying the original into the media folder (it is mounted as `/media`).

## What has and has not been verified

Written from umbrelOS's app format and the same container setup that the
Docker profiles use, **not yet installed on a real umbrelOS machine**. Things
to look at first if something does not work:

- The kiosk needs a privileged container. Community stores can do that; the
  official Umbrel App Store would probably not accept it for the Display app.
- umbrelOS shows its own text console on a virtual terminal; the kiosk wants a
  free one.
- `shairport-sync.conf` of the Display app is expected to be copied next to
  `docker-compose.yml` into the app's data folder when the app is installed. If
  AirPlay does not start, check that `${APP_DATA_DIR}/shairport-sync.conf` is a
  file, not a folder.
- The images are referenced by version tag. Run
  `scripts/pin-umbrel-image.sh <version>` after a release to pin them by digest,
  which Umbrel's official store wants.

## For the maintainer: getting into the official store

The community store is the quick way. The official
[Umbrel App Store](https://github.com/getumbrel/umbrel-apps) is a pull request
to that repository with the app folder, an icon and gallery images, and the
image pinned by digest (`scripts/pin-umbrel-image.sh`). The plain **Reframe**
app is the candidate; **Reframe Display** needs a privileged container and is
unlikely to pass review. Read their current
[app submission guide](https://github.com/getumbrel/umbrel-apps#-submit-your-app)
first: the checklist changes, and the apps must run on both amd64 and arm64
(the image is built for both).

## umbrelOS itself in a container

That is a different project and lives in the
[umbrelOS container fork](https://github.com/PaulWeber-co/umbrel2.0docker),
because it contains Umbrel's source code under its own license.
