# Installation

Three ways, from least to most effort. They share one image, so you can start
with the first and add the others later.

## 1. Just the dashboard, any machine with Docker

```sh
git clone https://github.com/PaulWeber-co/reframe.git
cd reframe
docker compose up -d
```

Open `http://localhost:7777` (or `http://<machine>:7777` from another device).
Then `/setup` for your place, calendar links and the rest. Sample data shows
until a tile is set up; the small "Example" mark on a tile tells you which.

Put it on a tablet, a TV, or a second monitor by opening that address in a
browser and making the browser full screen.

Update with `git pull && docker compose pull && docker compose up -d`.
Your settings and to-dos live in the `data` volume and survive updates.

## 2. On the laptop's own display

You need a **Linux** laptop that does not run a desktop session on its screen:
the kiosk needs the display for itself. The easy way is a minimal server install
of Debian or Ubuntu, with Docker and `avahi-daemon` (so `reframe.local` works):

```sh
sudo apt install docker.io docker-compose-v2 avahi-daemon   # Debian / Ubuntu
sudo usermod -aG docker "$USER"                              # log in again after this
```

Then, in the project folder:

```sh
docker compose --profile kiosk up -d
```

The laptop's screen turns into the dashboard within a minute. Open
`http://reframe.local:7777/control` on your phone to set the schedule. Read
[hardware.md](hardware.md) first if anything does not light up: the kiosk is the
part that depends on your machine.

Useful things for a laptop that now lives on a shelf:

- **Lid:** keep the screen on with the lid open. Closing it usually suspends the
  machine; in `/etc/systemd/logind.conf` set `HandleLidSwitch=ignore` if you
  want it to keep running closed (then the screen is off, of course).
- **Sleep:** disable suspend (`sudo systemctl mask sleep.target suspend.target`).
  The dashboard dims and switches the screen off by itself.
- **Battery:** if your firmware can stop charging at 60 to 80 percent, use it. A
  battery that sits at 100 percent all day ages fastest.
- **Start at boot:** the containers have `restart: unless-stopped`, so they come
  back after a reboot once Docker starts.

## 3. As an umbrelOS app

See [umbrel.md](umbrel.md).

## Optional extras

```sh
docker compose --profile airplay up -d     # an AirPlay 2 speaker named "Reframe"
docker compose --profile services up -d    # the Services tile (needs the Docker socket)
docker compose --profile kiosk --profile airplay up -d   # profiles combine
```

AirPlay needs the machine's sound card, `avahi-daemon` and a free host network.
If a desktop session or PipeWire already holds the sound card, AirPlay will not
get it.

## Uninstall

```sh
docker compose --profile kiosk --profile airplay --profile services down
docker volume rm reframe_data reframe_run reframe_airplay    # also deletes your settings
```
