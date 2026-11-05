// The control center as one panel. On the wall display it opens
// over the dashboard (the sliders button, app.js); on a phone or a laptop it is
// the page /control (control-page.js). Both hosts keep the state current from
// /api/events and call update(); the panel only writes markup and sends
// changes:
//
//   PUT  /api/control            mode, schedule, rules, features (only the changed field)
//   POST /api/control/override   quick actions ("Off · 1 hour") and "Back to automatic"
//   PUT  /api/layout             show or hide a tile
//   POST /api/unlock             the PIN, when one is set and this is another device
//   POST /api/widgets/todo/actions/...   the to-do list
//
// Every answer comes back as a full snapshot through onControl(), so the panel
// shows the server's view right away and never guesses.
//
// getState() → { control, access, glassLevel, layout, widgets, demo }
import { DEFAULT_SIZES } from './features/edit.js';
import { addTile, removeTile } from './grid.js';
import { locale, plural, t } from './i18n.js';
import { esc, icon } from './util.js';
import { labelOf } from './widgets/index.js';

// Display states → language keys (control.display.<state>)
export const DISPLAY_STATES = ['on', 'night', 'sleep', 'off'];
export const displayName = (state) => (DISPLAY_STATES.includes(state) ? t(`control.display.${state}`) : String(state));
const MODES = ['auto', 'on', 'off'];
const OUTSIDE = ['night', 'sleep', 'off'];
const AWAY = ['sleep', 'off'];
const TOUCH = [0, 1, 2, 5, 10, 15, 30];
const QUICK = [
  { key: 'on', body: { state: 'on', minutes: 60 } },
  { key: 'sleep', body: { state: 'sleep', minutes: 60 } },
  { key: 'off', body: { state: 'off', minutes: 60 } },
  { key: 'offUntilMorning', body: { state: 'off', until: 'morning' } },
];

/* ---------- formatting (pure, used by the tests) ---------- */

// An instant as "10:30 PM" (today), "tomorrow 6:00 AM" or "Sat 7:00 AM", in the dashboard's time zone.
export function formatAt(ms, timeZone, nowMs = Date.now()) {
  if (!Number.isFinite(ms)) return '';
  const day = (value) => new Intl.DateTimeFormat(locale(), { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  const time = new Intl.DateTimeFormat(locale(), { timeZone, hour: 'numeric', minute: '2-digit' }).format(ms);
  if (day(ms) === day(nowMs)) return time;
  if (day(ms) === day(nowMs + 86_400_000)) return `${t('control.tomorrow')} ${time}`;
  const weekday = new Intl.DateTimeFormat(locale(), { timeZone, weekday: 'short' }).format(ms).replace('.', '');
  return `${weekday} ${time}`;
}

// "42 min left" / "2 h left" for what ends soon, else "until 10:30 PM"
export function formatUntil(ms, timeZone, nowMs = Date.now()) {
  const minutes = Math.ceil((ms - nowMs) / 60_000);
  if (minutes <= 0) return '';
  if (minutes < 60) return t('control.minutesLeft', { count: minutes });
  if (minutes < 180 && minutes % 60 === 0) return t('control.hoursLeft', { count: minutes / 60 });
  return t('control.until', { time: formatAt(ms, timeZone, nowMs) });
}

// One line under the big state: why, and until when
export function describe(snapshot, nowMs = Date.now()) {
  const { effective, timezone } = snapshot;
  if (!effective) return { title: '–', reason: '', next: '' };
  const until = effective.until ? formatUntil(effective.until, timezone, nowMs) : '';
  let next = '';
  if (effective.next && ['schedule', 'dark'].includes(effective.source)) {
    next = t('control.then', { state: displayName(effective.next.display), time: formatAt(effective.next.at, timezone, nowMs) });
  }
  return { title: displayName(effective.display), reason: [t(`control.reason.${effective.reason}`), until].filter(Boolean).join(' · '), next };
}

// "rules.darkRoom", true → { rules: { darkRoom: true } }
export function nested(path, value) {
  return path
    .split('.')
    .reverse()
    .reduce((inner, key) => ({ [key]: inner }), value);
}

const valueAt = (object, path) => path.split('.').reduce((value, key) => value?.[key], object);

/* ---------- the panel ---------- */

export function createPanel(root, { getState, onControl, onAccess = () => {}, onLayout = () => {}, onGlass = () => {}, onClose = null, onArrange = null }) {
  let editing = null; // an input the user is busy with: no re-render under their finger
  let pending = false;
  let message = '';
  let messageTimer = 0;

  async function send(method, path, body) {
    const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      onAccess({ ...(getState().access ?? {}), locked: true });
      throw new Error(path === '/api/unlock' ? result.error ?? t('control.wrongPin') : t('control.enterPin'));
    }
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    return result;
  }

  async function change(body) {
    onControl(await send('PUT', '/api/control', body));
  }

  function flash(text) {
    message = text;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => {
      message = '';
      update();
    }, 5000);
    update();
  }

  const attempt = (work) =>
    work().catch((error) => {
      console.error('Control:', error);
      flash(error.message);
    });

  /* ---------- markup ---------- */

  // Only the three modes have a second line
  const hint = (name, value) => (name === 'mode' ? t(`control.mode.${value}.hint`) : '');

  const segmented = (name, options, current, { disabled = false } = {}) =>
    `<div class="cp-seg" role="radiogroup">${options
      .map(
        (value) =>
          `<button type="button" role="radio" aria-checked="${value === current}" data-act="${name}" data-value="${esc(value)}" data-key="${name}-${esc(value)}"${disabled ? ' disabled' : ''}>` +
          `<span>${esc(t(`control.${name}.${value}`))}</span>${hint(name, value) ? `<small>${esc(hint(name, value))}</small>` : ''}</button>`,
      )
      .join('')}</div>`;

  const toggle = (path, on, label, hint = '', { disabled = false } = {}) =>
    `<button type="button" class="cp-row cp-toggle" role="switch" aria-checked="${Boolean(on)}" data-act="toggle" data-path="${path}" data-key="${path}"${disabled ? ' disabled' : ''}>` +
    `<span class="cp-text"><span>${esc(label)}</span>${hint ? `<small>${esc(hint)}</small>` : ''}</span><i class="cp-knob" aria-hidden="true"></i></button>`;

  // Hour and minute as two selects: 24 hours on every device and in every
  // browser language, and a thumb-friendly wheel on phones
  const pad = (n) => String(n).padStart(2, '0');
  const timeInput = (path, value, label) => {
    const [hour, minute] = String(value).split(':').map(Number);
    const minutes = [...new Set([...Array.from({ length: 12 }, (_, i) => i * 5), minute])].sort((a, b) => a - b);
    const options = (list, current) => list.map((n) => `<option value="${pad(n)}"${n === current ? ' selected' : ''}>${pad(n)}</option>`).join('');
    return (
      `<span class="cp-time" data-time="${path}"><span>${esc(label)}</span>` +
      `<select data-part="h" data-key="${path}.h" aria-label="${esc(t('control.hour', { name: label }))}">${options(Array.from({ length: 24 }, (_, i) => i), hour)}</select>` +
      `<b>:</b><select data-part="m" data-key="${path}.m" aria-label="${esc(t('control.minute', { name: label }))}">${options(minutes, minute)}</select></span>`
    );
  };

  const unitState = (value) => (value ? t(`control.unit.${value}`) : '–');

  function header(state) {
    const snapshot = state.control;
    const { title, reason, next } = describe(snapshot);
    const display = snapshot?.effective?.display ?? 'on';
    const overridden = snapshot?.effective?.source === 'override';
    return `
      <header class="cp-head">
        <div class="cp-head-text">
          <h2 id="control-title">${esc(t('control.title'))}</h2>
          <p>${esc(t('control.subtitle'))}</p>
        </div>
        <a class="cp-pill cp-settings" href="/setup">${esc(t('control.settings'))}</a>
        ${onClose ? `<button type="button" class="cp-close" data-act="close" aria-label="${esc(t('control.close'))}">${icon('x')}</button>` : ''}
      </header>
      <div class="cp-now" data-display="${esc(display)}">
        <span class="cp-dot" aria-hidden="true"></span>
        <div>
          <div class="cp-now-title">${esc(t('control.screen', { state: title }))}</div>
          <div class="cp-now-reason">${esc(reason)}</div>
          ${next ? `<div class="cp-now-next">${esc(next)}</div>` : ''}
        </div>
        ${overridden ? `<button type="button" class="cp-pill" data-act="clear" data-key="clear">${esc(t('control.backToAuto'))}</button>` : ''}
      </div>
      ${message ? `<div class="cp-msg" role="status">${esc(message)}</div>` : ''}`;
  }

  function lock(state) {
    if (!state.access?.locked) return '';
    return `
      <form class="cp-card cp-lock" data-form="unlock">
        <h3>${esc(t('control.locked'))}</h3>
        <p>${esc(t('control.lockedText'))}</p>
        <div class="cp-lock-row">
          <input type="password" name="pin" inputmode="numeric" autocomplete="current-password" placeholder="PIN" aria-label="PIN" data-key="pin" required>
          <button type="submit" class="cp-primary">${esc(t('control.unlock'))}</button>
        </div>
      </form>`;
  }

  function screen(settings) {
    return `
      <section class="cp-card">
        <h3>${esc(t('control.screenTitle'))}</h3>
        ${segmented('mode', MODES, settings.mode)}
        <div class="cp-quick" aria-label="${esc(t('control.quick.label'))}">
          ${QUICK.map((quick, i) => `<button type="button" data-act="quick" data-index="${i}" data-key="quick-${i}"><span>${esc(t(`control.quick.${quick.key}`))}</span><small>${esc(t(`control.quick.${quick.key}.note`))}</small></button>`).join('')}
        </div>
      </section>`;
  }

  function schedule(settings, snapshot) {
    const auto = settings.mode === 'auto';
    return `
      <section class="cp-card${auto ? '' : ' cp-muted'}">
        <h3>${esc(t('control.schedule'))} <small>${esc(t(auto ? 'control.scheduleAuto' : 'control.scheduleOnlyAuto'))}</small></h3>
        <div class="cp-days">
          <div class="cp-day"><b>${esc(t('control.weekdays'))}</b>${timeInput('schedule.weekdays.on', settings.schedule.weekdays.on, t('control.on'))}${timeInput('schedule.weekdays.off', settings.schedule.weekdays.off, t('control.off'))}</div>
          <div class="cp-day"><b>${esc(t('control.weekend'))}</b>${timeInput('schedule.weekend.on', settings.schedule.weekend.on, t('control.on'))}${timeInput('schedule.weekend.off', settings.schedule.weekend.off, t('control.off'))}</div>
        </div>
        <div class="cp-label">${esc(t('control.outside'))}</div>
        ${segmented('outside', OUTSIDE, settings.outside)}
        ${snapshot?.effective?.next ? `<p class="cp-note">${esc(t('control.nextChange', { state: displayName(snapshot.effective.next.display), time: formatAt(snapshot.effective.next.at, snapshot.timezone) }))}</p>` : ''}
      </section>`;
  }

  function rules(settings, snapshot) {
    const { rules: r } = settings;
    const inputs = snapshot?.inputs ?? {};
    const presence = !r.presenceEntity
      ? t('control.presenceOff')
      : inputs.presenceError
        ? t('control.presenceError', { error: inputs.presenceError })
        : inputs.present === true
          ? t('control.presenceHome')
          : inputs.present === false
            ? t('control.presenceAway')
            : t('control.presenceNone');
    return `
      <section class="cp-card">
        <h3>${esc(t('control.rules'))}</h3>
        ${toggle('rules.darkRoom', r.darkRoom, t('control.darkRoom'), t('control.darkRoom.hint'))}
        ${toggle('rules.musicWakes', r.musicWakes, t('control.musicWakes'), t('control.musicWakes.hint'), { disabled: !settings.features.musicMode })}
        ${toggle('rules.batterySaver', r.batterySaver, t('control.batterySaver'), t('control.batterySaver.hint'))}
        <label class="cp-row">
          <span class="cp-text"><span>${esc(t('control.touchWake'))}</span><small>${esc(t('control.touchWake.hint'))}</small></span>
          <select data-path="rules.touchWake" data-key="rules.touchWake" data-number>
            ${TOUCH.map((m) => `<option value="${m}"${m === r.touchWake ? ' selected' : ''}>${esc(m ? t('control.minutes', { count: m }) : t('control.never'))}</option>`).join('')}
          </select>
        </label>
        <div class="cp-presence">
          <label class="cp-text" for="cp-presence"><span>${esc(t('control.nobodyHome'))}</span><small>${esc(presence)}</small></label>
          <div class="cp-presence-row">
            <input id="cp-presence" type="text" placeholder="person.alex" value="${esc(r.presenceEntity)}" data-path="rules.presenceEntity" data-key="rules.presenceEntity" spellcheck="false" autocapitalize="off">
            <select data-path="rules.presenceAway" data-key="rules.presenceAway" aria-label="${esc(t('control.then.label'))}">
              ${AWAY.map((value) => `<option value="${value}"${value === r.presenceAway ? ' selected' : ''}>${esc(t(`control.away.${value}`))}</option>`).join('')}
            </select>
          </div>
        </div>
      </section>`;
  }

  function features(settings, state) {
    const { features: f } = settings;
    const status = state.control?.status;
    const current = Number.isFinite(status?.backlightPercent) ? ` · ${t('control.currently', { percent: status.backlightPercent })}` : '';
    return `
      <section class="cp-card">
        <h3>${esc(t('control.features'))}</h3>
        ${toggle('features.autoBrightness', f.autoBrightness, t('control.autoBrightness'), `${t('control.autoBrightness.hint')}${current}`)}
        <label class="cp-row cp-range${f.autoBrightness ? ' cp-muted' : ''}">
          <span class="cp-text"><span>${esc(t('control.brightness'))}</span><small data-live="brightness">${f.brightness} %${f.autoBrightness ? ` · ${esc(t('control.brightness.manualOnly'))}` : ''}</small></span>
          <input type="range" min="5" max="100" step="5" value="${f.brightness}" data-path="features.brightness" data-key="features.brightness" data-number${f.autoBrightness ? ' disabled' : ''} aria-label="${esc(t('control.brightness.label'))}">
        </label>
        ${toggle('features.musicMode', f.musicMode, t('control.musicMode'), t('control.musicMode.hint'))}
        ${toggle('features.videos', f.videos, t('control.videos'), t('control.videos.hint'))}
        <label class="cp-row cp-range">
          <span class="cp-text"><span>${esc(t('control.glass'))}</span><small data-live="glass">${state.glassLevel ?? 55} · ${esc(t('control.glass.range'))}</small></span>
          <input type="range" min="0" max="100" step="1" value="${state.glassLevel ?? 55}" data-glass data-key="glass" aria-label="${esc(t('control.glass.label'))}">
        </label>
      </section>`;
  }

  function tiles(state) {
    const layout = state.layout ?? { tiles: [], hidden: [] };
    const visible = new Set(layout.tiles.map((tile) => tile.id));
    const ids = [...layout.tiles.map((tile) => tile.id), ...(layout.hidden ?? []).filter((id) => !visible.has(id))];
    const rows = ids
      .map((id) => {
        const entry = state.widgets?.[id];
        const badge = entry?.error
          ? `<em class="cp-badge cp-bad" title="${esc(entry.error)}">${esc(t('control.badge.error'))}</em>`
          : entry?.demo
            ? `<em class="cp-badge" title="${esc(t('control.badge.exampleHint'))}">${esc(t('common.example'))}</em>`
            : entry
              ? `<em class="cp-badge cp-good">${esc(t('control.badge.live'))}</em>`
              : '';
        return (
          `<button type="button" class="cp-row cp-toggle" role="switch" aria-checked="${visible.has(id)}" data-act="tile" data-id="${esc(id)}" data-key="tile-${esc(id)}">` +
          `<span class="cp-text"><span>${esc(labelOf(id))} ${badge}</span></span><i class="cp-knob" aria-hidden="true"></i></button>`
        );
      })
      .join('');
    return `
      <section class="cp-card">
        <h3>${esc(t('control.tiles'))} <small>${esc(t('control.tiles.hint'))}</small></h3>
        ${rows}
        ${onArrange ? `<button type="button" class="cp-wide" data-act="arrange" data-key="arrange">${esc(t('control.arrange'))}</button>` : `<p class="cp-note">${esc(t('control.arrange.note'))}</p>`}
      </section>`;
  }

  // The to-do list: add, tick off, remove (the tile on the wall only shows the top items)
  function todos(state) {
    const data = state.widgets?.todo?.data;
    const all = Array.isArray(data?.all) ? data.all : [];
    const rows = all
      .map(
        (item) =>
          `<li class="cp-todo${item.done ? ' cp-done' : ''}">` +
          `<button type="button" class="cp-check" data-act="todo-toggle" data-id="${esc(item.id)}" data-key="todo-t-${esc(item.id)}" aria-pressed="${item.done}" aria-label="${esc(t('todo.tick'))}"></button>` +
          `<span class="cp-todo-text">${esc(item.text)}${item.who ? `<small>${esc(item.who)}</small>` : ''}</span>` +
          `<button type="button" class="cp-remove" data-act="todo-remove" data-id="${esc(item.id)}" data-key="todo-r-${esc(item.id)}" aria-label="${esc(t('todo.remove'))}">${icon('x')}</button></li>`,
      )
      .join('');
    return `
      <section class="cp-card">
        <h3>${esc(t('todo.title'))} ${data?.done ? `<button type="button" class="cp-pill" data-act="todo-clear" data-key="todo-clear">${esc(t('todo.clearDone'))}</button>` : ''}</h3>
        <form class="cp-todo-add" data-form="todo-add">
          <input type="text" name="text" maxlength="120" placeholder="${esc(t('todo.newPlaceholder'))}" aria-label="${esc(t('todo.newPlaceholder'))}" data-key="todo-text" required>
          <input type="text" name="who" maxlength="24" placeholder="${esc(t('todo.whoPlaceholder'))}" aria-label="${esc(t('todo.whoPlaceholder'))}" data-key="todo-who">
          <input type="date" name="due" aria-label="${esc(t('todo.duePlaceholder'))}" data-key="todo-due">
          <button type="submit" class="cp-primary">${esc(t('todo.add'))}</button>
        </form>
        ${rows ? `<ul class="cp-todo-list">${rows}</ul>` : `<p class="cp-note">${esc(t('todo.listEmpty'))}</p>`}
      </section>`;
  }

  function system(state) {
    const snapshot = state.control ?? {};
    const status = snapshot.status;
    const inputs = snapshot.inputs ?? {};
    const host = snapshot.host ?? {};
    const ambient = state.widgets?.ambient?.data;
    const rows = [
      [t('control.system.kiosk'), status ? unitState(status.kiosk) : '–'],
      [t('control.system.camera'), !host.camera ? t('control.system.off') : ambient?.available ? t('control.system.measuring', { percent: ambient.ambientPercent }) : t('control.system.on')],
      [t('control.system.brightness'), Number.isFinite(status?.backlightPercent) ? (status.backlightControl === 'software' ? t('control.system.software', { percent: status.backlightPercent }) : `${status.backlightPercent} %`) : '–'],
      [t('control.system.power'), inputs.onBattery === true ? t('control.system.battery') : inputs.onBattery === false ? t('control.system.mains') : '–'],
      [t('control.system.music'), inputs.musicActive ? t('control.system.playing') : t('control.system.quiet')],
    ];
    return `
      <section class="cp-card">
        <h3>${esc(t('control.system'))}</h3>
        <dl class="cp-facts">${rows.map(([name, value]) => `<div><dt>${esc(name)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>
        ${status?.powerDown === false ? `<p class="cp-note">${esc(t('control.system.noPowerDown'))}</p>` : ''}
        ${status ? '' : `<p class="cp-note">${state.demo ? `${esc(t('control.system.demo'))} ` : ''}${esc(t('control.system.noHost'))}</p>`}
      </section>`;
  }

  /* ---------- render ---------- */

  function update() {
    if (editing) {
      pending = true;
      return;
    }
    pending = false;
    const state = getState();
    const settings = state.control?.settings;
    const focusKey = root.contains(document.activeElement) ? document.activeElement.dataset?.key : null;
    const scroller = root.querySelector('.cp-scroll');
    const scroll = scroller?.scrollTop ?? 0;
    root.innerHTML = `
      ${header(state)}
      <div class="cp-scroll">
        ${lock(state)}
        ${settings ? screen(settings) + schedule(settings, state.control) + rules(settings, state.control) + features(settings, state) : `<p class="cp-note">${esc(t('common.loading'))}</p>`}
        ${todos(state)}
        ${tiles(state)}
        ${system(state)}
      </div>`;
    const next = root.querySelector('.cp-scroll');
    if (next) next.scrollTop = scroll;
    if (focusKey) root.querySelector(`[data-key="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  /* ---------- events ---------- */

  function finishEditing() {
    editing = null;
    if (pending) update();
  }

  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act]');
    if (!button || button.disabled) return;
    const state = getState();
    const settings = state.control?.settings;
    const act = button.dataset.act;
    if (act === 'close') return onClose?.();
    if (act === 'arrange') return onArrange?.();
    if (act === 'mode' || act === 'outside') return attempt(() => change({ [act]: button.dataset.value }));
    if (act === 'quick') return attempt(async () => onControl(await send('POST', '/api/control/override', QUICK[Number(button.dataset.index)].body)));
    if (act === 'clear') return attempt(async () => onControl(await send('POST', '/api/control/override', { clear: true })));
    if (act === 'toggle' && settings) {
      const path = button.dataset.path;
      return attempt(() => change(nested(path, !valueAt(settings, path))));
    }
    if (act === 'tile') return attempt(() => toggleTile(button.dataset.id));
    const todo = (name, body = {}) => attempt(() => send('POST', `/api/widgets/todo/actions/${name}`, body));
    if (act === 'todo-toggle') return todo('toggle', { id: button.dataset.id });
    if (act === 'todo-remove') return todo('remove', { id: button.dataset.id });
    if (act === 'todo-clear') return todo('clearDone');
  });

  async function toggleTile(id) {
    const layout = getState().layout;
    let next;
    if (layout.tiles.some((tile) => tile.id === id)) next = removeTile(layout, id);
    else {
      const { w, h } = DEFAULT_SIZES[id] ?? { w: 1, h: 1 };
      next = addTile(layout, id, w, h) ?? addTile(layout, id, 1, 1);
      if (!next) throw new Error(t('control.noRoom'));
    }
    const response = await fetch('/api/layout', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(next) });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) onAccess({ ...(getState().access ?? {}), locked: true });
    if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
    onLayout(result);
  }

  root.addEventListener('focusin', (event) => {
    if (event.target.matches('input[type="text"], input[type="password"], input[type="date"]')) editing = event.target;
  });
  root.addEventListener('focusout', (event) => {
    if (event.target === editing) setTimeout(finishEditing, 0);
  });
  root.addEventListener('pointerdown', (event) => {
    if (event.target.matches('input[type="range"]')) editing = event.target;
  });

  root.addEventListener('input', (event) => {
    const input = event.target;
    if (input.type !== 'range') return;
    editing = input;
    if (input.dataset.glass !== undefined) {
      onGlass(Number(input.value), { save: false });
      const live = root.querySelector('[data-live="glass"]');
      if (live) live.textContent = `${input.value} · ${t('control.glass.range')}`;
    } else {
      const live = root.querySelector('[data-live="brightness"]');
      if (live) live.textContent = `${input.value} %`;
    }
  });

  root.addEventListener('change', (event) => {
    const input = event.target;
    if (input.dataset.glass !== undefined) {
      onGlass(Number(input.value), { save: true });
      finishEditing();
      return;
    }
    const time = input.closest('[data-time]');
    if (time) {
      const [hour, minute] = ['h', 'm'].map((part) => time.querySelector(`[data-part="${part}"]`).value);
      attempt(() => change(nested(time.dataset.time, `${hour}:${minute}`)));
      return;
    }
    const path = input.dataset.path;
    if (!path) return;
    const value = input.dataset.number !== undefined ? Number(input.value) : input.value;
    attempt(() => change(nested(path, value))).finally(() => {
      if (input.type === 'range' || input.tagName === 'SELECT') finishEditing();
    });
  });

  root.addEventListener('submit', (event) => {
    const add = event.target.closest('form[data-form="todo-add"]');
    if (add) {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(add));
      editing = null;
      attempt(() => send('POST', '/api/widgets/todo/actions/add', body));
      return;
    }
    const form = event.target.closest('form[data-form="unlock"]');
    if (!form) return;
    event.preventDefault();
    const pin = new FormData(form).get('pin');
    editing = null;
    attempt(async () => {
      onAccess(await send('POST', '/api/unlock', { pin }));
      flash(t('control.unlocked'));
    });
  });

  // The relative times ("12 min left") age: refresh them once a minute
  setInterval(() => root.isConnected && !root.closest('[hidden]') && update(), 60_000);

  return { update };
}

/* ---------- the overlay on the dashboard ---------- */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Opens and closes the panel over the dashboard like a dialog: the toggle
// button, Escape, a click beside the panel and the × close it; Tab stays
// inside while it is open; focus returns to the toggle afterwards.
export function bindDialog({ toggle, overlay, panel, keyboard = document, onOpen = () => {} }) {
  const isOpen = () => !overlay.hidden;
  const set = (open) => {
    overlay.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', t(open ? 'control.close' : 'control.open'));
    if (open) {
      onOpen();
      panel.querySelectorAll(FOCUSABLE)[0]?.focus();
    } else toggle.focus();
  };
  overlay.hidden = true;
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', t('control.open'));
  toggle.addEventListener('click', () => set(!isOpen()));
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) set(false);
  });
  keyboard.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') return set(false);
    if (event.key !== 'Tab') return;
    const items = [...panel.querySelectorAll(FOCUSABLE)];
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && keyboard.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && keyboard.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  return { open: () => set(true), close: () => set(false), isOpen };
}
