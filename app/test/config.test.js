import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../server/config.js';
import { validateSettings } from '../server/settings.js';

const quiet = { warn() {}, log() {}, error() {} };

function withDataDir(files, run) {
  const dir = mkdtempSync(join(tmpdir(), 'reframe-config-'));
  try {
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('defaults: English, no place, UTC, demo off', () => {
  withDataDir({}, (dir) => {
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir }, log: quiet });
    assert.equal(config.lang, 'en');
    assert.equal(config.place, '');
    assert.equal(Number.isNaN(config.lat), true, 'no default place: the weather tile shows its sample');
    assert.equal(config.timezone, 'UTC');
    assert.equal(config.port, 7777);
    assert.equal(config.glassLevel, 55);
    assert.equal(config.demo, false);
    assert.equal(loadConfig({ argv: ['--demo'], env: { REFRAME_DATA_DIR: dir }, log: quiet }).demo, true);
  });
});

test('an environment variable wins over config.json, which wins over the default', () => {
  withDataDir({ 'config.json': JSON.stringify({ REFRAME_PLACE: 'Lyon', REFRAME_LANG: 'de', REFRAME_PORT: '9000' }) }, (dir) => {
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir, REFRAME_PLACE: 'Oslo', HOME: '/x' }, log: quiet });
    assert.equal(config.place, 'Oslo');
    assert.equal(config.lang, 'de');
    assert.equal(config.port, 9000);
    assert.equal(config.get('HOME', 'unset'), 'unset', 'only REFRAME_ keys count');
  });
});

test('a broken config.json is ignored with a warning', () => {
  withDataDir({ 'config.json': '{ not json' }, (dir) => {
    const warnings = [];
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir }, log: { warn: (message) => warnings.push(message) } });
    assert.equal(config.place, '');
    assert.equal(warnings.length, 1);
  });
});

test('update() saves valid settings, applies them at once and clears empty ones', () => {
  withDataDir({}, (dir) => {
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir }, log: quiet });
    config.update({ REFRAME_PLACE: ' Berlin ', REFRAME_LAT: '52.52', REFRAME_LON: 13.405, REFRAME_TIMEZONE: 'Europe/Berlin', REFRAME_LANG: 'de' });
    assert.equal(config.place, 'Berlin');
    assert.equal(config.lat, 52.52);
    assert.equal(config.lon, 13.405);
    assert.equal(config.timezone, 'Europe/Berlin');
    assert.equal(config.lang, 'de');
    const file = join(dir, 'config.json');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      REFRAME_PLACE: 'Berlin',
      REFRAME_LAT: '52.52',
      REFRAME_LON: '13.405',
      REFRAME_TIMEZONE: 'Europe/Berlin',
      REFRAME_LANG: 'de',
    });
    assert.equal(statSync(file).mode & 0o077, 0, 'the file may hold secrets: readable by its owner only');

    config.update({ REFRAME_PLACE: '', REFRAME_LANG: null });
    assert.equal(config.place, '');
    assert.equal(config.lang, 'en');
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).REFRAME_PLACE, undefined);

    // A new process reads what was saved
    assert.equal(loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir }, log: quiet }).timezone, 'Europe/Berlin');
  });
});

test('describe() never returns a secret and marks what the environment fixes', () => {
  withDataDir({ 'config.json': JSON.stringify({ REFRAME_TOMTOM_KEY: 'super-secret', REFRAME_PLACE: 'Lyon' }) }, (dir) => {
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir, REFRAME_HA_URL: 'http://ha.local:8123' }, log: quiet });
    const fields = Object.fromEntries(config.describe().map((field) => [field.key, field]));
    assert.deepEqual(fields.REFRAME_TOMTOM_KEY, { key: 'REFRAME_TOMTOM_KEY', group: 'commute', type: 'secret', options: undefined, locked: false, set: true, value: '' });
    assert.equal(fields.REFRAME_PLACE.value, 'Lyon');
    assert.equal(fields.REFRAME_HA_URL.locked, true);
    assert.equal(fields.REFRAME_IMMICH_URL.set, false);
    assert.ok(!JSON.stringify(config.describe()).includes('super-secret'));
  });
});

test('addresses are as private as keys: the settings page never reads them back', () => {
  withDataDir({ 'config.json': JSON.stringify({ REFRAME_HOME_ADDRESS: 'Example Street 1', REFRAME_WORK_ADDRESS: 'Office Road 2', REFRAME_PLACE: 'Berlin' }) }, (dir) => {
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir }, log: quiet });
    const described = JSON.stringify(config.describe());
    assert.ok(!described.includes('Example Street') && !described.includes('Office Road'));
    const fields = Object.fromEntries(config.describe().map((field) => [field.key, field]));
    assert.equal(fields.REFRAME_HOME_ADDRESS.set, true, 'it says that one is saved');
    assert.equal(fields.REFRAME_PLACE.value, 'Berlin', 'a place name is not private');
  });
});

test('validateSettings rejects unknown keys and bad values, nothing is half-saved', () => {
  assert.throws(() => validateSettings({ REFRAME_NOPE: 'x' }), /Unknown setting/);
  assert.throws(() => validateSettings([]), /JSON object/);
  assert.throws(() => validateSettings({ REFRAME_LANG: 'fr' }), /must be one of en, de/);
  assert.throws(() => validateSettings({ REFRAME_LAT: '95' }), /from -90 to 90/);
  assert.throws(() => validateSettings({ REFRAME_LON: 'abc' }), /must be a number/);
  assert.throws(() => validateSettings({ REFRAME_TIMEZONE: 'Mars/Olympus' }), /unknown time zone/);
  assert.throws(() => validateSettings({ REFRAME_HA_URL: 'ha.local' }), /http:\/\/ or https:\/\//);
  assert.throws(() => validateSettings({ REFRAME_PLACE: 'x'.repeat(3000) }), /too long/);
  assert.throws(() => validateSettings({ REFRAME_PLACE: 42 }), /expected text/);
  assert.deepEqual(validateSettings({ REFRAME_PLACE: '   ', REFRAME_PIN: null }), { REFRAME_PLACE: null, REFRAME_PIN: null });

  withDataDir({}, (dir) => {
    const config = loadConfig({ argv: [], env: { REFRAME_DATA_DIR: dir }, log: quiet });
    assert.throws(() => config.update({ REFRAME_PLACE: 'Rome', REFRAME_LAT: '999' }), /from -90 to 90/);
    assert.equal(config.place, '', 'the valid half was not saved either');
  });
});

test('glass level from the environment is clamped to the supported range', () => {
  const config = loadConfig({ argv: [], env: { REFRAME_GLASS: '130', REFRAME_DATA_DIR: '/nonexistent' }, log: quiet });
  assert.equal(config.glassLevel, 100);
});
