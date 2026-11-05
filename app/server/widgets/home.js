// Home from Home Assistant (https://www.home-assistant.io), the
// smart-home app on Umbrel: a few chosen entities on the tile, lights and
// switches toggled from it. One request every 30 seconds, the long-lived
// access token always in the authorization header, never in the URL:
//   GET  /api/states                          every entity's current state
//   POST /api/services/homeassistant/toggle   on a tap, body {"entity_id": id}
//
// Settings:
//   REFRAME_HA_URL        e.g. http://umbrel.local:8123 (required)
//   REFRAME_HA_TOKEN      long-lived access token (required), made in Home
//                      Assistant → profile → Security → Long-lived access tokens
//   REFRAME_HA_ENTITIES   entity ids in display order, each with an optional label
//                      after "=" (required), e.g. "light.living_room=Living room,
//                      sensor.living_room_temperature=Inside, binary_sensor.balcony_door"
//
// Only configured entities that can be switched (TOGGLEABLE) may be toggled:
// anyone on the home network can call the action. In demo mode the toggle
// flips the demo light in memory, so the demo tile reacts to taps.

export const TOGGLEABLE = new Set(['light', 'switch', 'fan', 'input_boolean', 'automation']);
const UNREACHABLE = new Set(['unavailable', 'unknown']);
const OPENINGS = new Set(['door', 'window', 'opening', 'garage_door']);
const PRESENCE = new Set(['motion', 'occupancy', 'presence']);

// Common states of domains without their own rule (cover, lock, person,
// media_player ...). They travel as keys of the language files
// (home.state.<key>); sensor texts are shown as reported.
const STATES = new Set(['on', 'off', 'open', 'closed', 'opening', 'closing', 'locked', 'unlocked', 'home', 'not_home', 'playing', 'paused']);

// "light.living_room": lowercase domain and object id, as Home Assistant makes them
const ENTITY_ID = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const NUMBER = /^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i;

const setting = (config, key) => String(config.get(key, '')).trim();

// "umbrel.local:8123/" → "http://umbrel.local:8123"
export function baseUrl(url) {
  const text = String(url ?? '').trim().replace(/\/+$/, '');
  return !text || /^https?:\/\//i.test(text) ? text : `http://${text}`;
}

// "light.living_room=Living room, sensor.x" → [{ id: 'light.living_room', label: 'Living room' },
// { id: 'sensor.x', label: null }]. Empty parts are skipped, a repeated id
// keeps its first place, everything after the first "=" is the label.
export function parseEntities(text) {
  const entities = [];
  const seen = new Set();
  for (const part of String(text ?? '').split(',')) {
    const eq = part.indexOf('=');
    const id = (eq < 0 ? part : part.slice(0, eq)).trim().toLowerCase();
    const label = eq < 0 ? '' : part.slice(eq + 1).trim();
    if (!id) continue;
    if (!ENTITY_ID.test(id)) {
      throw new Error(`REFRAME_HA_ENTITIES has an invalid entity: "${id}" (expected e.g. light.living_room)`);
    }
    if (seen.has(id)) continue;
    seen.add(id);
    entities.push({ id, label: label || null });
  }
  return entities;
}

const hasEntities = (text) => text.split(',').some((part) => part.split('=')[0].trim() !== '');

export function readSettings(config) {
  return {
    url: baseUrl(setting(config, 'REFRAME_HA_URL')),
    token: setting(config, 'REFRAME_HA_TOKEN'),
    entities: parseEntities(setting(config, 'REFRAME_HA_ENTITIES')),
  };
}

const domainOf = (id) => id.slice(0, id.indexOf('.'));

// 21.46 → "21.5" (en) or "21,5" (de), 1234.56 → "1,234.6": at most one decimal
const decimal = (value, lang) => (Math.round(value * 10) / 10 || 0).toLocaleString(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1 });

// The state for the tile: { key } for a word the language files translate
// (home.state.<key>), { text } for a value shown as it is, e.g. "21.5 °C".
export function displayFor({ domain, state, attributes = {} }, lang = 'en') {
  if (UNREACHABLE.has(state)) return { key: 'unreachable' };
  if (TOGGLEABLE.has(domain)) return { key: state === 'on' ? 'on' : 'off' };
  if (domain === 'binary_sensor') {
    const on = state === 'on';
    if (OPENINGS.has(attributes.device_class)) return { key: on ? 'open' : 'closed' };
    if (PRESENCE.has(attributes.device_class)) return { key: on ? 'motion' : 'calm' };
    return { key: on ? 'on' : 'off' };
  }
  if (NUMBER.test(state)) {
    const unit = String(attributes.unit_of_measurement ?? '').trim();
    return { text: unit ? `${decimal(Number(state), lang)} ${unit}` : decimal(Number(state), lang) };
  }
  if (!state) return { text: '–' };
  if (domain !== 'sensor' && STATES.has(state)) return { key: state };
  return { text: state };
}

// An icon from the sprite in web/index.html: bulb, temp, washer or home.
export function iconFor({ id, name, domain, attributes = {} }) {
  if (domain === 'light') return 'bulb';
  if (attributes.device_class === 'temperature' || attributes.unit_of_measurement === '°C') return 'temp';
  if (/wash|laundry/i.test(`${id} ${name}`)) return 'washer';
  return 'home';
}

// One configured entity and its entry from /api/states (undefined when Home
// Assistant does not know the id) → one item of the widget data.
export function toItem({ id, label }, entry, lang = 'en') {
  const domain = domainOf(id);
  const attributes = entry?.attributes && typeof entry.attributes === 'object' ? entry.attributes : {};
  const state = entry ? String(entry.state ?? 'unknown') : 'unavailable';
  const name = label || String(attributes.friendly_name ?? '').trim() || id;
  const toggleable = TOGGLEABLE.has(domain);
  return {
    id,
    name,
    domain,
    state,
    display: displayFor({ domain, state, attributes }, lang),
    toggleable,
    on: toggleable || domain === 'binary_sensor' ? state === 'on' : null,
    icon: iconFor({ id, name, domain, attributes }),
    missing: !entry,
  };
}

// states: the array from GET /api/states, entities: parseEntities() output
export function toWidgetData(states, entities, lang = 'en') {
  if (!Array.isArray(states)) throw new Error('Home Assistant: unexpected answer from /api/states');
  const byId = new Map();
  for (const entry of states) if (typeof entry?.entity_id === 'string') byId.set(entry.entity_id, entry);
  return { entities: entities.map((entity) => toItem(entity, byId.get(entity.id), lang)) };
}

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });

// The payload of the toggle action → the entity id to toggle. Only configured
// entities of a switchable domain pass; anything else is a 400.
export function toggleTarget(payload, entities) {
  const id = payload && typeof payload === 'object' ? payload.id : undefined;
  if (typeof id !== 'string' || !id) throw badRequest('The toggle action expects { "id": "<entity_id>" }');
  if (!entities.some((entity) => entity.id === id)) throw badRequest('This entity is not listed in REFRAME_HA_ENTITIES');
  if (!TOGGLEABLE.has(domainOf(id))) throw badRequest('This entity cannot be switched');
  return id;
}

const authorization = (token) => ({ authorization: `Bearer ${token}` });

// Requests through ctx.fetchJson; the token never reaches an error message.
async function call(ctx, url, token, options) {
  try {
    return await ctx.fetchJson(url, options);
  } catch (error) {
    let message = String(error?.message ?? error);
    if (token) message = message.split(token).join('…');
    if (/HTTP 401\b/.test(message)) message += ' (check REFRAME_HA_TOKEN)';
    throw new Error(message);
  }
}

// Demo: the four entities of the example in the header, the light's state in
// memory so the toggle action works without Home Assistant.
const DEMO_ENTITIES = parseEntities(
  'light.living_room=Living room, sensor.living_room_temperature=Inside, sensor.washer_remaining=Laundry, binary_sensor.balcony_door=Balcony door',
);
const demoOn = new Map([['light.living_room', true]]);

const demoStates = () => [
  {
    entity_id: 'light.living_room',
    state: demoOn.get('light.living_room') ? 'on' : 'off',
    attributes: { friendly_name: 'Living room ceiling', supported_color_modes: ['brightness'], supported_features: 32 },
  },
  {
    entity_id: 'sensor.living_room_temperature',
    state: '21.5',
    attributes: { friendly_name: 'Living room temperature', unit_of_measurement: '°C', device_class: 'temperature' },
  },
  {
    entity_id: 'sensor.washer_remaining',
    state: '32',
    attributes: { friendly_name: 'Washer time left', unit_of_measurement: 'min', device_class: 'duration' },
  },
  { entity_id: 'binary_sensor.balcony_door', state: 'off', attributes: { friendly_name: 'Balcony door', device_class: 'door' } },
];

export default {
  id: 'home',
  intervalMs: 30_000,
  isConfigured: (config) =>
    Boolean(setting(config, 'REFRAME_HA_URL')) &&
    Boolean(setting(config, 'REFRAME_HA_TOKEN')) &&
    hasEntities(setting(config, 'REFRAME_HA_ENTITIES')),

  async fetch(ctx) {
    const { url, token, entities } = readSettings(ctx.config);
    const states = await call(ctx, `${url}/api/states`, token, { headers: authorization(token) });
    return toWidgetData(states, entities, ctx.config.lang);
  },

  demo: ({ config }) => toWidgetData(demoStates(), DEMO_ENTITIES, config.lang),

  actions: {
    async toggle(ctx) {
      if (ctx.demo) {
        const id = toggleTarget(ctx.payload, DEMO_ENTITIES);
        demoOn.set(id, !demoOn.get(id));
        return { id };
      }
      const { url, token, entities } = readSettings(ctx.config);
      const id = toggleTarget(ctx.payload, entities);
      await call(ctx, `${url}/api/services/homeassistant/toggle`, token, {
        method: 'POST',
        headers: { ...authorization(token), 'content-type': 'application/json' },
        body: JSON.stringify({ entity_id: id }),
      });
      return { id };
    },
  },
};
