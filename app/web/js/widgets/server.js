// Host health tile: the machine itself. Each value is escaped before it
// becomes HTML; w-server.css shrinks it for 1×1 tiles.
import { plural, t } from '../i18n.js';
import { esc, icon, num } from '../util.js';

export const labelKey = 'server.title';

function percent(value) {
  return value === null || value === undefined ? '—' : `${num(value)}%`;
}

function memory(value) {
  if (!value) return { value: '—', detail: t('server.unavailable') };
  return { value: `${num(value.percent)}%`, detail: `${num(value.usedGiB, 1)} / ${num(value.totalGiB, 1)} GB` };
}

function uptime(seconds) {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor(seconds / 3_600);
  if (days) return plural('server.days', days);
  if (hours) return t('server.hours', { count: hours });
  return t('server.minutes', { count: Math.max(1, Math.floor(seconds / 60)) });
}

function stat(iconName, name, value, detail = '') {
  return `<div class="server-stat">${icon(iconName)}<span class="server-label">${esc(name)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></div>`;
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('cpu')}${esc(t('server.title'))}</div><div class="loading">${esc(t('common.loading'))}</div>`;
  const ram = memory(data.memory);
  const disk = memory(data.storage);
  const temperature = data.temperatureC == null ? '—' : `${num(data.temperatureC)}°`;
  return `
    <div class="lbl">${icon('cpu')}${esc(t('server.title'))}</div>
    <div class="server-wrap"><div class="server-grid">
      ${stat('cpu', t('server.cpu'), percent(data.cpuPercent), t('server.load'))}
      ${stat('stack', t('server.ram'), ram.value, ram.detail)}
      ${stat('disk', t('server.disk'), disk.value, disk.detail)}
      ${stat('temp', t('server.temp'), temperature, data.temperatureC == null ? t('server.unavailable') : t('server.hottest'))}
    </div></div>
    <div class="foot">${esc(t('server.uptime', { time: uptime(data.uptimeSeconds ?? 0) }))}</div>`;
}
