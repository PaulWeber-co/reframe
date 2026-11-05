// Weather tile. Reference for every widget module:
//   labelKey   the language key of the name shown in edit mode
//   render(data, { compact }) → HTML for the tile body. data is null while
//              loading. compact is true in music mode, when the tile is narrower.
// Data comes from server/widgets/weather.js; values pass through esc().
import { t } from '../i18n.js';
import { esc, hourText, icon } from '../util.js';

export const labelKey = 'weather.title';

export function render(data, { compact = false } = {}) {
  if (!data) return `<div class="lbl">${icon('cloudsun')}${esc(t('weather.title'))}</div><div class="loading">${esc(t('common.loading'))}</div>`;
  const { now, today, hours, place } = data;
  const rain = Number.isFinite(today.rainFrom) ? t('weather.rainFrom', { time: hourText(today.rainFrom) }) : t('weather.dry');
  return `
    <div class="lbl">${icon(now.icon)}${esc(t('weather.title'))}<em>${esc(place)}</em></div>
    <div class="wx${compact ? ' compact' : ''}">
      <div class="wx-now">
        <div class="big">${esc(now.temp)}°</div>
        <div class="sub">${esc(t(`weather.${now.condition}`))}, ${esc(rain)}<br>${esc(t('weather.range', { max: today.max, min: today.min }))}</div>
      </div>
      <ol class="hours">
        ${hours.map((h) => `<li><span>${esc(hourText(h.hour))}</span>${icon(h.icon)}<b>${esc(h.temp)}°</b></li>`).join('')}
      </ol>
    </div>`;
}
