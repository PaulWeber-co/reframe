// Services tile: one row per Umbrel app or compose project with a status dot,
// CPU, memory and uptime; problems come first (the server sorts).
// Data from server/widgets/services.js, every value through esc(). In a 1×1
// tile (or music mode) w-services.css hides memory and uptime.
import { t } from '../i18n.js';
import { esc, icon, num } from '../util.js';

export const labelKey = 'services.title';

const HEAD = (extra = '') => `<div class="lbl">${icon('stack')}${esc(t('services.title'))}${extra}</div>`;
const ROWS = 4;

// 680 MiB → "680 MB", 1.5 GiB → "1.5 GB"
export function bytes(value) {
  if (!Number.isFinite(value)) return '–';
  const mb = value / 1024 ** 2;
  return mb >= 1000 ? `${num(mb / 1024, 1)} GB` : `${num(mb)} MB`;
}

// 9 days → "9 d", 5 hours → "5 h", 40 minutes → "40 min"
export function uptime(seconds) {
  if (!Number.isFinite(seconds)) return '–';
  if (seconds >= 86_400) return t('services.d', { count: Math.floor(seconds / 86_400) });
  if (seconds >= 3600) return t('services.h', { count: Math.floor(seconds / 3600) });
  return t('services.m', { count: Math.max(1, Math.floor(seconds / 60)) });
}

const cpu = (value) => (Number.isFinite(value) ? `${num(value, value < 10 ? 1 : 0)} %` : '–');

const statusText = (status) => t(`services.status.${status}`);

// { service, state } → "db: unhealthy"
const problemText = (problem) => (problem ? `${problem.service}: ${t(`services.problem.${problem.state}`)}` : '');

function row(service) {
  const detail = service.status === 'ok'
    ? `<span class="di-num">${esc(cpu(service.cpuPercent))}</span><span class="di-num di-mem">${esc(bytes(service.memBytes))}</span><span class="di-num di-up">${esc(uptime(service.uptimeSeconds))}</span>`
    : `<span class="di-problem">${esc(problemText(service.problem) || statusText(service.status))}</span>`;
  const count = service.total > 1 ? `<small>${esc(service.running)}/${esc(service.total)}</small>` : '';
  return `<li class="di-row di-${esc(service.status)}"><i class="di-dot" aria-label="${esc(statusText(service.status))}"></i><span class="di-name">${esc(service.name)}${count}</span>${detail}</li>`;
}

export function render(data) {
  if (!data) return `${HEAD()}<div class="loading">${esc(t('common.loading'))}</div>`;
  const services = Array.isArray(data.services) ? data.services : [];
  if (!services.length) return `${HEAD()}<div class="sub">${esc(t('services.empty'))}</div>`;
  const problems = (data.counts?.warn ?? 0) + (data.counts?.down ?? 0);
  const summary = problems ? t('services.problems', { count: problems }) : t('services.allRunning', { count: services.length });
  const more = services.length > ROWS ? `<div class="di-more">${esc(t('services.more', { count: services.length - ROWS }))}</div>` : '';
  const umbrel = data.umbrelError ? `<div class="di-more">${esc(t('services.unreachable'))}</div>` : '';
  return `
    ${HEAD(`<em>${esc(summary)}</em>`)}
    <div class="di">
      <div class="di-head" aria-hidden="true"><span></span><span>${esc(t('server.cpu'))}</span><span class="di-mem">${esc(t('server.ram'))}</span><span class="di-up">${esc(t('services.since'))}</span></div>
      <ul class="di-list">${services.slice(0, ROWS).map(row).join('')}</ul>
      ${umbrel || more}
    </div>`;
}
