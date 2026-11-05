// The settings page (/setup): place search and every setting from
// server/settings.js, grouped. The page reads GET /api/config (secrets only
// say whether they are set), and saves with PUT /api/config: only the fields
// that changed, so leaving a secret empty keeps it.
import { loadLanguage, t } from './i18n.js';
import { esc } from './util.js';

const GROUPS = ['general', 'calendar', 'commute', 'homeassistant', 'photos', 'services', 'access'];
const REPO = 'https://github.com/PaulWeber-co/reframe';
const root = document.getElementById('setup');
let fields = [];
let lang = 'en';
let demo = false;
let version = '';
let status = '';

const label = (key) => t(`settings.${key}`);

async function send(method, path, body) {
  const response = await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (response.status === 401) throw new Error(t('setup.pinNote'));
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

function control(field) {
  const id = `f-${field.key}`;
  const common = `id="${id}" name="${esc(field.key)}"${field.locked ? ' disabled' : ''}`;
  if (field.type === 'select') {
    const options = field.options.map((option) => `<option value="${esc(option)}"${(field.value || field.options[0]) === option ? ' selected' : ''}>${esc(t(`settings.${field.key}.${option}`))}</option>`).join('');
    return `<select ${common}>${options}</select>`;
  }
  if (field.type === 'secret') {
    const note = field.set ? `<small class="su-set">${esc(t('setup.secretSet'))}</small>` : '';
    const clear = field.set && !field.locked ? `<button type="button" class="su-link" data-clear="${esc(field.key)}">${esc(t('setup.clear'))}</button>` : '';
    return `<input ${common} type="password" autocomplete="new-password" spellcheck="false" placeholder="${esc(field.set ? t('setup.secretPlaceholder') : '')}"><span class="su-after">${note}${clear}</span>`;
  }
  return `<input ${common} type="text" spellcheck="false" autocapitalize="off" value="${esc(field.value)}">`;
}

function row(field) {
  const locked = field.locked ? `<small class="su-set">${esc(t('setup.locked'))}</small>` : '';
  return `
    <div class="su-row">
      <label for="f-${esc(field.key)}">${esc(label(field.key))}</label>
      ${control(field)}${locked}
      <small class="su-hint">${esc(t(`settings.${field.key}.hint`))}</small>
    </div>`;
}

function search() {
  return `
    <div class="su-search">
      <label for="su-q">${esc(t('setup.searchLabel'))}</label>
      <div class="su-search-row">
        <input id="su-q" type="search" placeholder="${esc(t('setup.searchPlaceholder'))}" autocomplete="off">
        <button type="button" class="su-button" data-search>${esc(t('setup.searchButton'))}</button>
      </div>
      <ul class="su-results" id="su-results" aria-live="polite"></ul>
    </div>`;
}

function about() {
  const link = (path, key) => `<a href="${REPO}${path}" target="_blank" rel="noopener">${esc(t(key))}</a>`;
  return `
    <section class="su-card su-about">
      <h2>${esc(t('setup.about.title'))}</h2>
      <p>${esc(t('setup.about.text'))}</p>
      <p class="su-facts">${esc(t('setup.about.version', { version: version || '?' }))} · ${esc(t('setup.about.license'))}</p>
      <p class="su-links">${link('', 'setup.about.source')} · ${link('/issues', 'setup.about.issues')} · ${link('/blob/main/ATTRIBUTION.md', 'setup.about.attribution')}</p>
    </section>`;
}

function render() {
  const cards = GROUPS.map((group) => {
    const inGroup = fields.filter((field) => field.group === group);
    return `<section class="su-card"><h2>${esc(t(`setup.group.${group}`))}</h2>${group === 'general' ? search() : ''}${inGroup.map(row).join('')}</section>`;
  }).join('');
  root.innerHTML = `
    <header class="su-head">
      <div><h1 id="su-title">${esc(t('setup.title'))}</h1><p>${esc(t('setup.intro'))}</p></div>
      <nav><a href="/">${esc(t('setup.back'))}</a><a href="/control">${esc(t('setup.controlLink'))}</a></nav>
    </header>
    ${demo ? `<p class="su-banner">${esc(t('setup.demoNote'))}</p>` : ''}
    <form id="su-form" novalidate>${cards}
      <div class="su-bar"><button type="submit" class="su-button su-primary">${esc(t('setup.save'))}</button><span class="su-status" role="status">${esc(status)}</span></div>
    </form
    ${about()}
    <p class="su-credits">${esc(t('setup.credits'))}</p>`;
}

// Only what the user changed: a text field that differs, a secret that was typed
function changes(form) {
  const result = {};
  for (const field of fields) {
    if (field.locked) continue;
    const input = form.elements[field.key];
    if (!input) continue;
    const value = input.value.trim();
    if (field.type === 'secret') {
      if (value) result[field.key] = value;
    } else if (value !== (field.value || (field.type === 'select' ? field.options[0] : ''))) {
      result[field.key] = value === '' ? null : value;
    }
  }
  return result;
}

async function save(body) {
  status = t('setup.saving');
  render();
  try {
    const reply = await send('PUT', '/api/config', body);
    const languageChanged = 'REFRAME_LANG' in body && body.REFRAME_LANG !== lang;
    fields = reply.fields;
    status = t('setup.saved');
    if (languageChanged) return location.reload();
  } catch (error) {
    status = t('setup.failed', { error: error.message });
  }
  render();
}

async function findPlace() {
  const q = document.getElementById('su-q').value.trim();
  const list = document.getElementById('su-results');
  if (q.length < 2) return;
  const { results } = await send('GET', `/api/geocode?q=${encodeURIComponent(q)}`);
  list.innerHTML = results.length
    ? results.map((place, i) => `<li><span><strong>${esc(place.name)}</strong> <small>${esc(place.region)}</small></span><button type="button" class="su-link" data-use="${i}">${esc(t('setup.searchUse'))}</button></li>`).join('')
    : `<li class="su-none">${esc(t('setup.searchNone'))}</li>`;
  list.results = results;
}

root.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.search !== undefined) findPlace().catch((error) => alert(error.message));
  if (button.dataset.use !== undefined) {
    const place = document.getElementById('su-results').results[Number(button.dataset.use)];
    save({ REFRAME_PLACE: place.name, REFRAME_LAT: String(place.lat), REFRAME_LON: String(place.lon), ...(place.timezone ? { REFRAME_TIMEZONE: place.timezone } : {}) });
  }
  if (button.dataset.clear) save({ [button.dataset.clear]: null });
});
root.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'su-q') {
    event.preventDefault();
    findPlace().catch((error) => alert(error.message));
  }
});
root.addEventListener('submit', (event) => {
  event.preventDefault();
  const body = changes(event.target);
  if (Object.keys(body).length) save(body);
  else {
    status = t('setup.saved');
    render();
  }
});

async function boot() {
  const state = await (await fetch('/api/state')).json();
  lang = state.lang;
  demo = state.demo;
  version = state.version ?? '';
  await loadLanguage(lang);
  document.documentElement.lang = lang;
  document.title = `Reframe · ${t('setup.title')}`;
  fields = (await (await fetch('/api/config')).json()).fields;
  render();
}

boot().catch((error) => {
  console.error(error);
  root.innerHTML = '<p class="su-note">Reframe is not reachable. Is the server running?</p>';
});
