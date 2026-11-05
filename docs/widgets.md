# Writing a tile

A visible tile is two files with the same id, for example `weather`:

| File | What it does |
| --- | --- |
| `app/server/widgets/<name>.js` | fetches the data, runs in the server |
| `app/web/js/widgets/<id>.js` | draws the tile, runs in the browser |

Plus a line in `app/server/widgets/index.js` and one in
`app/web/js/widgets/index.js`, a conversion that can be tested on its own,
the texts in `app/web/i18n/en.json` and `de.json`, and, if it needs settings, an
entry in `app/server/settings.js` (that is what the setup page shows). The
complete model is the weather tile: `app/server/widgets/weather.js`,
`app/web/js/widgets/weather.js` and `app/test/weather.test.js`.

A stream without a tile needs no browser module: a file in `app/web/js/features/`
subscribes to it with `ctx.onEntry()`, like music mode (`music`), or the control
logic on the server reads it, like the webcam brightness (`ambient` →
`app/server/control.js`). If a widget needs rights the dashboard does not have
(Docker, a camera), a small separate program writes a JSON file under
`/run/reframe/` and the widget only reads that, like `services.js` and
`ambient.js`.

## Server: `app/server/widgets/<name>.js`

```js
export default {
  id: 'photos',                     // a-z, 0-9, -; the same as the file in web/js/widgets/
  intervalMs: 30 * 60_000,          // how often fetch() runs
  isConfigured: (config) => Boolean(config.get('REFRAME_IMMICH_KEY')),
  async fetch(ctx) { ... },         // the real data
  demo(ctx) { ... },                // sample data, the same shape as fetch()
  actions: { async toggle(ctx) { ... } },   // optional: ctx.payload, ctx.demo
  watch(ctx, emit) { ...; return stop },    // optional: for sources that push
};
```

`ctx` has:

- `config`: `config.get('REFRAME_X', fallback)` and `config.num('REFRAME_X', fallback)`
  read settings live, so a change on the setup page applies at once. Also
  `config.lat`, `config.lon`, `config.place`, `config.timezone` and `config.lang`.
- `fetchJson(url, { method, headers, body })` and `fetchText(...)`, both with a
  15 s timeout; they throw on HTTP errors.
- `store.read(name, fallback)` and `store.write(name, value)` for JSON files in
  the data folder.
- `now()` (replaceable in tests) and `log`.

Rules:

- If `fetch()` throws, the hub keeps the last good data, marks the tile with a
  small warning and tries again after 30 s, 60 s, 120 s, …
- Without settings (`isConfigured` returns `false`) or with `--demo`, `demo()`
  is used. Sample data is realistic and has exactly the shape of the real data;
  a test compares the two.
- Turn an API answer into widget data in a pure function (like `toWidgetData` in
  the weather tile), so a test can check it with a fixture.
- **No wording on the server.** Send keys and numbers (`partly_cloudy`,
  `{ hour: 14 }`), not sentences: the browser words them in the chosen language.
- Keys and tokens go into headers or are removed from messages with `redact()`
  from `app/server/hub.js`; never log them.
- Actions check their `payload`: anyone on the network can call them.

## Browser: `app/web/js/widgets/<id>.js`

```js
import { t } from '../i18n.js';
import { esc, icon, num } from '../util.js';

export const labelKey = 'photos.title';      // name in edit mode, a key of the language files
export function render(data, { compact }) {  // HTML for the tile body
  if (!data) return `<div class="lbl">${icon('photo')}${esc(t('photos.title'))}</div><div class="loading">${esc(t('common.loading'))}</div>`;
  ...
}
```

- `data` is `null` until something has loaded.
- `compact` is `true` in music mode, when the tile is narrower.
- Every value from the server goes through `esc()`. `num(18432)` writes
  "18,432" in English and "18.432" in German; `plural('key', count)` picks
  `key.one` or `key.other`.
- Clicks: `<button data-action="toggle" data-payload='{"id":"x"}'>` or
  `<form data-action="add">` (the fields are the payload). The result comes back
  through `/api/events`.

### Sizes (stage 1920 × 1080)

| Tile | outside | inside (without the 28/30 px border) |
| --- | --- | --- |
| 1×1 | 248 × 290 | 188 × 234 |
| 2×1 | 520 × 290 | 460 × 234 |
| 1×1 in music mode | 232 × 290 | 172 × 234 |
| 2×1 in music mode | 488 × 290 | 428 × 234 |

Text must never be cut off: shorten it, use a smaller size (`.big.long`) or leave
a line out. German is longer than English: check both.

### Building blocks from `app/web/css/dashboard.css`

`.lbl` (header with icon, `<em>` on the right), `.big` / `.big small` /
`.big.long`, `.sub`, `.foot`, `.pill`, `.ph`, `.loading`, `.row` (icon + text),
`.switch` with `.knob` and `aria-pressed`, `.bar > i`. Rules of your own go in
`app/web/css/w-<id>.css`, linked in `app/web/index.html`.

The page runs with a Content-Security-Policy that allows only its own scripts
(`app/server/http.js`): no inline scripts, inline `style` attributes are fine.

Icons (`icon('name')`): sun, cloud, cloudsun, rain, snow, storm, fog, car,
train, cal, check, list, cpu, temp, photo, home, bulb, washer, note, trend,
sliders, stack, disk, x, plus, airplay, wifi-off.

## Checking

```sh
cd app
node --test test/<name>.test.js   # your widget
npm test                          # everything, including the contract test for each widget
npm run check                     # syntax of every file
npm run smoke                     # the real server in demo mode
npm run demo                      # look at it: http://localhost:7777
```

Tests never touch the network: `fetchJson` is replaced by a function that
returns a fixture.
