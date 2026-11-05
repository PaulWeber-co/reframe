# Contributing

Bug reports, hardware reports and small fixes are welcome.

## Hardware reports are the most useful thing

The kiosk depends on the laptop. If you tried `docker compose --profile kiosk up`,
please open an issue with the machine (model, GPU), the OS, what worked and what
did not, and the output of `docker compose logs kiosk`. The checklist is in
[docs/hardware.md](docs/hardware.md).

## Working on the code

```sh
cd app
npm test            # JavaScript tests (Node 22, no dependencies to install)
npm run check       # syntax of every file
npm run smoke       # starts the real server in demo mode and asks it things
npm run demo        # look at it: http://localhost:7777
cd ..
python3 -m unittest discover -s host/tests    # the host helpers
node scripts/release-gate.mjs                 # nothing private in the repository
```

A new tile is two files and two lines: see [docs/widgets.md](docs/widgets.md).
Text in the dashboard goes into both `app/web/i18n/en.json` and `de.json`; a
test fails if one has a key the other lacks. Other languages are welcome: add a
file and a line in `app/server/settings.js`.

Please keep changes small and say in the pull request what you ran.
