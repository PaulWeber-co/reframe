// To-do tile: the open items of the local list (server/widgets/todo.js), the
// most urgent first. A dot in the person's colour, the text, and when it is
// due. Tapping an item ticks it off (the server confirms with fresh data).
// Every value goes through esc(). Styles in web/css/w-todo.css.
import { locale, plural, t } from '../i18n.js';
import { esc, icon } from '../util.js';

export const labelKey = 'todo.title';

const ROWS = 5;

// Days until due → "overdue", "today", "tomorrow", "Fri, Oct 30" or ""
export function dueText(inDays, due) {
  if (inDays === null || inDays === undefined) return { group: '', text: '' };
  if (inDays < 0) return { group: 'overdue', text: t('todo.overdue') };
  if (inDays === 0) return { group: 'today', text: t('todo.today') };
  if (inDays === 1) return { group: 'tomorrow', text: t('todo.tomorrow') };
  return { group: 'later', text: new Date(`${due}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' }) };
}

function row(item) {
  const when = dueText(item.inDays, item.due);
  const color = item.color === null || item.color === undefined ? 'none' : String(item.color);
  const payload = esc(JSON.stringify({ id: item.id }));
  return `
    <li class="td-row" data-action="toggle" data-payload='${payload}' role="button" tabindex="0">
      <span class="td-dot td-c${esc(color)}"${item.who ? ` title="${esc(item.who)}"` : ''}></span>
      <span class="td-text">${esc(item.text)}${when.text ? `<span class="td-when td-${esc(when.group)}">${esc(when.text)}</span>` : ''}</span>
    </li>`;
}

export function render(data) {
  const head = (extra = '') => `<div class="lbl">${icon('check')}${esc(t('todo.title'))}${extra ? `<em>${esc(extra)}</em>` : ''}</div>`;
  if (!data) return `${head()}<div class="loading">${esc(t('common.loading'))}</div>`;
  if (!data.items.length) {
    return `${head()}<div class="td td-empty"><div class="td-allDone">${esc(t('todo.allDone'))}</div><div class="sub">${esc(t('todo.addHint'))}</div></div>`;
  }
  const more = data.open > ROWS ? `<div class="td-more">${esc(plural('todo.more', data.open - ROWS))}</div>` : '';
  return `
    ${head(String(data.open))}
    <div class="td"><ul class="td-list">${data.items.slice(0, ROWS).map(row).join('')}</ul>${more}</div>`;
}
