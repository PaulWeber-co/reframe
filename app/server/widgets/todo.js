// To-dos: a small shared list that lives in the data directory (todos.json).
// It is edited on the tile itself (a tap ticks an item off) and from a phone
// on the control page; no account, no cloud.
//
// An item is { id, text, done, due, who, createdAt }:
//   due   "YYYY-MM-DD" or null
//   who   a free-text name or null; the tile colours the dot by name, the same
//         name always gets the same colour (colorOf)
//
// Actions (POST /api/widgets/todo/actions/<name>):
//   add      { text, due?, who? }
//   toggle   { id }
//   remove   { id }
//   clearDone
import { randomBytes } from 'node:crypto';

export const FILE = 'todos.json';
export const MAX_ITEMS = 100;
export const MAX_TEXT = 120;
export const MAX_NAME = 24;
const COLORS = 6;
const SHOWN = 8;

const badRequest = (message) => Object.assign(new Error(message), { status: 400 });
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Calendar day "YYYY-MM-DD" at `now` in the wall's time zone
export function dayKey(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// Whole days from one day key to another: 0 same day, 1 tomorrow, -1 yesterday
export function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

// The same name always lands on the same one of six colours
export function colorOf(name) {
  if (!name) return null;
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return hash % COLORS;
}

const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

function cleanDue(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw badRequest('due must be a date like 2026-10-27');
  }
  return value;
}

// The file → a list that is safe to use whatever it contains
export function normalizeList(raw) {
  const items = (Array.isArray(raw?.items) ? raw.items : [])
    .filter((item) => item && typeof item.id === 'string' && cleanText(item.text, MAX_TEXT))
    .slice(0, MAX_ITEMS)
    .map((item) => ({
      id: item.id.slice(0, 32),
      text: cleanText(item.text, MAX_TEXT),
      done: item.done === true,
      due: typeof item.due === 'string' && DATE.test(item.due) ? item.due : null,
      who: cleanText(item.who, MAX_NAME) || null,
      createdAt: Number.isFinite(item.createdAt) ? item.createdAt : 0,
    }));
  return { items };
}

// Open items in the order they matter: overdue and today first, then by due
// date, then the ones without a date in the order they were added.
export function toWidgetData(list, now, timeZone) {
  const today = dayKey(now, timeZone);
  const open = list.items.filter((item) => !item.done);
  const rank = (item) => (item.due === null ? Number.MAX_SAFE_INTEGER : daysBetween(today, item.due));
  const sorted = [...open].sort((a, b) => rank(a) - rank(b) || a.createdAt - b.createdAt);
  const view = (item) => ({
    id: item.id,
    text: item.text,
    who: item.who,
    color: colorOf(item.who),
    due: item.due,
    // days until it is due (negative: overdue), null without a date
    inDays: item.due === null ? null : daysBetween(today, item.due),
  });
  return {
    open: open.length,
    done: list.items.length - open.length,
    items: sorted.slice(0, SHOWN).map(view),
    // Everything, for the list on the control page: open items in the same
    // order, then the ticked ones
    all: [...sorted.map((item) => ({ ...view(item), done: false })), ...list.items.filter((item) => item.done).map((item) => ({ ...view(item), done: true }))],
  };
}

const newId = () => randomBytes(5).toString('hex');

// Applies one action to a list → { list, id }
export function applyAction(list, name, payload, now = Date.now()) {
  const items = [...list.items];
  const find = () => {
    const index = items.findIndex((item) => item.id === payload?.id);
    if (index < 0) throw badRequest('No such to-do');
    return index;
  };
  switch (name) {
    case 'add': {
      const text = cleanText(payload?.text, MAX_TEXT);
      if (!text) throw badRequest('text is required');
      if (items.length >= MAX_ITEMS) throw badRequest(`At most ${MAX_ITEMS} to-dos, please remove some`);
      const item = { id: newId(), text, done: false, due: cleanDue(payload?.due), who: cleanText(payload?.who, MAX_NAME) || null, createdAt: now };
      items.push(item);
      return { list: { items }, id: item.id };
    }
    case 'toggle': {
      const index = find();
      items[index] = { ...items[index], done: !items[index].done };
      return { list: { items }, id: items[index].id };
    }
    case 'remove': {
      const index = find();
      const [gone] = items.splice(index, 1);
      return { list: { items }, id: gone.id };
    }
    case 'clearDone':
      return { list: { items: items.filter((item) => !item.done) }, id: null };
    default:
      throw badRequest(`Unknown to-do action ${name}`);
  }
}

const day = (offset, now = new Date()) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

// Demo list; changes from the tile stay in memory so the demo reacts to taps
let demoList = null;
function demoItems(now) {
  if (!demoList) {
    demoList = normalizeList({
      items: [
        { id: 'd1', text: 'Water the plants', due: day(0, now), who: 'Alex', createdAt: 1 },
        { id: 'd2', text: 'Call the plumber', due: day(1, now), who: 'Sam', createdAt: 2 },
        { id: 'd3', text: 'Book train tickets', due: day(3, now), who: 'Alex', createdAt: 3 },
        { id: 'd4', text: 'Return library books', due: null, who: 'Sam', createdAt: 4 },
        { id: 'd5', text: 'Order cat food', due: null, who: null, createdAt: 5 },
        { id: 'd6', text: 'Renew bike lock', done: true, due: null, who: null, createdAt: 6 },
      ],
    });
  }
  return demoList;
}

const action = (name) => async (ctx) => {
  if (ctx.demo) {
    const result = applyAction(demoItems(ctx.now()), name, ctx.payload, ctx.now().getTime());
    demoList = result.list;
    return { id: result.id };
  }
  const result = applyAction(normalizeList(await ctx.store.read(FILE, null)), name, ctx.payload, ctx.now().getTime());
  await ctx.store.write(FILE, result.list);
  return { id: result.id };
};

export default {
  id: 'todo',
  intervalMs: 60_000,
  // Always real: an empty list is a fine state, so there is nothing to configure
  isConfigured: () => true,

  async fetch({ store, now, config }) {
    return toWidgetData(normalizeList(await store.read(FILE, null)), now(), config.timezone);
  },

  demo: ({ now, config }) => toWidgetData(demoItems(now()), now(), config.timezone),

  actions: {
    add: action('add'),
    toggle: action('toggle'),
    remove: action('remove'),
    clearDone: action('clearDone'),
  },
};
