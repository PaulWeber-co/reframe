# Changelog

All notable changes. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
versions follow [Semantic Versioning](https://semver.org/).

## 0.1.0 - 2026-11-05

First release.

### Added

- The dashboard: clock, weather, calendar (iCal and webcal links), to-dos you can
  tick off on the wall, system, services, commute, Wikipedia, Home Assistant and
  Immich tiles, with scenes by time of day and drifting colour when there is no
  clip.
- Music mode for an AirPlay 2 speaker: cover, title and progress on the wall.
- A control center (screen mode, schedule, rules, features, tiles, to-dos) as an
  overlay on the wall and as a page for the phone, and a settings page with place
  search, in English and German.
- Your own clips: `reframe-media` converts them, the wall plays them by time of
  day.
- The container image for amd64 and arm64, and a compose file whose profiles
  combine: `kiosk` (no privileged mode), `kiosk-full`, `airplay`, `services`.
- Two umbrelOS community apps: Reframe (dashboard) and Reframe Display
  (dashboard plus kiosk and AirPlay, using Umbrel's GPU permission).
- Software dimming for machines where the backlight cannot be reached, and
  `scripts/backlight-mount.sh` for the real backlight.

### Known limits

- The kiosk taking over a real display, touch input, the webcam sensor and the
  Umbrel apps on umbrelOS have not been verified on hardware yet. See
  [docs/hardware.md](docs/hardware.md); reports are welcome.
