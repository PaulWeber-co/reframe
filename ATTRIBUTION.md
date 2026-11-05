# Attribution

Reframe's own code is MIT licensed (see `LICENSE`). It stands on, and talks to,
the following. Everything below keeps its own license and terms.

## Bundled with the code

| What | License | Where |
| --- | --- | --- |
| Onest font (https://fonts.google.com/specimen/Onest) by The Onest Project Authors | SIL Open Font License 1.1 | `app/web/fonts/`, license text next to the files |

## Data Reframe can show

| Source | Used for | Terms |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com) | weather, and the place search | Free for non-commercial use without a key. Attribution required: "Weather data by Open-Meteo.com", data under CC BY 4.0. |
| [Wikimedia feed](https://api.wikimedia.org) | the Wikipedia tile | Wikipedia text is CC BY-SA 4.0, pictures carry their own licenses on Wikimedia Commons. Reframe sends a User-Agent that names the project, as Wikimedia asks. |
| [TomTom](https://developer.tomtom.com) | the commute tile (optional) | Needs your own API key and follows TomTom's terms. |
| [Home Assistant](https://www.home-assistant.io), [Immich](https://immich.app) | home and photo tiles (optional) | Your own server, your own token. |
| Calendar links | the calendar tile (optional) | Your own calendars. Anyone with a link can read it: keep it private. |

## Software in the container image

The image is built on Debian with Node.js, Chromium, cage, seatd, ffmpeg,
v4l-utils and the Docker CLI. They are installed from Debian packages, are not
modified, and come under their own licenses (mostly MIT, BSD, LGPL and GPL).
Their license texts are in `/usr/share/doc/<package>/copyright` inside the image.

[shairport-sync](https://github.com/mikebrady/shairport-sync) (AirPlay 2) runs
as its own, unmodified container from its official image and is only
referenced, not bundled. [nqptp](https://github.com/mikebrady/nqptp) comes with
that image.

## Pictures in the README and the demo

| What | Source | License |
| --- | --- | --- |
| Day background of the screenshots: a coral atoll, ISS071-E-111610 | NASA, astronaut photography from the International Space Station | public domain (NASA media usage guidelines) |
| Morning background: mountains above the clouds in south-west Greenland, GSFC_20171208_Archive_e001911 | NASA, Operation IceBridge | public domain |
| Evening background: an orbital sunset, ISS023-E-057948 | NASA, International Space Station | public domain |
| Late background: Europe at night under the moon, GSFC_20171208_Archive_e001240 | NASA, International Space Station | public domain |
| Demo album cover: "Wanderer above the Sea of Fog" by Caspar David Friedrich, c. 1818, cropped square | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Caspar_David_Friedrich_-_Wanderer_above_the_sea_of_fog.jpg), tagged PD-Art (the painter died in 1840) | public domain |
| Demo piece: Beethoven, Piano Sonata No. 14 "Moonlight", 1801 | the composition only; no audio is included | public domain |

The NASA photographs appear only in the screenshots under `docs/screenshots/`.
The painting is `app/server/assets/demo-cover.jpg`, used by the demo mode. Reframe
does not display any other album cover than the one the AirPlay sender provides
on your own network.

## Video

Reframe ships **no video clips**. Clips you add yourself are yours, and what
you may show with them is up to you. If you want free footage, look for
material under CC0 or CC BY and keep the credit for CC BY clips.
