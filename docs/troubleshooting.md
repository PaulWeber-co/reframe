# Troubleshooting

First look: **`docker compose logs reframe`** (on Umbrel: `docker logs reframe-dashboard_web_1`).
A tile that cannot load its data keeps the last good data and shows a small
warning dot; the control center lists every tile with "Live", "Example" or
"Error", and a hover on "Error" shows the message.

## A tile says "Example"

It has no setting yet and shows sample data. Open `/setup` (the "Settings"
link in the control center) and fill in what the tile needs: the weather a
place (use the search), the calendar a link, and so on. Until then the demo
data is on purpose, so a new install is never empty.

## The weather is still "Example"

The place needs coordinates. Use the **search** on the settings page and press
"Use": it fills in name, latitude, longitude and time zone. If the search finds
nothing, the machine has no internet or cannot reach `open-meteo.com`.

## `reframe.local` does not open

The name comes from `avahi-daemon` on the host (Linux) or Bonjour (Windows).
Use the machine's IP address instead (`http://192.168.x.x:7777`). If you open the
dashboard under a name of your own, add it under Settings → Access → *Extra host
names*, or you get "Unknown host name".

## "Locked" / "Please enter the PIN"

Another device needs the PIN you set under Settings → Access; enter it once in
the control center. The wall itself never asks. **Forgot it?** Ask the dashboard
from the machine itself, which needs no PIN:

```sh
docker compose exec reframe curl -fsS -X PUT -H 'content-type: application/json' \
  -d '{"REFRAME_PIN":null}' http://127.0.0.1:7777/api/config
```

(On Umbrel: `docker exec reframe-dashboard_web_1 curl ...` with the same arguments.)
A PIN fixed by an environment variable has to be changed there.

## The calendar is empty

- The link has to be an iCal feed: `webcal://…` or `https://….ics`. In Apple's
  Calendar share the calendar as **Public Calendar** and copy that link.
- Events further away than seven days are not shown.
- The control center shows "Error" with a message when the link does not answer.

## My clips do not play

- The file name is `<scene>-<name>.mp4` with a scene of `morning`, `day`,
  `evening` or `late`: `docker compose run --rm reframe reframe-media list`.
- "Background videos" is switched on in the control center (off shows a still).
- Convert with `reframe-media add`: other formats and frame rates may stutter on
  an old laptop. See [media/README.md](../media/README.md).

## The screen goes dark in the evening

That is the schedule: outside the times in the control center the wall shows a
night clock, black, or nothing, as you chose under "Outside these times". "Always
on" in the Screen section turns the schedule off. A dark room (with the webcam
sensor) or a power cut (the machine runs on battery) can switch it as well; the
control center says why under "Screen: …".

## Nothing shows on the laptop's own screen

See [hardware.md](hardware.md): a ten-minute check, and the difference between
the `kiosk` and `kiosk-full` profiles.

## Update, back up, start over

```sh
git pull && docker compose pull && docker compose up -d     # update
docker run --rm -v reframe_data:/data -v "$PWD":/backup alpine tar czf /backup/reframe-data.tgz -C /data .   # back up
docker compose down && docker volume rm reframe_data         # start over (deletes settings and to-dos)
```

Your settings, layout and to-dos are the files in the `data` volume
(`config.json`, `layout.json`, `control.json`, `todos.json`). The settings file
holds your tokens: treat a backup like a password.

## Still stuck

Open an issue and include the version (Settings → About) and the logs, with
anything private removed: [new issue](https://github.com/PaulWeber-co/reframe/issues/new/choose).
