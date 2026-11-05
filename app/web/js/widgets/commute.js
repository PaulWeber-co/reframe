// Commute tile: drive time with live traffic inside the configured morning
// window, otherwise when the next window starts.
// Data comes from server/widgets/commute.js; values pass through esc().
// Styles for the commute-* classes live in web/css/w-commute.css.
import { locale, t } from '../i18n.js';
import { clockText, esc, icon, num } from '../util.js';

export const labelKey = 'commute.title';

// The label sits in its own span so a long REFRAME_COMMUTE_LABEL ends in "…".
const head = (text) => `<div class="lbl">${icon('car')}<span class="commute-name">${esc(text || t('commute.title'))}</span></div>`;

const km = (value) => num(value, value >= 100 ? 0 : 1);

// Mon = 1 … Sun = 7 → "Mon" / "Mo." in the chosen language
const dayName = (day) => new Date(2024, 0, day).toLocaleDateString(locale(), { weekday: 'short' }).replace('.', '');

// [1,2,3,4,5] → "Weekdays", [1,3,5] → "Mon, Wed, Fri", [1,2,3,4] → "Mon–Thu"
export function describeDays(days) {
  if (days.join() === '1,2,3,4,5') return t('commute.weekdays');
  if (days.length === 7) return t('commute.daily');
  const runs = [];
  for (const day of days) {
    const run = runs.at(-1);
    if (run && day === run.at(-1) + 1) run.push(day);
    else runs.push([day]);
  }
  return runs.flatMap((run) => (run.length >= 3 ? [`${dayName(run[0])}–${dayName(run.at(-1))}`] : run.map(dayName))).join(', ');
}

// { days, from: "06:00", to: "09:30" } → "Weekdays 6:00 AM–9:30 AM": the time
// range stays on one line, so a narrow tile breaks after the days and never
// after the dash.
function schedule(window) {
  if (!window || !Array.isArray(window.days)) return '';
  return `${esc(describeDays(window.days))} <span class="commute-nw">${esc(clockText(window.from))}–${esc(clockText(window.to))}</span>`;
}

function traffic(data) {
  if (data.level === 'free') return `<div class="pill commute-pill commute-free">${esc(t('commute.free'))}</div>`;
  if (!Number.isFinite(data.delayMinutes)) return '';
  // "jam" from 10 min on keeps the pill inside the narrow music-mode tile
  return `<div class="pill commute-pill">${esc(t(data.level === 'jam' ? 'commute.jam' : 'commute.traffic', { minutes: num(data.delayMinutes) }))}</div>`;
}

// compact (music mode, 172 px wide) needs no layout of its own: every line
// either fits or wraps between its parts.
export function render(data, { compact = false } = {}) {
  if (!data) return `${head('')}<div class="loading">${esc(t('common.loading'))}</div>`;

  if (!data.active) {
    const next = data.nextStart ? `${dayName(data.nextStart.weekday)} ${clockText(data.nextStart.at)}` : '';
    return `
      ${head(data.label)}
      ${data.schedule ? `<div class="sub">${schedule(data.schedule)}</div>` : ''}
      ${next ? `<div class="foot">${esc(t('commute.next'))} <span class="commute-nw">${esc(next)}</span></div>` : ''}`;
  }

  const minutes = data.minutes;
  const big = Number.isFinite(minutes)
    ? `<div class="big${minutes >= 100 ? ' long' : ''}">${num(minutes)}<small>${esc(t('common.min'))}</small></div>`
    : '<div class="ph">–</div>';
  const foot = [
    data.arrival ? `<span class="commute-nw">${esc(t('commute.arrive', { time: clockText(data.arrival) }))}</span>` : '',
    Number.isFinite(data.distanceKm) ? `<span class="commute-nw">${esc(km(data.distanceKm))} km</span>` : '',
  ].filter(Boolean);
  return `
    ${head(data.label)}
    ${big}
    ${traffic(data)}
    ${foot.length ? `<div class="foot commute-foot">${foot.join(' · ')}</div>` : ''}`;
}
