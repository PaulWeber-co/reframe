import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import weather, { compass, describe, toWidgetData } from '../server/widgets/weather.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/open-meteo.json', import.meta.url), 'utf8'));

test('WMO codes map to a condition key and an icon', () => {
  assert.deepEqual(describe(0), { condition: 'clear', icon: 'sun' });
  assert.equal(describe(63).icon, 'rain');
  assert.equal(describe(1234).condition, 'unknown');
});

test('wind direction as compass point', () => {
  assert.equal(compass(0), 'N');
  assert.equal(compass(173), 'S');
  assert.equal(compass(270), 'W');
  assert.equal(compass(350), 'N');
});

test('Open-Meteo answer becomes widget data', () => {
  const data = toWidgetData(fixture, { place: 'Berlin' });
  assert.equal(data.place, 'Berlin');
  assert.equal(typeof data.now.temp, 'number');
  assert.match(data.sun.sunrise, /^\d\d:\d\d$/);
  assert.match(data.sun.sunset, /^\d\d:\d\d$/);
  assert.equal(data.hours.length, 5);
  for (const hour of data.hours) assert.ok(Number.isInteger(hour.hour) && hour.hour >= 0 && hour.hour < 24);
});

test('demo data has the same shape as real data', () => {
  const real = toWidgetData(fixture, { place: 'Berlin' });
  const demo = weather.demo({ config: { place: 'Berlin' } });
  const shape = (value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, shape(value[key])]))
      : Array.isArray(value) ? 'array' : typeof value;
  const realShape = shape(real);
  realShape.today.rainFrom = 'number|null';
  const demoShape = shape(demo);
  demoShape.today.rainFrom = 'number|null';
  assert.deepEqual(demoShape, realShape);
});
