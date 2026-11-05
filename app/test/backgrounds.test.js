import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listBackgrounds, SCENES } from '../server/backgrounds.js';
import { clipsFor, createScenes, dayNumber, PER_DAY, sceneAt } from '../web/js/scene.js';

test('the pool is what is in the media folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'media-'));
  try {
    for (const file of ['day-50180.mp4', 'day-50180.jpg', 'morning-2793.mp4', 'day-4132.mp4', 'late-42342.mp4']) writeFileSync(join(dir, file), '');
    // Old fixed names, a poster without its clip, foreign files: not part of it
    for (const file of ['day.mp4', 'night.mp4', 'evening-5002.jpg', 'holiday.mp4', 'night-1.mp4', 'day-1.mov']) writeFileSync(join(dir, file), '');
    assert.deepEqual(await listBackgrounds(dir), {
      morning: ['morning-2793'],
      day: ['day-4132', 'day-50180'],
      evening: [],
      late: ['late-42342'],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.deepEqual(await listBackgrounds(join(tmpdir(), 'does-not-exist-7f3a')), { morning: [], day: [], evening: [], late: [] });
});

test('clip names: a known scene, a dash, a free name; posters and other files are ignored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reframe-clips-'));
  try {
    for (const file of ['day-sunny-coast.mp4', 'evening-a1.mp4', 'late-city-lights-2.mp4', 'morning-x.mp4']) writeFileSync(join(dir, file), '');
    for (const file of ['day-sunny-coast.jpg', 'noon-1.mp4', 'day-.mp4', 'Day-1.mp4', '-1.mp4']) writeFileSync(join(dir, file), '');
    const pool = await listBackgrounds(dir);
    assert.deepEqual(pool.day, ['day-sunny-coast']);
    assert.deepEqual(pool.evening, ['evening-a1']);
    assert.deepEqual(pool.late, ['late-city-lights-2']);
    assert.deepEqual(pool.morning, ['morning-x']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('two clips per scene a day, the next two tomorrow, all of them over the days', () => {
  const dayClips = ['day-1', 'day-2', 'day-3', 'day-4', 'day-5'];
  const pool = { day: dayClips, evening: ['evening-1'] };
  const day = dayNumber(2026, 10, 23);
  assert.equal(clipsFor(pool, 'day', day).length, PER_DAY);
  assert.deepEqual(clipsFor(pool, 'day', day), clipsFor(pool, 'day', day), 'the same all day');
  assert.notDeepEqual(clipsFor(pool, 'day', day), clipsFor(pool, 'day', day + 1));
  const seen = new Set();
  for (let d = day; d < day + Math.ceil(dayClips.length / PER_DAY); d++) clipsFor(pool, 'day', d).forEach((clip) => seen.add(clip));
  assert.equal(seen.size, dayClips.length);
  assert.deepEqual(clipsFor(pool, 'evening', day), ['evening-1'], 'a small pool plays whole');
  assert.deepEqual(clipsFor(pool, 'morning', day), []);
  assert.deepEqual(clipsFor(undefined, 'day', day), []);
  assert.equal(clipsFor(pool, 'day', -3).length, PER_DAY);
});

test('day numbers follow the calendar, not the clock', () => {
  assert.equal(dayNumber(1970, 1, 1), 0);
  assert.equal(dayNumber(2026, 10, 25) - dayNumber(2026, 10, 24), 1, 'across the switch to winter time');
  assert.equal(dayNumber(2027, 1, 1) - dayNumber(2026, 12, 31), 1);
});

test('scenes by time of day', () => {
  const sun = { sunrise: '07:46', sunset: '18:24' };
  assert.equal(sceneAt(3 * 60, sun), 'late');
  assert.equal(sceneAt(8 * 60, sun), 'morning');
  assert.equal(sceneAt(13 * 60, sun), 'day');
  assert.equal(sceneAt(18 * 60, sun), 'evening');
  assert.equal(sceneAt(18 * 60 + 50, sun), 'evening', 'until half an hour after sunset');
  assert.equal(sceneAt(18 * 60 + 54, sun), 'late', 'then the city lights');
  assert.equal(sceneAt(23 * 60, sun), 'late');
  // Late October: dark by five
  assert.equal(sceneAt(17 * 60 + 30, { sunrise: '07:15', sunset: '16:56' }), 'late');
  // Midsummer: still light at ten, city lights from 22:30 at the latest
  assert.equal(sceneAt(22 * 60, { sunrise: '04:50', sunset: '21:55' }), 'evening');
  assert.equal(sceneAt(22 * 60 + 30, { sunrise: '04:50', sunset: '21:55' }), 'late');
});

function fakeVideo() {
  const classes = new Set();
  const attributes = {};
  return {
    poster: '',
    muted: false,
    paused: true,
    played: [],
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    get on() {
      return classes.has('on');
    },
    get src() {
      return attributes.src ?? '';
    },
    set src(value) {
      attributes.src = value;
    },
    removeAttribute(name) {
      delete attributes[name];
    },
    load() {},
    pause() {
      this.paused = true;
    },
    play() {
      this.paused = false;
      this.played.push(this.src);
      return Promise.resolve();
    },
  };
}

test('one video decodes at a time; videos off leave the still picture', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const v1 = fakeVideo();
  const v2 = fakeVideo();
  const stage = { dataset: {}, querySelector: (selector) => (selector === '#v1' ? v1 : v2) };
  const scenes = createScenes(stage);
  const pool = { day: ['day-1', 'day-2', 'day-3', 'day-4'] };
  const day = dayNumber(2026, 10, 23);
  const [first, second] = clipsFor(pool, 'day', day);

  scenes.set('day', day);
  assert.equal(stage.dataset.scene, 'day');
  assert.equal(v1.src + v2.src, '', 'no clips yet: the gradient');
  scenes.setPool(pool);
  await Promise.resolve();
  assert.equal(v2.src, `/media/${first}.mp4`);
  assert.ok(v2.on && !v1.on);

  t.mock.timers.tick(2000);
  assert.ok(v1.paused && v1.src === '', 'the hidden video lets go of its decoder');

  t.mock.timers.tick(60_000);
  await Promise.resolve();
  assert.equal(v1.src, `/media/${second}.mp4`, 'the day’s clips take turns');
  assert.ok(v1.on && !v2.on);

  scenes.setVideos(false);
  assert.ok(v1.paused && v2.paused && v1.src === '' && v2.src === '', 'nothing decodes');
  assert.equal(v1.poster, `/media/${second}.jpg`);
  assert.ok(v1.on, 'the picture of the clip stays');
  t.mock.timers.tick(60_000);
  assert.equal(v1.src + v2.src, '', 'no turns while off');

  scenes.setVideos(true);
  await Promise.resolve();
  assert.equal(v2.src, `/media/${second}.mp4`);

  // A new day keeps a clip that is still among the chosen, else switches
  const playedBefore = v1.played.length + v2.played.length;
  assert.ok(clipsFor(pool, 'day', day + 2).includes(second));
  scenes.set('day', day + 2);
  await Promise.resolve();
  assert.equal(v1.played.length + v2.played.length, playedBefore);
  const [next] = clipsFor(pool, 'day', day + 3);
  assert.notEqual(next, second);
  scenes.set('day', day + 3);
  await Promise.resolve();
  assert.equal(v1.src, `/media/${next}.mp4`);

  scenes.set('night', day + 2);
  assert.equal(v1.src + v2.src, '', 'the night clock has no video');
  assert.ok(!v1.on && !v2.on);
});

test('a clip that loses its connection while showing comes back, a missing one does not', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const v1 = fakeVideo();
  const v2 = fakeVideo();
  const stage = { dataset: {}, querySelector: (selector) => (selector === '#v1' ? v1 : v2) };
  const scenes = createScenes(stage);
  scenes.setPool({ day: ['day-1', 'day-2', 'day-3'] });
  scenes.set('day', dayNumber(2026, 10, 28));
  await Promise.resolve();
  const shown = v2.on ? v2 : v1;
  const clip = shown.src;
  t.mock.timers.tick(2000);

  // The dashboard restarts: the showing video reports an error
  shown.onerror();
  assert.ok(!v1.on && !v2.on, 'for a moment the gradient');
  t.mock.timers.tick(5000);
  await Promise.resolve();
  const back = v1.on ? v1 : v2;
  assert.ok(back.on, 'the clip is back');
  assert.equal(back.src, clip, 'the same clip');

  // A clip that never showed (file missing) is not tried again and again
  const before = v1.played.length + v2.played.length;
  const hidden = back === v1 ? v2 : v1;
  hidden.src = '/media/day-404.mp4';
  hidden.onerror();
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(v1.played.length + v2.played.length, before);
});
