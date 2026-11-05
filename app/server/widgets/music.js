// Music mode. No tile of its own: while something plays through the AirPlay
// receiver the front end (web/js/features/music.js) shows the player under the
// clock. The receiver is shairport-sync, which hands over title, artist, cover
// and progress through a metadata pipe (server/sources/shairport.js).
//
// Settings:
//   REFRAME_SHAIRPORT_PIPE   metadata pipe of shairport-sync, default
//                            /run/shairport-sync/metadata
//   REFRAME_DEMO_MUSIC       "1": in demo mode a sample track plays
//
// The source pushes, so watch() publishes every change at once; fetch() only
// repeats the current state. Without the receiver the state stays inactive.
import { readFileSync } from 'node:fs';
import { createShairportSource, DEFAULT_PIPE, inactiveState } from '../sources/shairport.js';

const idle = () => ({ ...inactiveState(), via: null });

// The running source per hub context, so fetch() can read its state
const sources = new WeakMap();

// The demo plays a real piece with a real cover, both free to use: Beethoven's
// "Moonlight Sonata" (composed 1801, in the public domain) and Caspar David
// Friedrich's "Wanderer above the Sea of Fog" (c. 1818, public domain, from
// Wikimedia Commons) as the cover. No audio is involved: the wall only shows
// what an AirPlay sender announces.
export const DEMO_COVER = `data:image/jpeg;base64,${readFileSync(new URL('../assets/demo-cover.jpg', import.meta.url)).toString('base64')}`;

export const DEMO_TRACK = {
  title: 'Moonlight Sonata',
  artist: 'Ludwig van Beethoven',
  album: 'Piano Sonata No. 14',
  source: 'Alex iPhone',
  duration: 372,
};

const demoEnabled = (config) => typeof config?.get === 'function' && config.get('REFRAME_DEMO_MUSIC', '0') === '1';

export default {
  id: 'music',
  tile: false, // drives music mode, has no tile and no module in web/js/widgets/
  intervalMs: 30_000,
  isConfigured: () => true,

  watch(ctx, emit) {
    let shown = idle();
    const airplay = createShairportSource({
      path: ctx.config.get('REFRAME_SHAIRPORT_PIPE', DEFAULT_PIPE),
      log: ctx.log,
      onChange: (state) => {
        shown = state.active ? { ...state, via: 'airplay' } : idle();
        emit(shown);
      },
    });
    const running = { get state() { return shown; } };
    sources.set(ctx, running);
    airplay.start();
    return () => {
      airplay.stop();
      if (sources.get(ctx) === running) sources.delete(ctx);
    };
  },

  fetch(ctx) {
    return sources.get(ctx)?.state ?? idle();
  },

  // Inactive unless REFRAME_DEMO_MUSIC is set; then the sample track plays in a loop,
  // its position follows the clock.
  demo({ config, now } = {}) {
    if (!demoEnabled(config)) return idle();
    const at = (now?.() ?? new Date()).getTime();
    const position = Math.round(((at / 1000 + 48) % DEMO_TRACK.duration) * 1000) / 1000;
    return {
      active: true,
      playing: true,
      title: DEMO_TRACK.title,
      artist: DEMO_TRACK.artist,
      album: DEMO_TRACK.album,
      source: DEMO_TRACK.source,
      via: 'airplay',
      coverUrl: DEMO_COVER,
      position,
      duration: DEMO_TRACK.duration,
      positionAt: at,
      volume: 0.6,
    };
  },
};
