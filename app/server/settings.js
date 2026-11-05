// The settings the setup page can change. Each one is also an environment
// variable of the same name. Labels and hints live in the language files
// under settings.<KEY> and settings.<KEY>.hint; this file only describes the
// shape of a value.
//
//   text     any text up to 2000 characters
//   secret   like text, but never sent back to the browser
//   url      http:// or https://
//   select   one of options
//   number   a number within min and max
//   zone     an IANA time zone name such as Europe/Berlin
import { Buffer } from 'node:buffer';

export const GROUPS = ['general', 'calendar', 'commute', 'homeassistant', 'photos', 'services', 'access'];

export const SETTINGS = [
  { key: 'REFRAME_LANG', group: 'general', type: 'select', options: ['en', 'de'] },
  { key: 'REFRAME_PLACE', group: 'general', type: 'text' },
  { key: 'REFRAME_LAT', group: 'general', type: 'number', min: -90, max: 90 },
  { key: 'REFRAME_LON', group: 'general', type: 'number', min: -180, max: 180 },
  { key: 'REFRAME_TIMEZONE', group: 'general', type: 'zone' },

  { key: 'REFRAME_CALENDAR_ICS', group: 'calendar', type: 'secret' },

  { key: 'REFRAME_TOMTOM_KEY', group: 'commute', type: 'secret' },
  { key: 'REFRAME_HOME_ADDRESS', group: 'commute', type: 'text' },
  { key: 'REFRAME_WORK_ADDRESS', group: 'commute', type: 'text' },
  { key: 'REFRAME_COMMUTE_LABEL', group: 'commute', type: 'text' },
  { key: 'REFRAME_COMMUTE_DAYS', group: 'commute', type: 'text' },
  { key: 'REFRAME_COMMUTE_FROM', group: 'commute', type: 'text' },
  { key: 'REFRAME_COMMUTE_TO', group: 'commute', type: 'text' },

  { key: 'REFRAME_HA_URL', group: 'homeassistant', type: 'url' },
  { key: 'REFRAME_HA_TOKEN', group: 'homeassistant', type: 'secret' },
  { key: 'REFRAME_HA_ENTITIES', group: 'homeassistant', type: 'text' },
  { key: 'REFRAME_HA_CALENDAR_ENTITY', group: 'homeassistant', type: 'text' },

  { key: 'REFRAME_IMMICH_URL', group: 'photos', type: 'url' },
  { key: 'REFRAME_IMMICH_KEY', group: 'photos', type: 'secret' },

  { key: 'REFRAME_SERVICES_NAMES', group: 'services', type: 'text' },
  { key: 'REFRAME_SERVICES_HIDE', group: 'services', type: 'text' },

  { key: 'REFRAME_PIN', group: 'access', type: 'secret' },
  { key: 'REFRAME_ALLOWED_HOSTS', group: 'access', type: 'text' },
];

const BY_KEY = new Map(SETTINGS.map((field) => [field.key, field]));
const MAX_TEXT = 2000;

const bad = (message) => Object.assign(new Error(message), { status: 400 });

function validTimeZone(name) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

function clean(field, value) {
  if (typeof value === 'number' && field.type === 'number') value = String(value);
  if (typeof value !== 'string') throw bad(`${field.key}: expected text`);
  const text = value.trim();
  if (Buffer.byteLength(text) > MAX_TEXT) throw bad(`${field.key}: too long`);
  if (!text) return null;
  switch (field.type) {
    case 'select':
      if (!field.options.includes(text)) throw bad(`${field.key}: must be one of ${field.options.join(', ')}`);
      return text;
    case 'number': {
      const number = Number(text);
      if (!Number.isFinite(number) || number < field.min || number > field.max) {
        throw bad(`${field.key}: must be a number from ${field.min} to ${field.max}`);
      }
      return String(number);
    }
    case 'url':
      if (!/^https?:\/\/[^\s]+$/i.test(text)) throw bad(`${field.key}: must start with http:// or https://`);
      return text;
    case 'zone':
      if (!validTimeZone(text)) throw bad(`${field.key}: unknown time zone`);
      return text;
    default:
      return text;
  }
}

// { KEY: value } → { KEY: cleanValue | null }; an empty value clears the key.
export function validateSettings(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw bad('Expected a JSON object');
  const result = {};
  for (const [key, value] of Object.entries(changes)) {
    const field = BY_KEY.get(key);
    if (!field) throw bad(`Unknown setting ${key}`);
    result[key] = value === null ? null : clean(field, value);
  }
  return result;
}
