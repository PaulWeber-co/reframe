import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import commute, {
  describeWindow,
  geocodeUrl,
  hideKey,
  isActive,
  levelFor,
  nextStart,
  parseCoords,
  parseDays,
  readWindow,
  toPosition,
  toWidgetData,
} from '../server/widgets/commute.js';
import { render } from '../web/js/widgets/commute.js';

const geocode = JSON.parse(readFileSync(new URL('./fixtures/tomtom-geocode.json', import.meta.url), 'utf8'));
const route = JSON.parse(readFileSync(new URL('./fixtures/tomtom-route.json', import.meta.url), 'utf8'));

const KEY = 'tT0mt0mS3cr3tK3y4711';
const HOME = 'Potsdamer Platz 1, 10785 Berlin';
const WORK = 'Alexanderplatz 1, 10178 Berlin';
const HOME_POSITION = { lat: 52.50935, lon: 13.3765 };
const WORK_POSITION = { lat: 52.52196, lon: 13.41331 };
const ADDRESSES = { REFRAME_TOMTOM_KEY: KEY, REFRAME_HOME_ADDRESS: HOME, REFRAME_WORK_ADDRESS: WORK };

// 2026-10-16 is a Friday; Berlin is on summer time (UTC+2) until 25 October.
const FRI_0730 = '2026-10-16T05:30:00Z';
const FRI_1000 = '2026-10-16T08:00:00Z';
const SAT_0730 = '2026-10-17T05:30:00Z';
const MON_0500 = '2026-10-19T03:00:00Z';

const config = (env = {}) => loadConfig({ argv: [], env: { REFRAME_TIMEZONE: 'Europe/Berlin', ...env }, log: { warn() {}, log() {} } });
const at = (iso) => new Date(iso);
const WINDOW = readWindow(config());

// The geocoding fixture answers for the work address; for the home address the
// same answer moved to Potsdamer Platz.
function geocodeAnswer(url) {
  const answer = structuredClone(geocode);
  if (url.includes(encodeURIComponent(HOME))) {
    answer.results[0].position = { ...HOME_POSITION };
    answer.results[0].address.freeformAddress = HOME;
  }
  return answer;
}

// A ctx like the hub's, but fetchJson answers from the fixtures and records
// every request, and the store lives in memory.
function stub(env, now, files = {}) {
  const calls = [];
  const writes = [];
  const ctx = {
    config: config(env),
    log: { info() {}, warn() {}, error() {} },
    now: () => at(now),
    store: {
      read: async (name, fallback) => (name in files ? structuredClone(files[name]) : fallback),
      write: async (name, value) => {
        files[name] = structuredClone(value);
        writes.push(name);
      },
    },
    fetchJson: async (url) => {
      calls.push(url);
      if (url.startsWith('https://api.tomtom.com/search/2/geocode/')) return geocodeAnswer(url);
      if (url.startsWith('https://api.tomtom.com/routing/1/calculateRoute/')) return structuredClone(route);
      throw new Error(`unexpected request ${url}`);
    },
    fetchText: async (url) => {
      calls.push(url);
      throw new Error(`unexpected request ${url}`);
    },
  };
  return { ctx, calls, writes, files };
}

const isGeocode = (url) => url.startsWith('https://api.tomtom.com/search/2/geocode/');
const isRoute = (url) => url.startsWith('https://api.tomtom.com/routing/1/calculateRoute/');

const EXPECTED = {
  active: true,
  label: '',
  schedule: { days: [1, 2, 3, 4, 5], from: '06:00', to: '09:30' },
  nextStart: null,
  minutes: 24,
  normalMinutes: 18,
  delayMinutes: 6,
  arrival: '08:19',
  distanceKm: 18.4,
  level: 'slow',
};

test('weekdays: single days, lists and ranges', () => {
  assert.deepEqual(parseDays('1-5'), [1, 2, 3, 4, 5]);
  assert.deepEqual(parseDays('1,2,3'), [1, 2, 3]);
  assert.deepEqual(parseDays(' 1-3, 6 '), [1, 2, 3, 6]);
  assert.deepEqual(parseDays('5,1,1-2'), [1, 2, 5]);
  for (const bad of ['', '0', '8', 'Mo', '5-1', '1,,2', '1-']) {
    assert.throws(() => parseDays(bad), /REFRAME_COMMUTE_DAYS is invalid/, bad);
  }
});

test('window settings: defaults, short times and invalid values', () => {
  assert.deepEqual(readWindow(config()), { days: [1, 2, 3, 4, 5], from: 360, to: 570 });
  assert.deepEqual(readWindow(config({ REFRAME_COMMUTE_FROM: '7:15', REFRAME_COMMUTE_TO: '08:00' })).from, 435);
  assert.throws(() => readWindow(config({ REFRAME_COMMUTE_FROM: '25:00' })), /REFRAME_COMMUTE_FROM is invalid/);
  assert.throws(() => readWindow(config({ REFRAME_COMMUTE_TO: '9 o\'clock' })), /REFRAME_COMMUTE_TO is invalid/);
  assert.throws(() => readWindow(config({ REFRAME_COMMUTE_FROM: '10:00' })), /must be before REFRAME_COMMUTE_TO/);
});

test('the window is data; the tile words it in the chosen language', async () => {
  assert.deepEqual(describeWindow(WINDOW), { days: [1, 2, 3, 4, 5], from: '06:00', to: '09:30' });
  const text = (env) => describeWindow(readWindow(config(env)));
  assert.deepEqual(text({ REFRAME_COMMUTE_DAYS: '1-4', REFRAME_COMMUTE_FROM: '07:15', REFRAME_COMMUTE_TO: '08:00' }), { days: [1, 2, 3, 4], from: '07:15', to: '08:00' });

  const { describeDays } = await import('../web/js/widgets/commute.js');
  assert.equal(describeDays([1, 2, 3, 4, 5]), 'Weekdays');
  assert.equal(describeDays([1, 3, 5]), 'Mon, Wed, Fri');
  assert.equal(describeDays([6, 7]), 'Sat, Sun');
  assert.equal(describeDays([1, 2, 3, 4]), 'Mon–Thu');
  assert.equal(describeDays([1, 2, 3, 4, 5, 6, 7]), 'Every day');
  globalThis.__reframeLoadLanguage('de');
  try {
    assert.equal(describeDays([1, 2, 3, 4, 5]), 'Werktags');
    assert.equal(describeDays([1, 3, 5]), 'Mo, Mi, Fr');
    assert.equal(describeDays([1, 2, 3, 4, 5, 6, 7]), 'Täglich');
  } finally {
    globalThis.__reframeLoadLanguage('en');
  }
});

test('window: workdays, weekend and the edges, in Europe/Berlin', () => {
  const active = (iso) => isActive(at(iso), WINDOW, 'Europe/Berlin');
  assert.equal(active(FRI_0730), true);
  assert.equal(active(SAT_0730), false);
  assert.equal(active('2026-10-18T05:30:00Z'), false); // Sunday
  assert.equal(active('2026-10-16T04:00:00Z'), true); // 06:00 opens the window
  assert.equal(active('2026-10-16T03:59:00Z'), false);
  assert.equal(active('2026-10-16T07:29:00Z'), true);
  assert.equal(active('2026-10-16T07:30:00Z'), false); // 09:30 closes it
  // Winter time: 05:30 UTC is 06:30 in Berlin, 04:30 UTC only 05:30
  assert.equal(active('2026-11-02T05:30:00Z'), true);
  assert.equal(active('2026-11-02T04:30:00Z'), false);
});

test('window follows config.timezone, not the machine zone', () => {
  const machineZone = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: a different day than Berlin
  try {
    assert.equal(isActive(at(FRI_0730), WINDOW, 'Europe/Berlin'), true);
    assert.equal(isActive(at(FRI_0730), WINDOW, 'UTC'), false); // 05:30
    assert.equal(isActive(at(FRI_0730), WINDOW, 'America/New_York'), false); // 01:30
    // Sunday 22:30 UTC is already Monday 00:30 in Berlin
    const mondayNight = { days: [1], from: 0, to: 60 };
    assert.equal(isActive(at('2026-10-18T22:30:00Z'), mondayNight, 'Europe/Berlin'), true);
    assert.equal(isActive(at('2026-10-18T22:30:00Z'), mondayNight, 'UTC'), false);
    assert.deepEqual(nextStart(at('2026-10-18T22:30:00Z'), WINDOW, 'Europe/Berlin'), { weekday: 1, at: '06:00' });
  } finally {
    if (machineZone === undefined) delete process.env.TZ;
    else process.env.TZ = machineZone;
  }
});

test('next window start', () => {
  const next = (iso, window = WINDOW) => nextStart(at(iso), window, 'Europe/Berlin');
  assert.deepEqual(next(FRI_1000), { weekday: 1, at: '06:00' });
  assert.deepEqual(next(MON_0500), { weekday: 1, at: '06:00' }); // later today
  assert.deepEqual(next(SAT_0730), { weekday: 1, at: '06:00' });
  assert.deepEqual(next('2026-10-20T08:00:00Z'), { weekday: 3, at: '06:00' }); // Tuesday 10:00
  assert.deepEqual(next('2026-10-19T08:00:00Z', readWindow(config({ REFRAME_COMMUTE_DAYS: '1,3,5' }))), { weekday: 3, at: '06:00' });
  assert.deepEqual(next('2026-10-21T08:00:00Z', readWindow(config({ REFRAME_COMMUTE_DAYS: '3' }))), { weekday: 3, at: '06:00' }); // a week ahead
  assert.deepEqual(next(MON_0500, readWindow(config({ REFRAME_COMMUTE_FROM: '7:15', REFRAME_COMMUTE_TO: '9:00' }))), { weekday: 1, at: '07:15' });
});

test('coordinates from settings', () => {
  assert.deepEqual(parseCoords('52.52,13.405'), { lat: 52.52, lon: 13.405 });
  assert.deepEqual(parseCoords(' 53.5, 10 '), { lat: 53.5, lon: 10 });
  assert.deepEqual(parseCoords('-33.92,18.42'), { lat: -33.92, lon: 18.42 });
  for (const bad of ['', 'Berlin', '53.5', '91,10', '53,181', '53.5;10']) assert.equal(parseCoords(bad), null, bad);
});

test('geocoding answer becomes a position', () => {
  assert.deepEqual(toPosition(geocode), WORK_POSITION);
  assert.equal(toPosition({ summary: { numResults: 0 }, results: [] }), null);
  assert.ok(geocodeUrl(WORK, KEY).startsWith(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(WORK)}.json?`));
});

test('TomTom route becomes widget data', () => {
  const options = { label: '', schedule: { days: [1, 2, 3, 4, 5], from: '06:00', to: '09:30' }, timeZone: 'Europe/Berlin' };
  assert.deepEqual(toWidgetData(route, options), EXPECTED);
  assert.equal(toWidgetData(route, { ...options, timeZone: 'UTC' }).arrival, '06:19');
  assert.throws(() => toWidgetData({ formatVersion: '0.0.12', routes: [] }, options), /no route/);
});

test('traffic level follows the delay shown on the tile', () => {
  assert.equal(levelFor(0), 'free');
  assert.equal(levelFor(2), 'free');
  assert.equal(levelFor(3), 'slow');
  assert.equal(levelFor(9), 'slow');
  assert.equal(levelFor(10), 'jam');
  const withDelay = (seconds) => {
    const json = structuredClone(route);
    json.routes[0].summary.trafficDelayInSeconds = seconds;
    return toWidgetData(json, { label: '', schedule: null, timeZone: 'Europe/Berlin' });
  };
  assert.equal(withDelay(0).level, 'free');
  assert.equal(withDelay(170).delayMinutes, 3); // "+3 min" is never "free"
  assert.equal(withDelay(170).level, 'slow');
  assert.equal(withDelay(780).level, 'jam');
});

test('outside the window: no request, next start instead', async () => {
  for (const now of [SAT_0730, FRI_1000, MON_0500]) {
    const { ctx, calls, writes } = stub(ADDRESSES, now);
    const data = await commute.fetch(ctx);
    assert.equal(calls.length, 0, now);
    assert.equal(writes.length, 0, now);
    assert.deepEqual(data, {
      active: false,
      label: '',
      schedule: { days: [1, 2, 3, 4, 5], from: '06:00', to: '09:30' },
      nextStart: { weekday: 1, at: '06:00' },
      minutes: null,
      normalMinutes: null,
      delayMinutes: null,
      arrival: null,
      distanceKm: null,
      level: null,
    });
  }
});

test('inside the window: geocodes once, then only routes', async () => {
  const files = {};
  const first = stub(ADDRESSES, FRI_0730, files);
  assert.deepEqual(await commute.fetch(first.ctx), EXPECTED);
  assert.equal(first.calls.length, 3);
  const [home, work, drive] = first.calls.map((url) => new URL(url));
  assert.equal(home.pathname, `/search/2/geocode/${encodeURIComponent(HOME)}.json`);
  assert.equal(work.pathname, `/search/2/geocode/${encodeURIComponent(WORK)}.json`);
  assert.deepEqual(Object.fromEntries(home.searchParams), { key: KEY, limit: '1', language: 'en-US' });
  assert.equal(drive.pathname, '/routing/1/calculateRoute/52.50935,13.3765:52.52196,13.41331/json');
  assert.deepEqual(Object.fromEntries(drive.searchParams), {
    key: KEY,
    traffic: 'true',
    travelMode: 'car',
    routeType: 'fastest',
    computeTravelTimeFor: 'all',
    language: 'en-US',
  });
  assert.deepEqual(files['geocode.json'], { [HOME]: HOME_POSITION, [WORK]: WORK_POSITION });

  const second = stub(ADDRESSES, '2026-10-16T05:35:00Z', files);
  assert.deepEqual(await commute.fetch(second.ctx), EXPECTED);
  assert.equal(second.calls.length, 1);
  assert.ok(isRoute(second.calls[0]));
  assert.equal(second.writes.length, 0);
});

test('a filled geocode cache is used for each address', async () => {
  const files = { 'geocode.json': { [HOME]: HOME_POSITION, [WORK]: WORK_POSITION, 'Old Address 1, Berlin': { lat: 52.5, lon: 13.3 } } };
  const { ctx, calls, writes } = stub(ADDRESSES, FRI_0730, files);
  await commute.fetch(ctx);
  assert.deepEqual(calls.map(isGeocode), [false]);
  assert.equal(writes.length, 0);
});

test('coordinates win over addresses and skip geocoding', async () => {
  const env = { ...ADDRESSES, REFRAME_HOME_COORDS: '52.5094,13.3765', REFRAME_WORK_COORDS: '52.5220, 13.4133' };
  const { ctx, calls, writes } = stub(env, FRI_0730);
  assert.deepEqual(await commute.fetch(ctx), EXPECTED);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0]).pathname, '/routing/1/calculateRoute/52.5094,13.3765:52.522,13.4133/json');
  assert.equal(writes.length, 0);

  // Mixed: home from coordinates, work geocoded
  const mixed = stub({ REFRAME_TOMTOM_KEY: KEY, REFRAME_HOME_COORDS: '52.5094,13.3765', REFRAME_WORK_ADDRESS: WORK }, FRI_0730);
  await commute.fetch(mixed.ctx);
  assert.deepEqual(mixed.calls.map(isGeocode), [true, false]);
  assert.deepEqual(mixed.files['geocode.json'], { [WORK]: WORK_POSITION });

  const broken = stub({ ...ADDRESSES, REFRAME_HOME_COORDS: '52.5094' }, FRI_0730);
  await assert.rejects(commute.fetch(broken.ctx), /REFRAME_HOME_COORDS is invalid/);
  assert.equal(broken.calls.length, 0);
});

test('unknown address: clear error without the key', async () => {
  const { ctx } = stub(ADDRESSES, FRI_0730);
  ctx.fetchJson = async () => ({ summary: { query: 'gibtsnicht', numResults: 0, totalResults: 0 }, results: [] });
  await assert.rejects(commute.fetch(ctx), (error) => {
    assert.equal(error.message, `Address not found: ${HOME}`);
    return true;
  });

  // The home address found before the work address failed stays cached
  const half = stub(ADDRESSES, FRI_0730);
  const answer = half.ctx.fetchJson;
  half.ctx.fetchJson = async (url) => (url.includes(encodeURIComponent(WORK)) ? { summary: { numResults: 0 }, results: [] } : answer(url));
  await assert.rejects(commute.fetch(half.ctx), new RegExp(`Address not found: ${WORK}`));
  assert.deepEqual(half.files['geocode.json'], { [HOME]: HOME_POSITION });
});

test('the key never shows up in error messages', async () => {
  const { ctx } = stub(ADDRESSES, FRI_0730);
  ctx.fetchJson = async (url) => {
    throw new Error(`request to ${url} failed, reason: getaddrinfo ENOTFOUND api.tomtom.com (${KEY})`);
  };
  await assert.rejects(commute.fetch(ctx), (error) => {
    assert.ok(!error.message.includes(KEY), error.message);
    assert.match(error.message, /key=…/);
    return true;
  });
  assert.equal(hideKey(`HTTP 403 for ${KEY}`, KEY), 'HTTP 403 for …');
});

test('configured only with a key and both ends', () => {
  const configured = (env) => commute.isConfigured(config(env));
  assert.equal(configured(ADDRESSES), true);
  assert.equal(configured({ REFRAME_TOMTOM_KEY: KEY, REFRAME_HOME_COORDS: '52.5,13.4', REFRAME_WORK_ADDRESS: WORK }), true);
  assert.equal(configured({ REFRAME_HOME_ADDRESS: HOME, REFRAME_WORK_ADDRESS: WORK }), false);
  assert.equal(configured({ ...ADDRESSES, REFRAME_TOMTOM_KEY: '  ' }), false);
  assert.equal(configured({ REFRAME_TOMTOM_KEY: KEY, REFRAME_HOME_ADDRESS: HOME }), false);
  assert.equal(configured({ REFRAME_TOMTOM_KEY: KEY, REFRAME_WORK_COORDS: '52.52,13.4' }), false);
});

test('demo data has the same shape as real data', async () => {
  const shape = (value) =>
    Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key] === null ? 'null' : typeof value[key]]));
  const real = toWidgetData(route, { label: '', schedule: { days: [1, 2, 3, 4, 5], from: '06:00', to: '09:30' }, timeZone: 'Europe/Berlin' });
  const demo = commute.demo({ config: config() });
  assert.deepEqual(shape(demo), shape(real));
  assert.deepEqual(demo, EXPECTED);
  const inactive = await commute.fetch(stub(ADDRESSES, SAT_0730).ctx);
  assert.deepEqual(Object.keys(inactive).sort(), Object.keys(real).sort());
  assert.equal(commute.demo({ config: config({ REFRAME_COMMUTE_LABEL: 'To campus' }) }).label, 'To campus');
  assert.deepEqual(commute.demo({ config: config({ REFRAME_COMMUTE_DAYS: 'broken' }) }).schedule, { days: [1, 2, 3, 4, 5], from: '06:00', to: '09:30' });
});

test('tile: loading, active, free road, jam and inactive', async () => {
  assert.match(render(null), /Loading …/);

  const html = render(EXPECTED, { compact: false });
  assert.match(html, /#i-car/);
  assert.match(html, /<div class="big">24<small>min<\/small><\/div>/);
  assert.match(html, />\+6 min traffic</);
  assert.match(html, /arrive 8:19 AM<\/span> · <span class="commute-nw">18\.4 km/);

  const free = render({ ...EXPECTED, delayMinutes: 1, level: 'free' }, { compact: true });
  assert.match(free, /class="pill commute-pill commute-free">clear</);
  assert.match(render({ ...EXPECTED, minutes: 41, delayMinutes: 23, level: 'jam' }), />\+23 min jam</);
  assert.match(render({ ...EXPECTED, minutes: 104 }), /class="big long">104</);

  const off = render(await commute.fetch(stub(ADDRESSES, FRI_1000).ctx));
  assert.match(off, /<div class="sub">Weekdays <span class="commute-nw">6:00 AM–9:30 AM<\/span><\/div>/);
  assert.match(render({ ...EXPECTED, active: false, schedule: null, nextStart: { weekday: 1, at: '06:00' } }), /next trip/);
  assert.match(off, /next trip <span class="commute-nw">Mon 6:00 AM<\/span>/);
  assert.doesNotMatch(off, /class="big"/);

  const evil = render({ ...EXPECTED, label: '<img src=x onerror=alert(1)>' });
  assert.ok(!evil.includes('<img'), 'label is escaped');
});
