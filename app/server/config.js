// Settings. A value is looked up in this order:
//
//   1. an environment variable REFRAME_<NAME> (compose file, docker run)
//   2. <data dir>/config.json, written by the setup page
//   3. the default in the code
//
// Variables win so that a compose file can pin a value; the setup page then
// shows the field as locked. Widgets read their settings with config.get() and
// config.num() on every run, so a change on the setup page applies at once.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS, validateSettings } from './settings.js';

export const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
// The version in app/package.json, shown on the setup page
export const VERSION = (() => {
  try {
    return JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8')).version ?? '';
  } catch {
    return '';
  }
})();
const CONFIG_FILE = 'config.json';

function readSaved(dataDir, log) {
  try {
    const saved = JSON.parse(readFileSync(join(dataDir, CONFIG_FILE), 'utf8'));
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch (error) {
    if (error.code !== 'ENOENT') log.warn(`[config] ${CONFIG_FILE} is not usable (${error.message}), ignoring it`);
    return {};
  }
}

export function loadConfig({ argv = process.argv.slice(2), env = process.env, log = console } = {}) {
  const dataDir = env.REFRAME_DATA_DIR || join(APP_DIR, 'data');
  const fromEnv = Object.fromEntries(Object.entries(env).filter(([key, value]) => key.startsWith('REFRAME_') && value !== undefined));
  let saved = readSaved(dataDir, log);

  const raw = (key) => (fromEnv[key] !== undefined && fromEnv[key] !== '' ? fromEnv[key] : saved[key]);
  const get = (key, fallback = '') => {
    const value = raw(key);
    return value !== undefined && value !== '' && value !== null ? String(value) : fallback;
  };
  const num = (key, fallback) => {
    const text = get(key, '');
    const value = Number(text);
    return text === '' || Number.isNaN(value) ? fallback : value;
  };

  return {
    get,
    num,
    dataDir,
    demo: argv.includes('--demo') || get('REFRAME_DEMO') === '1',
    port: num('REFRAME_PORT', 7777),
    host: get('REFRAME_HOST', '0.0.0.0'),
    mediaDir: get('REFRAME_MEDIA_DIR', join(APP_DIR, 'media')),
    ambientFile: get('REFRAME_AMBIENT_FILE', '/run/reframe/ambient.json'),

    get lang() {
      return get('REFRAME_LANG', 'en') === 'de' ? 'de' : 'en';
    },
    get place() {
      return get('REFRAME_PLACE', '');
    },
    get lat() {
      return num('REFRAME_LAT', NaN);
    },
    get lon() {
      return num('REFRAME_LON', NaN);
    },
    get timezone() {
      return get('REFRAME_TIMEZONE', 'UTC');
    },
    get glassLevel() {
      return Math.round(Math.min(100, Math.max(0, num('REFRAME_GLASS', 55))));
    },

    // What the setup page shows: every setting with its value, except secrets,
    // which only report whether they are set.
    describe() {
      return SETTINGS.map((field) => {
        const locked = fromEnv[field.key] !== undefined && fromEnv[field.key] !== '';
        const value = raw(field.key);
        const set = value !== undefined && value !== '' && value !== null;
        return {
          key: field.key,
          group: field.group,
          type: field.type,
          options: field.options,
          locked,
          set,
          value: field.type === 'secret' || !set ? '' : String(value),
        };
      });
    },

    // Saves changed settings: { KEY: 'value' } sets, { KEY: null } clears.
    // Throws a 400 for an unknown key or a bad value; nothing is saved then.
    update(changes) {
      const clean = validateSettings(changes);
      const next = { ...saved };
      for (const [key, value] of Object.entries(clean)) {
        if (value === null) delete next[key];
        else next[key] = value;
      }
      mkdirSync(dataDir, { recursive: true });
      const file = join(dataDir, CONFIG_FILE);
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      renameSync(tmp, file);
      saved = next;
      return Object.keys(clean);
    },
  };
}
