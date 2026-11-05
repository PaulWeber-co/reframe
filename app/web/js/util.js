// Helpers shared by the front-end modules.
import { getLanguage, locale } from './i18n.js';

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Every value from the server goes through esc() before it lands in HTML.
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// An icon from the sprite in index.html, e.g. icon('cloud')
export const icon = (name) => `<svg class="ic" aria-hidden="true"><use href="#i-${esc(name)}"/></svg>`;

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Numbers in the chosen language: 18432 → "18,432" (en) or "18.432" (de), 5.1 → "5.1" or "5,1"
export const num = (value, digits = 0) =>
  Number(value).toLocaleString(locale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 14 → "2 PM" (en) or "14 Uhr" (de): a full hour in the chosen language
export const hourText = (hour) => new Date(2000, 0, 1, hour).toLocaleTimeString(locale(), { hour: 'numeric' });

// A time of day "07:46" in the chosen language's clock style: "7:46 AM" or "07:46"
export const clockText = (hhmm) => {
  const [hour, minute] = String(hhmm).split(':').map(Number);
  return new Date(2000, 0, 1, hour, minute).toLocaleTimeString(locale(), { hour: getLanguage() === 'de' ? '2-digit' : 'numeric', minute: '2-digit' });
};
