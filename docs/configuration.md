# Configuration

Almost everything is set in the browser at **`/setup`** (and the screen,
schedule and tiles at **`/control`**). The values go into `/data/config.json`,
readable by its owner only.

A value is looked up in this order: an **environment variable** of the same
name, then `config.json`, then the default. A setting fixed by an environment
variable shows as locked on the setup page.

## Settings (in the browser, or as environment variables)

| Variable | What | Default |
| --- | --- | --- |
| `REFRAME_LANG` | `en` or `de` | `en` |
| `REFRAME_PLACE`, `REFRAME_LAT`, `REFRAME_LON`, `REFRAME_TIMEZONE` | where the weather is from, and the wall's time zone | none (sample weather), `UTC` |
| `REFRAME_CALENDAR_ICS` | iCal / webcal links, comma separated | none |
| `REFRAME_HA_URL`, `REFRAME_HA_TOKEN`, `REFRAME_HA_ENTITIES`, `REFRAME_HA_CALENDAR_ENTITY` | Home Assistant | none |
| `REFRAME_IMMICH_URL`, `REFRAME_IMMICH_KEY` | Immich | none |
| `REFRAME_TOMTOM_KEY`, `REFRAME_HOME_ADDRESS`, `REFRAME_WORK_ADDRESS`, `REFRAME_COMMUTE_LABEL`, `REFRAME_COMMUTE_DAYS`, `REFRAME_COMMUTE_FROM`, `REFRAME_COMMUTE_TO` | the commute tile | none, weekdays 06:00 to 09:30 |
| `REFRAME_SERVICES_NAMES`, `REFRAME_SERVICES_HIDE` | display names and hidden projects in the Services tile | none |
| `REFRAME_PIN` | PIN for changes from other devices | none |
| `REFRAME_ALLOWED_HOSTS` | extra host names the dashboard may be opened with | home network names and IP addresses work already |

## Only as environment variables

| Variable | What | Default |
| --- | --- | --- |
| `REFRAME_PORT`, `REFRAME_HOST` | where the server listens | `7777`, `0.0.0.0` |
| `REFRAME_DATA_DIR`, `REFRAME_MEDIA_DIR`, `REFRAME_RUN_DIR` | folders | `/data`, `/media`, `/run/reframe` |
| `REFRAME_DEMO` | `1`: sample data everywhere | `0` |
| `REFRAME_DEMO_MUSIC` | `1`: in demo mode a sample piece plays | `0` |
| `REFRAME_GLASS` | starting value of the glass slider, 0 to 100 | `55` |
| `REFRAME_SHAIRPORT_PIPE` | AirPlay metadata pipe | `/run/shairport-sync/metadata` |

The kiosk container reads these (all optional):

| Variable | What | Default |
| --- | --- | --- |
| `REFRAME_BACKLIGHT_MIN_PERCENT`, `REFRAME_BACKLIGHT_MAX_PERCENT`, `REFRAME_BACKLIGHT_GAMMA`, `REFRAME_BACKLIGHT_FALLBACK_PERCENT` | the automatic brightness curve | `8`, `85`, `0.65`, `50` |
| `REFRAME_BACKLIGHT_PATH` | a specific backlight folder; `scripts/backlight-mount.sh` mounts the real one at `/backlight` | the first in `/sys/class/backlight` |
| `REFRAME_AMBIENT` | `off` keeps the webcam sensor off | on, if there is a camera |
| `REFRAME_AMBIENT_INTERVAL`, `REFRAME_AMBIENT_DARK_INTERVAL` | seconds between measurements, in light and in the dark | `45`, `120` |
| `REFRAME_AMBIENT_DARK_ON`, `REFRAME_AMBIENT_DARK_OFF` | grey level 0 to 255 that counts as dark, and as light again | `16`, `25` |
| `REFRAME_CAMERA_DEVICE`, `REFRAME_CAMERA_EXPOSURE`, `REFRAME_CAMERA_GAIN` | which camera, and its fixed exposure and gain | `/dev/video0`, `156`, `0` |

The kiosk script reads:

| Variable | What | Default |
| --- | --- | --- |
| `REFRAME_KIOSK_SEAT` | `noop` (no seat daemon, no privileges) or `seatd` (privileged, `kiosk-full`) | `noop` |
| `REFRAME_KIOSK_URL` | the page the kiosk shows | `http://127.0.0.1:7777/?kiosk=1` |
| `REFRAME_CHROMIUM` | the browser binary | `chromium` |
| `REFRAME_KIOSK_HEADLESS` | `1`: no display, software rendering, for tests | off |

Set them in a `compose.override.yaml` next to `compose.yaml`:

```yaml
services:
  kiosk:
    environment:
      REFRAME_BACKLIGHT_MAX_PERCENT: "60"
      REFRAME_AMBIENT: "off"
```

## The Services tile and the Docker socket

The tile needs a list of your containers, which only the Docker socket can give,
and the socket is root on the machine. So it lives in its own container
(`--profile services`) that has no network and no capabilities, and the
dashboard never touches it. Mounting the socket read-only does not make the
Docker API read-only. If you want a hard limit, run a socket proxy
(for example `tecnativa/docker-socket-proxy` with only `CONTAINERS=1`), give the
services container a network instead of `network_mode: none` and set
`DOCKER_HOST=tcp://<proxy>:2375` on it, or leave the tile off.

## The AirPlay speaker's name

Edit `docker/shairport-sync.conf` (`name = "Reframe"`) and restart the airplay
container. The same file can set a password.

## Where the files are

| What | Where |
| --- | --- |
| Settings | `/data/config.json` |
| Layout, control settings, to-dos | `/data/layout.json`, `control.json`, `todos.json` |
| What the dashboard asks of the display | `/data/host-state.json` |
| What the display agent reports back | `/run/reframe/status.json` |
| Brightness reading of the webcam sensor | `/run/reframe/ambient.json` |
| The container list | `/run/reframe/services.json` |
| Your clips | `./media` (compose) or `${APP_DATA_DIR}/media` (Umbrel) |
