// Every front-end widget module, by the id its server widget uses.
// A tile whose id has no module here shows a "coming soon" placeholder.
import { t } from '../i18n.js';
import * as services from './services.js';
import * as photos from './photos.js';
import * as home from './home.js';
import * as calendar from './calendar.js';
import * as server from './server.js';
import * as todo from './todo.js';
import * as commute from './commute.js';
import * as weather from './weather.js';
import * as wiki from './wiki.js';

const widgets = { weather, commute, photos, calendar, services, todo, server, home, wiki };
export default widgets;

// The name of a widget in the chosen language, or its id when it has none
export const labelOf = (id) => (widgets[id]?.labelKey ? t(widgets[id].labelKey) : id);
