// Home tile: the Home Assistant entities chosen in REFRAME_HA_ENTITIES.
// The first switchable one (light, switch, fan ...) is a switch, up to two
// more follow as rows; without a switchable entity up to three rows.
// Data comes from server/widgets/home.js, which turns every state into either
// a key of the language files ({ key }) or a value to show as it is ({ text });
// values pass through esc().
// Styles for the ho-* classes live in web/css/w-home.css: names end in "…",
// the switch stacks in 1×1 tiles and a row that does not fit is left out.
import { t } from '../i18n.js';
import { esc, icon } from '../util.js';

export const labelKey = 'home.title';

const head = () => `<div class="lbl">${icon('home')}${esc(t('home.title'))}</div>`;
const unreachableNote = () => `<small class="ho-muted">${esc(t('home.state.unreachable'))}</small>`;

const unreachable = (item) => item.missing || item.state === 'unavailable' || item.state === 'unknown';

// The state as text in the chosen language
export const displayText = (display) => (display?.key ? t(`home.state.${display.key}`) : String(display?.text ?? ''));

// An entity Home Assistant cannot reach gets a disabled switch without
// data-action, so a tap does not pretend to switch it.
function toggle(item) {
  const name = `<span class="ho-label"><span class="ho-name">${esc(item.name)}</span>${unreachable(item) ? unreachableNote() : ''}</span>`;
  const pressed = `aria-pressed="${item.on === true}"`;
  if (unreachable(item)) {
    return `<button class="switch ho-switch ho-na" type="button" ${pressed} disabled>${icon(item.icon)}${name}<i class="knob"></i></button>`;
  }
  // data-payload is JSON inside a single-quoted attribute: esc() turns its
  // quotes into entities, the browser turns them back before app.js parses it.
  const payload = esc(JSON.stringify({ id: item.id }));
  return `<button class="switch ho-switch" type="button" data-action="toggle" data-payload='${payload}' ${pressed}>${icon(item.icon)}${name}<i class="knob"></i></button>`;
}

// "21.5 °C Inside": the value first, the name muted behind it (below it in 1×1
// tiles). An entity that cannot be reached shows its name and "unreachable".
function row(item) {
  const off = unreachable(item);
  const text = off
    ? `<span class="ho-name">${esc(item.name)}</span>${unreachableNote()}`
    : `<b class="ho-val">${esc(displayText(item.display))}</b><span class="ho-name ho-muted">${esc(item.name)}</span>`;
  return `<div class="row ho-row${off ? ' ho-na' : ''}">${icon(item.icon)}<span class="ho-stack">${text}</span></div>`;
}

// compact (music mode, 172 / 428 px) needs no markup of its own: w-home.css
// switches between one-line and stacked layout by the tile's actual width.
export function render(data, { compact = false } = {}) {
  if (!data) return `${head()}<div class="loading">${esc(t('common.loading'))}</div>`;
  const items = Array.isArray(data.entities) ? data.entities : [];
  if (!items.length) return `${head()}<div class="sub ho-muted">${esc(t('home.empty'))}</div>`;

  const first = items.find((item) => item.toggleable);
  const rows = items.filter((item) => item !== first).slice(0, first ? 2 : 3);
  return `
    ${head()}
    <div class="ho">
      ${first ? toggle(first) : ''}
      <div class="ho-rows">${rows.map(row).join('')}</div>
    </div>`;
}
