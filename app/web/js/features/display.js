// What the wall display shows, decided by the control center on the server
// (server/control.js) and pushed with every "control" event:
//
//   on     the dashboard, its scene by time of day
//   night  only the dimmed clock (scene "night")
//   sleep  black; a tap wakes it
//   off    the kiosk browser is stopped by the host agent anyway
//
// Only the kiosk on the laptop (?kiosk=1) goes dark and wakes on a tap. A
// browser on a phone or another computer keeps showing the dashboard and names the wall's
// state in a chip, so looking at the dashboard never changes the wall.
// The feature switches reach the page here too: background videos and the
// music view (data-musicmode, read by music.js).
import { t } from '../i18n.js';
import { $ } from '../util.js';

const AWAY_STATES = new Set(['night', 'sleep', 'off']);

// A container without access to /sys cannot set the backlight: the agent then
// reports softwareDim (the brightness it would have set, in percent) and the
// kiosk page darkens itself with a black layer. Never fully dark: 88 % at most.
export function dimOpacity(softwareDim) {
  if (!Number.isFinite(softwareDim)) return 0;
  return Math.round(Math.min(0.88, Math.max(0, 1 - softwareDim / 100)) * 100) / 100;
}

export function init({ stage, kiosk, scenes, onControl, setSceneOverride }) {
  let display = 'on';
  let touchWake = 0;
  let waking = false;
  let wokeAt = 0;
  const chip = $('#chip-wall');

  setSceneOverride(() => (kiosk && display === 'night' ? 'night' : null));

  onControl((snapshot) => {
    const settings = snapshot?.settings;
    display = snapshot?.effective?.display ?? 'on';
    touchWake = settings?.rules?.touchWake ?? 0;
    stage.dataset.display = kiosk ? display : 'on';
    stage.style.setProperty('--dim', String(kiosk ? dimOpacity(snapshot?.status?.softwareDim) : 0));
    stage.dataset.musicmode = settings?.features?.musicMode === false ? '0' : '1';
    const dark = kiosk && (display === 'sleep' || display === 'off');
    const motion = settings?.features?.videos !== false && !dark;
    scenes.setVideos(motion);
    // Still pictures and gradients stand still too: videos off means the GPU rests
    stage.dataset.still = motion ? '0' : '1';
    if (chip) {
      const away = !kiosk && AWAY_STATES.has(display);
      chip.classList.toggle('on', Boolean(away));
      if (away) chip.lastChild.textContent = t('display.wallChip', { state: t(`control.display.${display}`).toLowerCase() });
    }
  });

  // A tap on the black screen or the night clock: show the dashboard for a
  // few minutes. The tap itself never reaches a tile underneath.
  stage.addEventListener(
    'pointerdown',
    (event) => {
      if (!kiosk || !touchWake || (display !== 'sleep' && display !== 'night')) return;
      event.preventDefault();
      event.stopPropagation();
      wokeAt = Date.now();
      if (waking) return;
      waking = true;
      fetch('/api/control/wake', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .catch((error) => console.error('Wake:', error))
        .finally(() => {
          waking = false;
        });
    },
    true,
  );
  // ... nor does the click that follows it, even if the tiles are back by then
  stage.addEventListener(
    'click',
    (event) => {
      if (Date.now() - wokeAt > 800) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}
