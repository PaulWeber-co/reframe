// Services: everything hosted on this machine – Umbrel apps and your own
// docker compose projects (front end, back end, database …) – with its
// state, CPU, memory and how long it has been running.
//
// The containers come from host/reframe-services.py, a small collector that
// asks Docker and writes a JSON file; the dashboard server never touches the
// Docker socket itself. The collector is an optional extra (compose profile
// "services"); without it the tile stays hidden. One compose project (one
// Umbrel app) becomes one entry, its containers are counted.
//
// Settings:
//   REFRAME_SERVICES_FILE    default /run/reframe/services.json
//   REFRAME_SERVICES_NAMES   display names, e.g. "immich=Photos,shop-api=Shop API"
//   REFRAME_SERVICES_HIDE    project names to leave out, comma-separated
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export const DEFAULT_FILE = '/run/reframe/services.json';
const STALE_INTERVALS = 4; // this many missed samples: the data counts as stale

// Names for projects whose id does not read well
const KNOWN = { 'reframe-airplay': 'AirPlay', 'home-assistant': 'Home Assistant', immich: 'Immich', nextcloud: 'Nextcloud' };

// "a=One, b = Two" → Map { a → "One", b → "Two" }
export function parseNames(text) {
  const names = new Map();
  for (const part of String(text ?? '').split(',')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const id = part.slice(0, eq).trim();
    const name = part.slice(eq + 1).trim();
    if (id && name) names.set(id, name);
  }
  return names;
}

const parseList = (text) => new Set(String(text ?? '').split(',').map((s) => s.trim()).filter(Boolean));

// "shop-api_db" → "Shop Api Db"
export const prettyName = (id) =>
  (Object.hasOwn(KNOWN, id) ? KNOWN[id] : null) ?? String(id).replace(/[-_]+/g, ' ').trim().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

// A container that finished its job (an init or migration step) is fine;
// one that should be up and is not is a problem.
const ALWAYS = new Set(['always', 'unless-stopped']);
const isDone = (c) => c.state === 'exited' && c.exitCode === 0 && !ALWAYS.has(c.restartPolicy);
const isUp = (c) => c.state === 'running' && c.health !== 'unhealthy';

// One project: 'ok' all up, 'warn' partly up or unhealthy, 'down' nothing runs
export function toService(id, containers, names = new Map(), now = Date.now()) {
  const running = containers.filter((c) => c.state === 'running');
  const expected = containers.filter((c) => !isDone(c));
  const bad = expected.filter((c) => !isUp(c));
  const status = !running.length ? 'down' : bad.length ? 'warn' : 'ok';
  const sum = (key) => {
    const values = running.map((c) => c[key]).filter(Number.isFinite);
    return values.length ? values.reduce((a, b) => a + b, 0) : null;
  };
  // Since the most recent (re)start of any of its containers
  const started = running.map((c) => Date.parse(c.startedAt)).filter(Number.isFinite);
  const startedAt = started.length ? Math.max(...started) : null;
  // What is wrong, for the browser to word: { service, state: 'unhealthy' | 'restarting' | 'stopped' }
  const problem = bad[0] ? { service: bad[0].service, state: bad[0].health === 'unhealthy' ? 'unhealthy' : bad[0].state === 'restarting' ? 'restarting' : 'stopped' } : null;
  const cpu = sum('cpuPercent');
  return {
    id,
    name: names.get(id) ?? prettyName(id),
    scope: containers[0]?.scope ?? 'host',
    status,
    running: running.length,
    total: expected.length || containers.length,
    cpuPercent: cpu === null ? null : Math.round(cpu * 10) / 10,
    memBytes: sum('memBytes'),
    uptimeSeconds: startedAt === null ? null : Math.max(0, Math.round((now - startedAt) / 1000)),
    problem,
  };
}

const ORDER = { warn: 0, down: 1, ok: 2 };

// The helper's file → tile data: problems first, then the busiest
export function toWidgetData(sample, { names = new Map(), hide = new Set(), now = Date.now() } = {}) {
  if (!sample || !Array.isArray(sample.containers)) throw new Error('services.json has an unexpected format');
  const interval = Number(sample.intervalSeconds) > 0 ? Number(sample.intervalSeconds) : 30;
  if (!(now - Number(sample.capturedAt) < STALE_INTERVALS * interval * 1000)) {
    throw new Error('No current values from the services collector (is the "services" profile running?)');
  }
  const projects = new Map();
  for (const container of sample.containers) {
    const key = String(container.project ?? container.name ?? '');
    if (!key || hide.has(key)) continue;
    if (!projects.has(key)) projects.set(key, []);
    projects.get(key).push(container);
  }
  const services = [...projects]
    .map(([id, containers]) => toService(id, containers, names, now))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0) || a.name.localeCompare(b.name));
  const umbrel = sample.sources?.umbrel;
  return {
    services,
    counts: {
      ok: services.filter((s) => s.status === 'ok').length,
      warn: services.filter((s) => s.status === 'warn').length,
      down: services.filter((s) => s.status === 'down').length,
    },
    // Umbrel's own Docker could not be asked (Umbrel starts or updates)
    umbrelError: umbrel && !umbrel.ok ? String(umbrel.error ?? 'unreachable') : null,
  };
}

const options = (config, now) => ({
  names: parseNames(config.get('REFRAME_SERVICES_NAMES')),
  hide: parseList(config.get('REFRAME_SERVICES_HIDE')),
  now,
});

const MIB = 1024 ** 2;
const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const demoSample = () => ({
  capturedAt: Date.now(),
  intervalSeconds: 30,
  sources: { host: { ok: true, error: null }, umbrel: { ok: true, error: null } },
  containers: [
    { scope: 'umbrel', project: 'immich', service: 'server', state: 'running', cpuPercent: 4.2, memBytes: 640 * MIB, startedAt: ago(9 * 86_400) },
    { scope: 'umbrel', project: 'immich', service: 'postgres', state: 'running', health: 'healthy', cpuPercent: 0.6, memBytes: 210 * MIB, startedAt: ago(9 * 86_400) },
    { scope: 'umbrel', project: 'home-assistant', service: 'server', state: 'running', cpuPercent: 1.4, memBytes: 380 * MIB, startedAt: ago(3 * 86_400) },
    { scope: 'host', project: 'shop', service: 'web', state: 'running', cpuPercent: 0.3, memBytes: 85 * MIB, startedAt: ago(5 * 3600) },
    { scope: 'host', project: 'shop', service: 'api', state: 'running', cpuPercent: 2.1, memBytes: 160 * MIB, startedAt: ago(5 * 3600) },
    { scope: 'host', project: 'shop', service: 'db', state: 'running', health: 'unhealthy', cpuPercent: 0.9, memBytes: 290 * MIB, startedAt: ago(40 * 60) },
    { scope: 'host', project: 'reframe-airplay', service: 'shairport-sync', state: 'running', cpuPercent: 0.2, memBytes: 24 * MIB, startedAt: ago(9 * 86_400) },
  ],
});

export default {
  id: 'services',
  intervalMs: 30_000,
  isConfigured: (config) => existsSync(config.get('REFRAME_SERVICES_FILE', DEFAULT_FILE)),

  async fetch(ctx) {
    const sample = JSON.parse(await readFile(ctx.config.get('REFRAME_SERVICES_FILE', DEFAULT_FILE), 'utf8'));
    return toWidgetData(sample, options(ctx.config, ctx.now().getTime()));
  },

  demo: (ctx) => toWidgetData(demoSample(), options(ctx.config, Date.now())),
};
