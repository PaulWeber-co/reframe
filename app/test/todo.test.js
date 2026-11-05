// The to-do list: stored in the data directory, edited through actions, shown
// as a tile (tap to tick off) and on the control page.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createStore } from '../server/store.js';
import todo, { applyAction, colorOf, dayKey, daysBetween, FILE, MAX_ITEMS, normalizeList, toWidgetData } from '../server/widgets/todo.js';
import { dueText, render } from '../web/js/widgets/todo.js';

const TZ = 'Europe/Berlin';
// Tuesday 27 October 2026, 10:00 in Berlin
const NOW = new Date('2026-10-27T09:00:00Z');

const item = (id, extra = {}) => ({ id, text: `Task ${id}`, done: false, due: null, who: null, createdAt: Number(id.replace(/\D/g, '')) || 0, ...extra });

test('days are counted in the wall\'s time zone', () => {
  assert.equal(dayKey(new Date('2026-10-27T23:30:00Z'), TZ), '2026-10-28', 'already tomorrow in Berlin');
  assert.equal(dayKey(new Date('2026-10-27T23:30:00Z'), 'UTC'), '2026-10-27');
  assert.equal(daysBetween('2026-10-27', '2026-10-28'), 1);
  assert.equal(daysBetween('2026-10-27', '2026-10-26'), -1);
  assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1, 'across a month');
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2, 'across the clock change');
});

test('a name always gets the same one of six colours', () => {
  assert.equal(colorOf(null), null);
  assert.equal(colorOf(''), null);
  assert.equal(colorOf('Alex'), colorOf('alex'), 'case does not matter');
  for (const name of ['Alex', 'Sam', 'Kim', 'Robin', 'Mara', 'Jo']) assert.ok([0, 1, 2, 3, 4, 5].includes(colorOf(name)), name);
  assert.equal(new Set(['Alex', 'Sam', 'Kim', 'Robin', 'Mara', 'Jo', 'Lee', 'Max'].map(colorOf)).size > 1, true);
});

test('whatever is in the file, the list is safe to use', () => {
  assert.deepEqual(normalizeList(null), { items: [] });
  assert.deepEqual(normalizeList({ items: 'nope' }), { items: [] });
  const list = normalizeList({
    items: [
      { id: 'a', text: '  lots   of   space ', due: '2026-10-30', who: 'Alex', done: true, createdAt: 5 },
      { id: 'b', text: '', due: null },
      { text: 'no id' },
      { id: 'c', text: 'x'.repeat(500), due: '30.10.2026', who: 'y'.repeat(80) },
      null,
    ],
  });
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0], { id: 'a', text: 'lots of space', done: true, due: '2026-10-30', who: 'Alex', createdAt: 5 });
  assert.equal(list.items[1].text.length, 120);
  assert.equal(list.items[1].due, null, 'a date in another format is dropped');
  assert.equal(list.items[1].who.length, 24);
  assert.equal(normalizeList({ items: Array.from({ length: 300 }, (_, i) => item(`i${i}`)) }).items.length, MAX_ITEMS);
});

test('the tile shows open items, overdue and today first, then by date, then undated', () => {
  const list = {
    items: [
      item('1', { due: null }),
      item('2', { due: '2026-10-29', who: 'Sam' }),
      item('3', { due: '2026-10-27', who: 'Alex' }),
      item('4', { due: '2026-10-25' }),
      item('5', { done: true, due: '2026-10-26' }),
      item('6', { due: null, createdAt: 0 }),
    ],
  };
  const data = toWidgetData(list, NOW, TZ);
  assert.equal(data.open, 5);
  assert.equal(data.done, 1);
  assert.deepEqual(data.items.map((entry) => entry.id), ['4', '3', '2', '6', '1']);
  assert.deepEqual(data.items.map((entry) => entry.inDays), [-2, 0, 2, null, null]);
  assert.equal(data.items[1].color, colorOf('Alex'));
  assert.deepEqual(data.all.map((entry) => [entry.id, entry.done]), [['4', false], ['3', false], ['2', false], ['6', false], ['1', false], ['5', true]], 'ticked ones last, in the full list');
  assert.equal(toWidgetData({ items: Array.from({ length: 20 }, (_, i) => item(`n${i}`)) }, NOW, TZ).items.length, 8);
});

test('actions: add, toggle, remove, clear done', () => {
  let list = { items: [] };
  const added = applyAction(list, 'add', { text: '  Buy   milk ', due: '2026-10-28', who: ' Sam ' }, 1000);
  list = added.list;
  assert.equal(list.items.length, 1);
  assert.deepEqual({ ...list.items[0], id: 'x' }, { id: 'x', text: 'Buy milk', done: false, due: '2026-10-28', who: 'Sam', createdAt: 1000 });
  assert.match(added.id, /^[0-9a-f]{10}$/);

  list = applyAction(list, 'toggle', { id: added.id }).list;
  assert.equal(list.items[0].done, true);
  list = applyAction(list, 'toggle', { id: added.id }).list;
  assert.equal(list.items[0].done, false);

  const second = applyAction(list, 'add', { text: 'Second' });
  list = applyAction(second.list, 'toggle', { id: second.id }).list;
  list = applyAction(list, 'clearDone').list;
  assert.deepEqual(list.items.map((entry) => entry.text), ['Buy milk']);

  list = applyAction(list, 'remove', { id: added.id }).list;
  assert.deepEqual(list.items, []);
});

test('actions reject bad input with a 400', () => {
  const bad = (name, payload, pattern, list = { items: [] }) =>
    assert.throws(() => applyAction(list, name, payload), (error) => error.status === 400 && pattern.test(error.message), `${name} ${JSON.stringify(payload)}`);
  bad('add', {}, /text is required/);
  bad('add', { text: '   ' }, /text is required/);
  bad('add', { text: 'x', due: 'tomorrow' }, /due must be a date/);
  bad('add', { text: 'x', due: '2026-13-45' }, /due must be a date/);
  bad('toggle', { id: 'nope' }, /No such to-do/);
  bad('remove', undefined, /No such to-do/);
  bad('fly', {}, /Unknown to-do action/);
  bad('add', { text: 'one too many' }, /At most/, { items: Array.from({ length: MAX_ITEMS }, (_, i) => item(`i${i}`)) });
});

test('the widget stores the list and refreshes through its actions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reframe-todo-'));
  try {
    const store = createStore(dir, { warn() {} });
    const ctx = { store, now: () => NOW, config: { timezone: TZ }, demo: false };
    assert.deepEqual(await todo.fetch(ctx), { open: 0, done: 0, items: [], all: [] });
    const { id } = await todo.actions.add({ ...ctx, payload: { text: 'Water the plants', who: 'Alex' } });
    assert.equal((await store.read(FILE)).items[0].text, 'Water the plants');
    assert.equal((await todo.fetch(ctx)).items[0].id, id);
    await todo.actions.toggle({ ...ctx, payload: { id } });
    assert.equal((await todo.fetch(ctx)).done, 1);
    assert.equal(todo.isConfigured({}), true, 'an empty list is a fine state, not a missing setting');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo mode reacts to taps without touching the disk', async () => {
  const ctx = { now: () => NOW, config: { timezone: TZ }, demo: true, store: { read: async () => assert.fail('no disk in demo'), write: async () => assert.fail('no disk in demo') } };
  const before = todo.demo(ctx);
  assert.ok(before.items.length >= 3);
  await todo.actions.toggle({ ...ctx, payload: { id: before.items[0].id } });
  const after = todo.demo(ctx);
  assert.equal(after.open, before.open - 1);
  await todo.actions.toggle({ ...ctx, payload: { id: before.items[0].id } });
  assert.equal(todo.demo(ctx).open, before.open, 'and back');
});

test('due text: overdue, today, tomorrow, a date', () => {
  assert.deepEqual(dueText(null, null), { group: '', text: '' });
  assert.deepEqual(dueText(-3, '2026-10-24'), { group: 'overdue', text: 'overdue' });
  assert.deepEqual(dueText(0, '2026-10-27'), { group: 'today', text: 'today' });
  assert.deepEqual(dueText(1, '2026-10-28'), { group: 'tomorrow', text: 'tomorrow' });
  assert.deepEqual(dueText(3, '2026-10-30'), { group: 'later', text: 'Fri, Oct 30' });
});

test('tile: loading, rows with a tap target, escaping, more, empty', () => {
  assert.match(render(null), /class="loading">Loading …/);

  const data = toWidgetData(normalizeList({ items: [item('1', { who: 'Alex', due: '2026-10-27' }), item('2'), item('3', { due: '2026-10-20' })] }), NOW, TZ);
  const html = render(data);
  assert.match(html, /<em>3<\/em>/);
  assert.equal((html.match(/class="td-row"/g) ?? []).length, 3);
  assert.match(html, /data-action="toggle" data-payload='\{&quot;id&quot;:&quot;1&quot;\}'/);
  assert.match(html, /td-when td-overdue">overdue</);
  assert.match(html, /td-when td-today">today</);
  assert.match(html, /title="Alex"/);

  const evil = render({ open: 1, done: 0, items: [{ id: '1', text: '<img src=x onerror=alert(1)>', who: '"><b>', color: 2, due: null, inDays: null }], all: [] });
  assert.ok(!evil.includes('<img'), 'text is escaped');
  assert.ok(!evil.includes('"><b>'), 'names are escaped');

  const many = render({ open: 9, done: 0, items: Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, text: `T${i}`, who: null, color: null, due: null, inDays: null })), all: [] });
  assert.equal((many.match(/class="td-row"/g) ?? []).length, 5, 'at most five rows');
  assert.match(many, /\+ 4 more/);

  const empty = render({ open: 0, done: 2, items: [], all: [] });
  assert.match(empty, /All done/);
  assert.match(empty, /control page/);
  assert.doesNotMatch(empty, /td-row/);
});
