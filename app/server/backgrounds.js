// The background clips on disk, by scene. A clip is <scene>-<name>.mp4 in
// REFRAME_MEDIA_DIR (with a <scene>-<name>.jpg poster that the image makes on
// first start), so the pool is simply what is in the folder: drop one more
// file in and the wall has one more clip to choose from. The name after the
// dash is up to you: letters, digits and hyphens.
// Which of them play on a given day decides the front end (web/js/scene.js).
import { readdir } from 'node:fs/promises';

export const SCENES = ['morning', 'day', 'evening', 'late'];
const CLIP = /^(morning|day|evening|late)-([a-z0-9][a-z0-9-]*)\.mp4$/;

// { morning: ['morning-35078', …], day: […], evening: […], late: […] }
export async function listBackgrounds(dir) {
  const pool = Object.fromEntries(SCENES.map((scene) => [scene, []]));
  let files = [];
  try {
    files = await readdir(dir);
  } catch {
    return pool; // no media folder: the gradients show
  }
  for (const file of files.sort()) {
    const match = CLIP.exec(file);
    if (match) pool[match[1]].push(file.slice(0, -'.mp4'.length));
  }
  return pool;
}
