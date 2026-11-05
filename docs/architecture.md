# How it fits together

```
 phone / tablet / browser ──┐
                            ▼
┌─ container "reframe" ─────────────────────────────┐   unprivileged, no devices
│  server (Node.js, no dependencies)                │
│   hub ─ widgets ─ weather, calendar, to-dos, …    │──► the internet (weather, wiki,
│   http ─ pages, /api, /api/events (live updates)  │    calendars, TomTom, Immich, …)
│   control ─ decides what the screen shows         │
│   config ─ env > /data/config.json > defaults     │
└──────────────┬──────────────────────▲─────────────┘
   host-state.json                     │  status.json, ambient.json,
   (what the screen should do)         │  services.json, shairport pipe
┌──────────────▼──────────────────────┴─────────────┐
│ container "kiosk" (profile kiosk)   few rights    │   same network namespace, so the
│  host agent: starts/stops the kiosk, dims the     │   page loads from 127.0.0.1
│  screen, runs the webcam sensor if it can         │   (kiosk-full: privileged, with seatd)
│  cage + Chromium ──► /dev/dri, the laptop display │
└────────────────────────────────────────────────────┘
 container "airplay" (shairport-sync) ──► metadata pipe + the sound card
 container "services" (Docker collector) ──► services.json
```

## Why three kinds of container

The part that talks to the network and keeps your tokens has no business
touching hardware, and the part that touches hardware has no business holding
tokens. So the server runs as an unprivileged user without devices, and the
kiosk agent only ever loads `127.0.0.1` and reads a small JSON file. They never
call each other: they only exchange small files. The kiosk container gets only
the graphics card and the input devices; since it cannot write to `/sys`, it
reports a "software" brightness that the kiosk page applies to itself (with the
real backlight mounted, or in `kiosk-full`, it sets the hardware backlight).

| File | Written by | Read by | Holds |
| --- | --- | --- | --- |
| `/data/host-state.json` | server | host agent, webcam sensor | `display`, `kiosk`, `backlight`, `camera` (validated on every read) |
| `/run/reframe/status.json` | host agent | server | what actually runs, brightness |
| `/run/reframe/ambient.json` | webcam sensor | host agent, server | one brightness number, "dark", a time stamp |
| `/run/reframe/services.json` | Docker collector | server | names, states, CPU, memory of containers |
| `/run/shairport-sync/metadata` | shairport-sync | server | what AirPlay is playing |

A missing or broken file always means "keep the sensible default": a dashboard
without the host agent still works, and an agent without the dashboard shows
the screen.

## The server

- **hub** runs every widget on its own schedule, keeps its latest result,
  remembers the last good data when a source fails and retries with growing
  pauses, and pushes changes to the browsers over Server-Sent Events.
- **widgets** (`app/server/widgets`) turn a source into plain data. They do not
  word anything: texts such as "partly cloudy" travel as keys (`partly_cloudy`)
  and the browser translates them.
- **control** turns settings plus live inputs (schedule, music, a tap, Home
  Assistant presence, power, room brightness) into one display state:
  `on`, `night` (a dim clock), `sleep` (black) or `off`.
- **access** (`app/server/access.js`) checks the host name, makes changes JSON-
  and same-origin-only, and handles the optional PIN.
- **config** (`app/server/config.js`, `settings.js`) is the layered settings
  store behind the setup page.

## The browser

Plain ES modules, no build step, no framework. `app/web/js/app.js` loads the
state, builds a tile per layout entry and keeps them current from the event
stream. Every widget is a pure `render(data)` function that returns HTML, which
makes it testable without a browser. Texts come from `app/web/i18n/<lang>.json`
through `t()`.

## What is deliberately not here

No database, no accounts, no cloud, no analytics, no build chain, no
runtime dependencies in the server. If you want any of those, the seams are the
widget interface and the two JSON files above.
