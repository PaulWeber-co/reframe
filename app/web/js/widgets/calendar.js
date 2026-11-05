import { locale, t } from '../i18n.js';
import { esc, icon } from '../util.js';

export const labelKey = 'calendar.title';

const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

// "Today 9:30 AM", "Tomorrow 2:00 PM", "Sun, Oct 25" (all day) or "Wed, Oct 28 6:00 PM":
// short enough for one line in the tile, in the browser's (the kiosk's) time zone.
export function when(event, now = new Date()) {
  const start = event.allDay ? new Date(`${event.start}T12:00:00`) : new Date(event.start);
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const day =
    dayKey(start) === dayKey(now)
      ? t('calendar.today')
      : dayKey(start) === dayKey(tomorrow)
        ? t('calendar.tomorrow')
        : start.toLocaleDateString(locale(), { weekday: 'short', day: 'numeric', month: 'short' });
  if (event.allDay) return day;
  return `${day} ${start.toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit' })}`;
}

export function render(data) {
  const head = `<div class="lbl">${icon('cal')}${esc(t('calendar.title'))}`;
  if (!data) return `${head}</div><div class="loading">${esc(t('common.loading'))}</div>`;
  const items = data.length
    ? data.slice(0, 4).map((event) => `<li><time>${esc(when(event))}</time><strong>${esc(event.title)}</strong>${event.location ? `<small>${esc(event.location)}</small>` : ''}</li>`).join('')
    : `<li class="empty">${esc(t('calendar.empty'))}</li>`;
  return `${head}<em>${esc(t('calendar.range'))}</em></div><ol class="calendar-list">${items}</ol>`;
}
