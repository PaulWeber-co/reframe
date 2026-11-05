// HTTP side of the dashboard, built on node:http without dependencies:
//
//   GET  /                         the front end from web/
//   GET  /control                  the control center as a page of its own (phone, laptop)
//   GET  /setup                    the setup page: place, calendars, integrations
//   GET  /media/<file>             background videos (with Range support for Safari)
//   GET  /api/state                settings, the latest data of every widget, the layout,
//                                  the control center, this browser's access and the
//                                  background clips on disk
//   GET  /api/events               Server-Sent Events: "widget", "layout", "settings"
//                                  and "control" updates
//   PUT  /api/settings             save shared dashboard appearance settings
//   GET  /api/layout               the saved layout (or the default)
//   PUT  /api/layout               save a layout from edit mode
//   POST /api/widgets/<id>/actions/<name>   e.g. toggle a light, tick off a to-do
//   GET  /api/config               every setting with its value (secrets only say whether they are set)
//   PUT  /api/config               { KEY: value } saves settings; they apply at once
//   GET  /api/geocode?q=<name>     place search for the setup page (Open-Meteo, no key)
//   GET  /api/control              display state and settings of the control center
//   PUT  /api/control              change control settings (only the fields sent)
//   POST /api/control/override     { state, minutes } / { state, until: "morning" } / { clear: true }
//   POST /api/control/wake         a tap on the dark kiosk screen
//   POST /api/unlock               { pin } when a PIN is set
//
// Every request passes the checks in access.js first: a known host name,
// changes only as same-origin JSON, and the PIN for other devices if set.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { createAccess, isSameOrigin } from './access.js';
import { listBackgrounds } from './backgrounds.js';
import { validateLayout } from './layout.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
};

// On every response: no sniffing, no framing (clickjacking), no referrer.
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
};
// Pages may only run their own scripts and talk to their own server. Inline
// style attributes stay allowed (widget bars), inline scripts do not.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; " +
  "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// Short names for pages: /control → control.html
const PAGES = { '/': 'index.html', '/control': 'control.html', '/setup': 'setup.html' };
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function createApp({ hub, store, config, webDir, defaultLayout, control = null, access = createAccess({ config, store }) }) {
  const clients = new Set();
  const broadcast = (event, data) => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const unsubscribe = hub.subscribe((entry) => broadcast('widget', entry));
  const unsubscribeControl = control?.subscribe((snapshot) => broadcast('control', snapshot)) ?? (() => {});
  // Keeps idle connections open through proxies and lets dead ones fail.
  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  // A saved layout predates widgets added since: they join "hidden", so edit
  // mode offers them instead of leaving them out without a way back.
  const loadLayout = async () => {
    const saved = await store.read('layout.json', null);
    if (!saved) return defaultLayout;
    const known = new Set([...(saved.tiles ?? []).map((tile) => tile.id), ...(saved.hidden ?? [])]);
    const missing = [...defaultLayout.tiles.map((tile) => tile.id), ...(defaultLayout.hidden ?? [])].filter((id) => !known.has(id));
    return missing.length ? { ...saved, hidden: [...(saved.hidden ?? []), ...missing] } : saved;
  };
  const loadSettings = async () => {
    const saved = await store.read('settings.json', null);
    const value = Number(saved?.glassLevel);
    const fallback = Number.isFinite(config.glassLevel) ? config.glassLevel : 55;
    const glassLevel = Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : fallback;
    return { glassLevel };
  };

  // Host, content type, origin and PIN; see access.js
  async function guard(req, path) {
    if (!access.isAllowedHost(req.headers.host)) {
      throw new HttpError(403, 'Unknown host name. Add your own names to REFRAME_ALLOWED_HOSTS.');
    }
    if (!path.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') return;
    if (!/^application\/json(;|$)/i.test(String(req.headers['content-type'] ?? '').trim())) {
      throw new HttpError(415, 'Changes only as JSON (content-type: application/json)');
    }
    if (req.headers.origin !== undefined && !isSameOrigin(req.headers.origin, req.headers.host)) {
      throw new HttpError(403, 'Changes only from the dashboard itself');
    }
    if (path !== '/api/unlock' && !(await access.canChange(req))) {
      throw new HttpError(401, 'Locked: please enter the PIN in the control center');
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://dashboard');
    let path;
    try {
      path = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Invalid path');
    }
    await guard(req, path);

    if (path === '/api/state' && req.method === 'GET') {
      return sendJson(res, 200, {
        lang: config.lang,
        place: config.place,
        timezone: config.timezone,
        demo: config.demo,
        settings: await loadSettings(),
        widgets: hub.snapshot(),
        layout: await loadLayout(),
        control: control?.snapshot() ?? null,
        access: await access.status(req),
        backgrounds: await listBackgrounds(config.mediaDir),
      });
    }

    if (path === '/api/unlock' && req.method === 'POST') {
      const payload = await readObject(req);
      const cookie = await access.unlock(req, payload.pin);
      if (cookie) res.setHeader('set-cookie', cookie);
      return sendJson(res, 200, { ...(await access.status(req)), locked: false });
    }

    if (path.startsWith('/api/control')) {
      if (!control) throw new HttpError(404, 'Control center not available');
      if (path === '/api/control' && req.method === 'GET') return sendJson(res, 200, control.snapshot());
      if (path === '/api/control' && req.method === 'PUT') return sendJson(res, 200, await control.update(await readObject(req)));
      if (path === '/api/control/override' && req.method === 'POST') return sendJson(res, 200, await control.override(await readObject(req)));
      if (path === '/api/control/wake' && req.method === 'POST') return sendJson(res, 200, await control.wake());
      throw new HttpError(404, 'Unknown endpoint');
    }

    if (path === '/api/settings' && req.method === 'PUT') {
      const payload = await readObject(req);
      if (!Number.isInteger(payload.glassLevel) || payload.glassLevel < 0 || payload.glassLevel > 100) {
        throw new HttpError(400, 'glassLevel must be an integer from 0 to 100');
      }
      const settings = { glassLevel: payload.glassLevel };
      await store.write('settings.json', settings);
      broadcast('settings', settings);
      return sendJson(res, 200, settings);
    }

    if (path === '/api/events' && req.method === 'GET') {
      res.writeHead(200, { ...SECURITY_HEADERS, 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      res.write('retry: 5000\n\n');
      res.write(`event: settings\ndata: ${JSON.stringify(await loadSettings())}\n\n`);
      if (control) res.write(`event: control\ndata: ${JSON.stringify(control.snapshot())}\n\n`);
      for (const entry of Object.values(hub.snapshot())) res.write(`event: widget\ndata: ${JSON.stringify(entry)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (path === '/api/layout') {
      if (req.method === 'GET') return sendJson(res, 200, await loadLayout());
      if (req.method === 'PUT') {
        const layout = await readJson(req);
        const problem = validateLayout(layout);
        if (problem) throw new HttpError(400, `Invalid layout: ${problem}`);
        const clean = { tiles: layout.tiles.map(({ id, col, row, w, h }) => ({ id, col, row, w, h })), hidden: layout.hidden ?? [] };
        await store.write('layout.json', clean);
        broadcast('layout', clean);
        return sendJson(res, 200, clean);
      }
    }

    const action = path.match(/^\/api\/widgets\/([a-z0-9-]+)\/actions\/([a-zA-Z0-9-]+)$/);
    if (action && req.method === 'POST') {
      const payload = await readObject(req);
      const result = await hub.action(action[1], action[2], payload);
      return sendJson(res, 200, { ok: true, result });
    }

    if (path === '/api/config') {
      if (req.method === 'GET') return sendJson(res, 200, { fields: config.describe() });
      if (req.method === 'PUT') {
        const payload = await readObject(req);
        config.update(payload);
        // Widgets fetch again now; the response does not wait for the networks
        hub.refreshAll().catch(() => {});
        broadcast('config', { lang: config.lang });
        return sendJson(res, 200, { fields: config.describe() });
      }
    }

    if (path === '/api/geocode' && req.method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').trim();
      if (query.length < 2 || query.length > 80) return sendJson(res, 200, { results: [] });
      const params = new URLSearchParams({ name: query, count: '6', language: config.lang, format: 'json' });
      const found = config.demo ? { results: [] } : await hub.ctx.fetchJson(`${GEOCODE}?${params}`);
      const results = (found.results ?? []).map((place) => ({
        name: place.name,
        region: [place.admin1, place.country].filter(Boolean).join(', '),
        lat: Math.round(place.latitude * 1e4) / 1e4,
        lon: Math.round(place.longitude * 1e4) / 1e4,
        timezone: place.timezone ?? '',
      }));
      return sendJson(res, 200, { results });
    }

    if (path.startsWith('/api/')) throw new HttpError(404, 'Unknown endpoint');
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    if (path.startsWith('/media/')) return serveFile(req, res, config.mediaDir, path.slice('/media/'.length), 'public, max-age=86400');
    return serveFile(req, res, webDir, PAGES[path] ?? path.slice(1), 'no-cache');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error.status ?? 500;
      if (status >= 500) console.error(error);
      if (res.headersSent) return res.end();
      sendJson(res, status, { error: error.message });
    });
  });
  server.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    unsubscribeControl();
    for (const res of clients) res.end();
    clients.clear();
  });
  return server;
}

export function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...SECURITY_HEADERS, 'content-type': TYPES['.json'], 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

export async function readJson(req, limit = 256 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'Not valid JSON');
  }
}

// A request body that must be a JSON object (actions, settings, control)
export async function readObject(req) {
  const value = await readJson(req);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Expected a JSON object');
  return value;
}

async function serveFile(req, res, root, relative, cacheControl) {
  const file = normalize(join(root, relative));
  if (file !== root && !file.startsWith(root.endsWith(sep) ? root : root + sep)) throw new HttpError(404, 'Not found');
  let info;
  try {
    info = await stat(file);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  if (!info.isFile()) throw new HttpError(404, 'Not found');

  const type = extname(file).toLowerCase();
  const headers = {
    ...SECURITY_HEADERS,
    ...(type === '.html' ? { 'content-security-policy': CSP } : {}),
    'content-type': TYPES[type] ?? 'application/octet-stream',
    'accept-ranges': 'bytes',
    'cache-control': cacheControl,
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : info.size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : info.size - 1;
    start = Math.max(0, start);
    end = Math.min(end, info.size - 1);
    if (start > end) {
      res.writeHead(416, { 'content-range': `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${info.size}`, 'content-length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { ...headers, 'content-length': info.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}
