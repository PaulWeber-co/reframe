// The language files: same keys in both languages, every key the code asks for
// exists, placeholders match, and render functions follow the chosen language.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GROUPS, SETTINGS } from '../server/settings.js';
import { getLanguage, plural, t } from '../web/js/i18n.js';
import { render as renderWeather } from '../web/js/widgets/weather.js';
import weather from '../server/widgets/weather.js';

const web = fileURLToPath(new URL('../web/', import.meta.url));
const load = (lang) => JSON.parse(readFileSync(join(web, 'i18n', `${lang}.json`), 'utf8'));
const en = load('en');
const de = load('de');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

test('both languages have exactly the same keys and placeholders', () => {
  assert.deepEqual(Object.keys(de).sort(), Object.keys(en).sort());
  const holders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const key of Object.keys(en)) {
    assert.deepEqual(holders(de[key]), holders(en[key]), `placeholders of ${key}`);
    assert.ok(en[key].trim() && de[key].trim(), `${key} is not empty`);
  }
});

test('the English file is English', () => {
  for (const [key, text] of Object.entries(en)) assert.doesNotMatch(text, /[äöüß]/, `${key}: ${text}`);
});

// Keys written out in the code: t('a.b'), plural('a.b', …), labelKey = 'a.b',
// data-i18n="a.b" and data-i18n-label="a.b"
function usedKeys() {
  const keys = new Set();
  for (const file of walk(join(web, 'js')).filter((name) => name.endsWith('.js'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\bt\(\s*'([a-zA-Z][\w.]*)'/g)) keys.add(match[1]);
    for (const match of text.matchAll(/\bplural\(\s*'([a-zA-Z][\w.]*)'/g)) keys.add(`${match[1]}.one`).add(`${match[1]}.other`);
    for (const match of text.matchAll(/labelKey = '([\w.]+)'/g)) keys.add(match[1]);
  }
  for (const file of readdirSync(web).filter((name) => name.endsWith('.html'))) {
    const text = readFileSync(join(web, file), 'utf8');
    for (const match of text.matchAll(/data-i18n(?:-label)?="([\w.]+)"/g)) keys.add(match[1]);
  }
  return keys;
}

test('every key the code asks for exists', () => {
  const used = usedKeys();
  assert.ok(used.size > 100, `found ${used.size} keys in the code`);
  const missing = [...used].filter((key) => !Object.hasOwn(en, key));
  assert.deepEqual(missing, []);
});

test('keys built at run time: every value they can take exists', () => {
  const need = (...keys) => assert.deepEqual(keys.filter((key) => !Object.hasOwn(en, key)), []);
  // server/widgets/weather.js conditions
  need(...['clear', 'mostly_clear', 'partly_cloudy', 'overcast', 'fog', 'drizzle', 'rain', 'snow', 'showers', 'snow_showers', 'thunderstorm', 'unknown'].map((key) => `weather.${key}`));
  // display states, modes, "outside the schedule" choices, quick actions, units
  need(...['on', 'night', 'sleep', 'off'].map((key) => `control.display.${key}`));
  need(...['auto', 'on', 'off'].flatMap((key) => [`control.mode.${key}`, `control.mode.${key}.hint`]));
  need(...['night', 'sleep', 'off'].map((key) => `control.outside.${key}`), ...['sleep', 'off'].map((key) => `control.away.${key}`));
  need(...['on', 'sleep', 'off', 'offUntilMorning'].flatMap((key) => [`control.quick.${key}`, `control.quick.${key}.note`]));
  need(...['running', 'stopped', 'starting', 'failed', 'unknown'].map((key) => `control.unit.${key}`));
  // the reasons server/control.js gives
  need(...['manual_on', 'manual_night', 'manual_sleep', 'manual_off', 'quiet_hours', 'on_battery', 'always_on', 'server_only', 'touched', 'music_playing', 'nobody_home', 'scheduled', 'room_dark'].map((key) => `control.reason.${key}`));
  // server/widgets/home.js and services.js
  need(...['unreachable', 'on', 'off', 'open', 'closed', 'motion', 'calm', 'opening', 'closing', 'locked', 'unlocked', 'home', 'not_home', 'playing', 'paused'].map((key) => `home.state.${key}`));
  need(...['ok', 'warn', 'down'].map((key) => `services.status.${key}`), ...['unhealthy', 'restarting', 'stopped'].map((key) => `services.problem.${key}`));
  // wiki headings
  need('wiki.onThisDay', 'wiki.didYouKnow', 'wiki.article');
  // the setup page: a label and a hint for each setting, a name for each group
  need(...SETTINGS.flatMap((field) => [`settings.${field.key}`, `settings.${field.key}.hint`]));
  need(...GROUPS.map((group) => `setup.group.${group}`));
  need(...SETTINGS.filter((field) => field.type === 'select').flatMap((field) => field.options.map((option) => `settings.${field.key}.${option}`)));
});

test('t() fills placeholders and shows a missing key as itself; plural() picks the form', () => {
  assert.equal(getLanguage(), 'en');
  assert.equal(t('weather.rainFrom', { time: '5 PM' }), 'rain from 5 PM');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(t('weather.rainFrom'), 'rain from {time}', 'a missing parameter stays visible');
  assert.equal(plural('photos.videos', 1, { count: 1 }), '1 video');
  assert.equal(plural('photos.videos', 5, { count: 5 }), '5 videos');
});

test('the same data reads in German after switching the language', () => {
  const data = weather.demo({ config: { place: 'Berlin' } });
  const english = renderWeather(data);
  assert.match(english, /Weather/);
  assert.match(english, /Partly cloudy, rain from 5 PM/);
  globalThis.__reframeLoadLanguage('de');
  try {
    const german = renderWeather(data);
    assert.match(german, /Wetter/);
    assert.match(german, /Teils bewölkt, ab 17 Uhr Regen/);
    assert.equal(plural('photos.videos', 1, { count: 1 }), '1 Video');
  } finally {
    globalThis.__reframeLoadLanguage('en');
  }
});
