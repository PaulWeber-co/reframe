# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub: **Security → Report a
vulnerability** on this repository. Do not open a public issue for something
that could be abused. You will get an answer within a week.

## What Reframe is meant for

A dashboard on your home network. It is built for a network you trust, not for
the open internet:

- Looking at the dashboard needs no login; it shows what is on the wall anyway.
- Every change (tiles, settings, to-dos, the screen) is accepted only as JSON
  from the dashboard's own pages, only under home-network host names, and from
  other devices only with the **PIN** if you set one (Settings → Access). The
  wall itself never asks.
- Host name checks stop a foreign web page from reaching the dashboard through
  a DNS trick ("DNS rebinding").
- As an Umbrel app it sits behind Umbrel's own login.
- To reach it from outside, use a VPN such as Tailscale. Do not forward the
  port to the internet.

## What to know before you switch things on

- **Secrets** (API keys, tokens, calendar links) are saved in
  `/data/config.json`, readable by its owner only, and never sent back to the
  browser. Anyone who can read your Docker volume can read them.
- **The kiosk container is privileged.** Driving a display, input devices and
  the backlight from a container needs it. It loads only the dashboard on
  `127.0.0.1`. Chromium runs with `--no-sandbox` there, because its sandbox
  does not work inside a container without extra rights; keep it that way only
  because it never visits another page.
- **The Services tile needs the Docker socket,** which is root on the machine.
  It lives in a container of its own with no network and no capabilities; the
  dashboard never touches it. If that is too much trust for you, leave the
  `services` profile off, or put a socket proxy in between.
- **The webcam sensor** measures a few grey pixels in memory and writes one
  number. No picture is stored or sent. The camera is off whenever the screen is
  dark or the feature is switched off.
- **AirPlay** has no password by default: anyone on the network can play to the
  speaker. Set one in `docker/shairport-sync.conf` if your network has guests.

Reframe is a hobby project and has had no independent audit.
