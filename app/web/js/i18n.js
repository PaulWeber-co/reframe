// Translations. The language files are web/i18n/<lang>.json, flat objects of
// "area.key": "text". Texts may contain {name} placeholders.
//
// The page loads its language once at start (loadLanguage) and sets it again
// when the setting changes. Plurals use two keys: "key.one" and "key.other",
// chosen by plural(key, count, params).
//
// Under Node (tests, tools) English is loaded from disk at import time, so
// render functions work without any set-up there.

let language = 'en';
let catalog = {};

export const getLanguage = () => language;

// The locale that Intl and toLocale…String() use for this language
export const locale = () => (language === 'de' ? 'de-DE' : 'en-US');

export function setLanguage(lang, messages) {
  language = lang === 'de' ? 'de' : 'en';
  catalog = messages && typeof messages === 'object' ? messages : {};
}

function fill(text, params) {
  return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;
}

// A missing key shows as the key itself, which makes it easy to spot
export function t(key, params) {
  return fill(Object.hasOwn(catalog, key) ? catalog[key] : key, params);
}

export function plural(key, count, params = {}) {
  const form = new Intl.PluralRules(locale()).select(count) === 'one' ? 'one' : 'other';
  return t(`${key}.${form}`, { count, ...params });
}

export async function loadLanguage(lang, fetchImpl = globalThis.fetch) {
  const wanted = lang === 'de' ? 'de' : 'en';
  const response = await fetchImpl(`/i18n/${wanted}.json`, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`language file ${wanted}: HTTP ${response.status}`);
  setLanguage(wanted, await response.json());
}

if (typeof process !== 'undefined' && process.versions?.node) {
  const { readFileSync } = await import('node:fs');
  // Node only: load a language file from disk (tests switch with this)
  globalThis.__reframeLoadLanguage = (lang) => {
    const file = new URL(`../i18n/${lang}.json`, import.meta.url);
    setLanguage(lang, JSON.parse(readFileSync(file, 'utf8')));
  };
  globalThis.__reframeLoadLanguage('en');
}
