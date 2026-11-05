// Wikipedia tile: "On this day, October 27" (the main page's events) in the
// morning, "Did you know?" in the afternoon, the article of the day in the evening,
// with a small picture beside the text when there is one. Data from
// server/widgets/wiki.js, every value through esc(); the picture is a data
// URI the server fetched. Styles in web/css/w-wiki.css.
import { t } from '../i18n.js';
import { esc, icon } from '../util.js';

export const labelKey = 'wiki.title';

const HEADINGS = { events: 'wiki.onThisDay', facts: 'wiki.didYouKnow', article: 'wiki.article' };

// The text as large as it fits: beside a picture there is about two thirds
// of the width (measured in a 2×1 tile with the main page's texts up to 190
// characters). Soft hyphens do not count.
export function fit(text, picture = false) {
  const length = String(text ?? '').replace(/­/g, '').length;
  if (picture) return length > 190 ? ' wk-s16' : length > 140 ? ' wk-s18' : ' wk-s20';
  if (length > 220) return ' wk-s18';
  return length > 150 ? ' wk-s21' : length > 110 ? ' wk-s24' : ' wk-s28';
}

export function render(data) {
  if (!data) return `<div class="lbl">${icon('note')}${esc(t('wiki.title'))}</div><div class="loading">${esc(t('common.loading'))}</div>`;
  const counter = data.count > 1 ? `<em>${esc(data.position)}/${esc(data.count)}</em>` : '';
  // A very long text needs the picture's room
  const roomy = String(data.text ?? '').replace(/­/g, '').length <= 220;
  const image = roomy && typeof data.image === 'string' && data.image.startsWith('data:image/')
    ? `<img class="wk-img" src="${esc(data.image)}" alt="">`
    : '';
  const lead = data.year
    ? `<div class="wk-lead">${esc(data.year)}</div>`
    : data.kind === 'article' && data.title ? `<div class="wk-lead wk-title">${esc(data.title)}</div>` : '';
  return `
    <div class="lbl">${icon('note')}${esc(t(HEADINGS[data.kind] ?? HEADINGS.facts, { date: data.date }))}${counter}</div>
    <div class="wk${image ? ' wk-pic' : ''}">
      ${image}
      <div class="wk-body">
        ${lead}
        <p class="wk-text${fit(data.text, Boolean(image))}">${esc(data.text)}</p>
      </div>
    </div>`;
}
