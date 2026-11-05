import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import home, { baseUrl, displayFor, iconFor, parseEntities, toggleTarget, toWidgetData } from '../server/widgets/home.js';
import { render } from '../web/js/widgets/home.js';

const states = JSON.parse(readFileSync(new URL('./fixtures/ha-states.json', import.meta.url), 'utf8'));

const HA = 'http://umbrel.local:8123';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJ4cHMtZGFzaGJvYXJkIn0.hAsEcReT4711';
const ENTITIES =
  'light.living_room=Living room, sensor.living_room_temperature=Inside, sensor.washer_remaining=Laundry, binary_sensor.balcony_door=Balcony door';
const SETTINGS = { REFRAME_HA_URL: `${HA}/`, REFRAME_HA_TOKEN: TOKEN, REFRAME_HA_ENTITIES: ENTITIES };

const config = (env = {}) => loadConfig({ argv: [], env, log: { warn() {}, log() {} } });

// Home Assistant's answer to the toggle: the states that changed meanwhile.
const toggled = () => [{ ...structuredClone(states.find((s) => s.entity_id === 'light.living_room')), state: 'off' }];

// A ctx like the hub's, but fetchJson answers from the fixture and records
// every request with its options.
function stub(env = SETTINGS, { demo = false, payload, fail } = {}) {
  const calls = [];
  const ctx = {
    config: config(env),
    log: { info() {}, warn() {}, error() {} },
    now: () => new Date('2026-10-16T09:24:00+02:00'),
    store: { read: async (_, fallback) => fallback, write: async () => {} },
    demo,
    payload,
    fetchJson: async (url, options = {}) => {
      calls.push({ url, ...options });
      if (fail) throw new Error(fail);
      if (url === `${HA}/api/states`) return structuredClone(states);
      if (url === `${HA}/api/services/homeassistant/toggle`) return toggled();
      throw new Error(`unexpected request ${url}`);
    },
    fetchText: async (url) => {
      calls.push({ url });
      throw new Error(`unexpected request ${url}`);
    },
  };
  return { ctx, calls };
}

const status400 = (error) => error.status === 400;
const byId = (data) => Object.fromEntries(data.entities.map((item) => [item.id, item]));

test('REFRAME_HA_ENTITIES: order, labels, spaces and empty parts', () => {
  assert.deepEqual(parseEntities(' light.living_room = Living room ,, sensor.living_room_temperature=Inside , ,binary_sensor.balcony_door,'), [
    { id: 'light.living_room', label: 'Living room' },
    { id: 'sensor.living_room_temperature', label: 'Inside' },
    { id: 'binary_sensor.balcony_door', label: null },
  ]);
  assert.deepEqual(parseEntities('sensor.x='), [{ id: 'sensor.x', label: null }]);
  assert.deepEqual(parseEntities('sensor.x=a=b'), [{ id: 'sensor.x', label: 'a=b' }]);
  assert.deepEqual(parseEntities('Light.Hallway=Hallway, light.hallway=duplicate'), [{ id: 'light.hallway', label: 'Hallway' }]);
  assert.deepEqual(parseEntities(''), []);
  assert.deepEqual(parseEntities(' , ,'), []);
  assert.throws(() => parseEntities('living_room=Light'), /REFRAME_HA_ENTITIES.*"living_room"/);
  assert.throws(() => parseEntities('light.wohn zimmer'), /invalid entity/);
});

test('settings: URL normalised, all three keys required', () => {
  assert.equal(baseUrl('http://umbrel.local:8123/'), HA);
  assert.equal(baseUrl(' umbrel.local:8123 '), HA);
  assert.equal(baseUrl('https://ha.example.org//'), 'https://ha.example.org');
  assert.equal(baseUrl(''), '');
  assert.equal(home.isConfigured(config(SETTINGS)), true);
  assert.equal(home.isConfigured(config({ ...SETTINGS, REFRAME_HA_URL: '' })), false);
  assert.equal(home.isConfigured(config({ ...SETTINGS, REFRAME_HA_TOKEN: ' ' })), false);
  assert.equal(home.isConfigured(config({ ...SETTINGS, REFRAME_HA_ENTITIES: ' , =Inside' })), false);
  assert.equal(home.isConfigured(config({})), false);
});

test('display: switches, numbers, doors, motion and texts as keys or values', () => {
  const show = (domain, state, attributes) => displayFor({ domain, state, attributes });
  assert.deepEqual(show('light', 'on'), { key: 'on' });
  assert.deepEqual(show('switch', 'off'), { key: 'off' });
  assert.deepEqual(show('automation', 'on'), { key: 'on' });
  assert.deepEqual(show('sensor', '21.46', { unit_of_measurement: '°C' }), { text: '21.5 °C' });
  assert.deepEqual(show('sensor', '21.0', { unit_of_measurement: '°C' }), { text: '21 °C' })
  assert.deepEqual(show('sensor', '32', { unit_of_measurement: 'min' }), { text: '32 min' });
  assert.deepEqual(show('sensor', '45', { unit_of_measurement: '%' }), { text: '45 %' })
  assert.deepEqual(show('sensor', '1234.56', { unit_of_measurement: 'kWh' }), { text: '1,234.6 kWh' })
  assert.deepEqual(show('sensor', '-0.04', { unit_of_measurement: '°C' }), { text: '0 °C' })
  assert.deepEqual(show('sensor', '-3.25'), { text: '-3.2' })
  for (const deviceClass of ['door', 'window', 'opening', 'garage_door']) {
    assert.deepEqual(show('binary_sensor', 'on', { device_class: deviceClass }), { key: 'open' });
    assert.deepEqual(show('binary_sensor', 'off', { device_class: deviceClass }), { key: 'closed' });
  }
  for (const deviceClass of ['motion', 'occupancy', 'presence']) {
    assert.deepEqual(show('binary_sensor', 'on', { device_class: deviceClass }), { key: 'motion' });
    assert.deepEqual(show('binary_sensor', 'off', { device_class: deviceClass }), { key: 'calm' });
  }
  assert.deepEqual(show('binary_sensor', 'on', { device_class: 'running' }), { key: 'on' });
  assert.deepEqual(show('binary_sensor', 'off'), { key: 'off' });
  assert.deepEqual(show('sensor', 'Spinning'), { text: 'Spinning' });
  assert.deepEqual(show('sensor', 'on'), { text: 'on' })
  assert.deepEqual(show('cover', 'open'), { key: 'open' });
  assert.deepEqual(show('person', 'not_home'), { key: 'not_home' });
  assert.deepEqual(show('person', 'Büro'), { text: 'Büro' })
  for (const domain of ['light', 'sensor', 'binary_sensor', 'cover']) {
    assert.deepEqual(show(domain, 'unavailable'), { key: 'unreachable' });
    assert.deepEqual(show(domain, 'unknown'), { key: 'unreachable' });
  }
});

test('icons: bulb, temp, washer, home', () => {
  assert.equal(iconFor({ id: 'light.hallway', name: 'Hallway', domain: 'light' }), 'bulb');
  assert.equal(iconFor({ id: 'sensor.a', name: 'A', domain: 'sensor', attributes: { device_class: 'temperature' } }), 'temp');
  assert.equal(iconFor({ id: 'sensor.b', name: 'B', domain: 'sensor', attributes: { unit_of_measurement: '°C' } }), 'temp');
  assert.equal(iconFor({ id: 'sensor.washer_remaining', name: 'Rest', domain: 'sensor' }), 'washer');
  assert.equal(iconFor({ id: 'sensor.dryer', name: 'Laundry', domain: 'sensor' }), 'washer');
  assert.equal(iconFor({ id: 'switch.dishwasher', name: 'Spüler', domain: 'switch' }), 'washer');
  assert.equal(iconFor({ id: 'binary_sensor.balcony_door', name: 'Balcony door', domain: 'binary_sensor' }), 'home');
});

test('/api/states becomes the configured entities in order', () => {
  const entities = parseEntities(
    'binary_sensor.balcony_door, light.living_room=Living room, sensor.living_room_temperature=Inside, switch.garden_pump=Pump, light.hallway, sensor.outside_temperature',
  );
  const data = toWidgetData(states, entities);
  assert.deepEqual(
    data.entities.map((item) => item.id),
    entities.map((entity) => entity.id),
  );
  assert.deepEqual(data.entities[0], {
    id: 'binary_sensor.balcony_door',
    name: 'Balcony door',
    domain: 'binary_sensor',
    state: 'off',
    display: { key: 'closed' },
    toggleable: false,
    on: false,
    icon: 'home',
    missing: false,
  });
  assert.deepEqual(data.entities[1], {
    id: 'light.living_room',
    name: 'Living room',
    domain: 'light',
    state: 'on',
    display: { key: 'on' },
    toggleable: true,
    on: true,
    icon: 'bulb',
    missing: false,
  });
  const temperature = data.entities[2];
  assert.deepEqual(temperature.display, { text: '21.5 °C' });
  assert.equal(temperature.state, '21.46');
  assert.equal(temperature.on, null);
  assert.equal(temperature.icon, 'temp');

  // not in Home Assistant at all
  assert.deepEqual(data.entities[3], {
    id: 'switch.garden_pump',
    name: 'Pump',
    domain: 'switch',
    state: 'unavailable',
    display: { key: 'unreachable' },
    toggleable: true,
    on: false,
    icon: 'home',
    missing: true,
  });
  // known but offline: friendly_name stands in for the missing label
  assert.equal(data.entities[4].name, 'Hallway');
  assert.deepEqual(data.entities[4].display, { key: 'unreachable' });
  assert.equal(data.entities[4].missing, false);
  assert.equal(data.entities[5].name, 'Outside temperature');
  assert.deepEqual(data.entities[5].display, { key: 'unreachable' });

  // an unknown id without label falls back to the id itself
  assert.equal(toWidgetData([], parseEntities('sensor.weg')).entities[0].name, 'sensor.weg');
  assert.throws(() => toWidgetData({ message: 'API running.' }, entities), /unexpected answer/);
});

test('every fixture entity gets a display', () => {
  const data = byId(toWidgetData(states, parseEntities(states.map((s) => s.entity_id).join(','))));
  assert.deepEqual(data['sensor.living_room_humidity'].display, { text: '45.2 %' });
  assert.deepEqual(data['sensor.energy_today'].display, { text: '4.8 kWh' });
  assert.deepEqual(data['sensor.washer_remaining'].display, { text: '32 min' });
  assert.equal(data['sensor.washer_remaining'].icon, 'washer');
  assert.deepEqual(data['sensor.washer_phase'].display, { text: 'Spinning' });
  assert.deepEqual(data['binary_sensor.kitchen_window'].display, { key: 'open' });
  assert.deepEqual(data['binary_sensor.hallway_motion'].display, { key: 'motion' });
  assert.deepEqual(data['binary_sensor.washer_running'].display, { key: 'on' });
  assert.deepEqual(data['switch.coffee_maker'].display, { key: 'off' });
  assert.equal(data['fan.bath_fan'].toggleable, true);
  assert.equal(data['automation.evening_lights'].on, true);
  assert.equal(data['input_boolean.vacation_mode'].on, false);
  assert.deepEqual(data['cover.living_room_shutter'].display, { key: 'open' });
  assert.equal(data['cover.living_room_shutter'].toggleable, false);
  assert.deepEqual(data['person.alex'].display, { key: 'home' });
  assert.deepEqual(data['sun.sun'].display, { text: 'above_horizon' });
});

test('fetch() asks /api/states once with the token in the header', async () => {
  const { ctx, calls } = stub();
  const data = await home.fetch(ctx);
  assert.deepEqual(calls, [{ url: `${HA}/api/states`, headers: { authorization: `Bearer ${TOKEN}` } }]);
  assert.deepEqual(
    data.entities.map((item) => [item.name, item.display]),
    [
      ['Living room', { key: 'on' }],
      ['Inside', { text: '21.5 °C' }],
      ['Laundry', { text: '32 min' }],
      ['Balcony door', { key: 'closed' }],
    ],
  );
  assert.ok(!calls[0].url.includes(TOKEN));
});

test('errors name the token setting but never the token', async () => {
  const { ctx } = stub(SETTINGS, { fail: `GET ${HA}/api/states: HTTP 401` });
  await assert.rejects(home.fetch(ctx), (error) => /HTTP 401/.test(error.message) && /REFRAME_HA_TOKEN/.test(error.message));
  const leaky = stub(SETTINGS, { fail: `upstream said: Bearer ${TOKEN} invalid` });
  await assert.rejects(home.fetch(leaky.ctx), (error) => !error.message.includes(TOKEN) && error.message.includes('Bearer …'));
});

test('toggle rejects payloads for anything but configured switchable entities', async () => {
  const entities = parseEntities(ENTITIES);
  assert.equal(toggleTarget({ id: 'light.living_room' }, entities), 'light.living_room');
  for (const payload of [undefined, null, 'light.living_room', [], {}, { id: '' }, { id: 42 }, { entity_id: 'light.living_room' }]) {
    assert.throws(() => toggleTarget(payload, entities), status400, JSON.stringify(payload));
  }
  assert.throws(() => toggleTarget({ id: 'light.kitchen' }, entities), (e) => status400(e) && /not listed in REFRAME_HA_ENTITIES/.test(e.message));
  assert.throws(() => toggleTarget({ id: 'sensor.living_room_temperature' }, entities), (e) => status400(e) && /cannot be switched/.test(e.message));
  assert.throws(() => toggleTarget({ id: 'LIGHT.WOHNZIMMER' }, entities), status400);

  for (const payload of [{}, { id: 'lock.front_door' }, { id: 'binary_sensor.balcony_door' }]) {
    const { ctx, calls } = stub(SETTINGS, { payload });
    await assert.rejects(home.actions.toggle(ctx), status400);
    assert.equal(calls.length, 0, 'no request for an invalid payload');
  }
});

test('toggle posts homeassistant.toggle with JSON body and Bearer token', async () => {
  const { ctx, calls } = stub(SETTINGS, { payload: { id: 'light.living_room' } });
  assert.deepEqual(await home.actions.toggle(ctx), { id: 'light.living_room' });
  assert.deepEqual(calls, [
    {
      url: `${HA}/api/services/homeassistant/toggle`,
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: '{"entity_id":"light.living_room"}',
    },
  ]);
});

test('demo toggle flips the demo light without any request', async () => {
  const { ctx, calls } = stub({}, { demo: true, payload: { id: 'light.living_room' } });
  const light = () => home.demo(ctx).entities.find((item) => item.id === 'light.living_room');
  const before = light().on;
  await home.actions.toggle(ctx);
  assert.equal(light().on, !before);
  assert.deepEqual(light().display, before ? { key: 'off' } : { key: 'on' });
  assert.equal(light().state, before ? 'off' : 'on');
  await home.actions.toggle(ctx);
  assert.equal(light().on, before);
  assert.equal(calls.length, 0);

  for (const payload of [{ id: 'sensor.living_room_temperature' }, { id: 'light.kitchen' }, null]) {
    await assert.rejects(home.actions.toggle({ ...ctx, payload }), status400);
  }
  assert.equal(light().on, before);
});

test('demo data: sample entities', () => {
  const data = home.demo({ config: {} });
  assert.deepEqual(
    data.entities.map((item) => [item.name, item.display, item.icon]),
    [
      ['Living room', { key: 'on' }, 'bulb'],
      ['Inside', { text: '21.5 °C' }, 'temp'],
      ['Laundry', { text: '32 min' }, 'washer'],
      ['Balcony door', { key: 'closed' }, 'home'],
    ],
  );
  assert.equal(data.entities[0].toggleable, true);
  assert.equal(data.entities[3].domain, 'binary_sensor');
  assert.equal(data.entities[3].on, false);
});

test('demo data has the same shape as real data', async () => {
  const { ctx } = stub();
  const real = await home.fetch(ctx);
  const demo = home.demo({ config: {} });
  const shape = (value) =>
    Array.isArray(value)
      ? value.map(shape)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
        : typeof value;
  // on is a boolean for switches and binary sensors, null otherwise
  const items = (data) => shape(data).entities.map((item) => ({ ...item, on: 'boolean|null' }));
  assert.deepEqual(Object.keys(demo), Object.keys(real));
  assert.equal(demo.entities.length, real.entities.length);
  assert.deepEqual(items(demo), items(real));
  for (const data of [demo, real]) {
    for (const item of data.entities) assert.ok(item.on === null || typeof item.on === 'boolean');
  }
});

const decode = (text) =>
  text.replace(/&(quot|#39|amp|lt|gt);/g, (_, name) => ({ quot: '"', '#39': "'", amp: '&', lt: '<', gt: '>' })[name]);
const payloadOf = (html) => JSON.parse(decode(html.match(/data-payload='([^']*)'/)[1]));
const rowCount = (html) => (html.match(/class="row ho-row/g) ?? []).length;

test('tile: loading, switch with JSON payload and two rows', () => {
  const loading = render(null);
  assert.match(loading, /#i-home/);
  assert.match(loading, /Home/);
  assert.match(loading, /class="loading">Loading …/);

  const html = render(home.demo({ config: {} }), { compact: false });
  assert.match(html, /<div class="lbl"><svg class="ic" aria-hidden="true"><use href="#i-home"\/><\/svg>Home<\/div>/);
  assert.match(html, /<button class="switch ho-switch" type="button" data-action="toggle" data-payload='[^']*' aria-pressed="(true|false)">/);
  assert.deepEqual(payloadOf(html), { id: 'light.living_room' });
  assert.match(html, /#i-bulb.*Living room.*<i class="knob"><\/i><\/button>/s);
  assert.equal(rowCount(html), 2);
  assert.match(html, /<b class="ho-val">21.5 °C<\/b><span class="ho-name ho-muted">Inside<\/span>/);
  assert.match(html, /<b class="ho-val">32 min<\/b><span class="ho-name ho-muted">Laundry<\/span>/);
  assert.doesNotMatch(html, /Balcony door/);
  // music mode: same markup, w-home.css adapts to the narrower tile
  assert.equal(render(home.demo({ config: {} }), { compact: true }), html);
});

test('tile: aria-pressed follows the light, values are escaped', () => {
  const item = {
    id: "light.o'neil",
    name: '<b>Bar & "Lounge"</b>',
    domain: 'light',
    state: 'off',
    display: { key: 'off' },
    toggleable: true,
    on: false,
    icon: 'bulb',
    missing: false,
  };
  const html = render({ entities: [item] });
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /&lt;b&gt;Bar &amp; &quot;Lounge&quot;&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Bar/);
  assert.deepEqual(payloadOf(html), { id: "light.o'neil" });
});

test('tile: offline entities say "unreachable", an offline switch is disabled', () => {
  const data = toWidgetData(
    states,
    parseEntities('sensor.living_room_temperature=Inside, light.hallway, sensor.outside_temperature=outside, switch.garden_pump=Pump, binary_sensor.balcony_door'),
  );
  // light.hallway is the first switchable entity but offline
  const html = render(data);
  assert.match(html, /<button class="switch ho-switch ho-na" type="button" aria-pressed="false" disabled>/);
  assert.doesNotMatch(html, /data-action/);
  assert.match(html, /Hallway<\/span><small class="ho-muted">unreachable<\/small>/);
  assert.equal(rowCount(html), 2);
  assert.match(html, /<b class="ho-val">21.5 °C<\/b><span class="ho-name ho-muted">Inside<\/span>/);
  assert.match(html, /<div class="row ho-row ho-na">.*outside<\/span><small class="ho-muted">unreachable<\/small>/s);
  assert.doesNotMatch(html, /Pump/);
});

test('tile: without a switchable entity up to three rows, empty list explained', () => {
  const data = toWidgetData(
    states,
    parseEntities('sensor.living_room_temperature=Inside, sensor.basement_humidity=Basement, binary_sensor.balcony_door, sensor.energy_today'),
  );
  const html = render(data, { compact: true });
  assert.doesNotMatch(html, /<button/);
  assert.equal(rowCount(html), 3);
  assert.match(html, /Basement<\/span><small class="ho-muted">unreachable<\/small>/);
  assert.match(html, /<b class="ho-val">closed<\/b><span class="ho-name ho-muted">Balcony door<\/span>/);
  assert.doesNotMatch(html, /Stromverbrauch/);

  assert.match(render({ entities: [] }), /No devices set up/);
});
