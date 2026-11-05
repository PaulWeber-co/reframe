// Starts the real server in demo mode on a free port, checks the main
// endpoints and the front-end files, then stops it. Always finishes within
// 30 seconds, so it is safe in scripts and unattended runs: npm run smoke
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const child = spawn(process.execPath, ['server/index.js', '--demo'], {
  cwd: root,
  env: { ...process.env, REFRAME_PORT: '0', REFRAME_HOST: '127.0.0.1', REFRAME_DATA_DIR: mkdtempSync(join(tmpdir(), 'dash-smoke-')) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const stop = (code, message) => {
  console[code ? 'error' : 'log'](message);
  child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
};
setTimeout(() => stop(1, '✗ Timeout: the server did not answer within 30 s'), 30_000).unref();

let output = '';
child.stderr.on('data', (chunk) => process.stderr.write(chunk));
child.on('exit', (code) => {
  if (code) stop(1, `✗ Server exited with code ${code}\n${output}`);
});
child.stdout.on('data', async (chunk) => {
  output += chunk;
  const match = output.match(/localhost:(\d+)/);
  if (!match || output.includes('__checking__')) return;
  output += '__checking__';
  const base = `http://127.0.0.1:${match[1]}`;
  try {
    const check = async (path, test) => {
      const response = await fetch(base + path, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
      await test(response);
      console.log(`✓ ${path}`);
    };
    await new Promise((resolve) => setTimeout(resolve, 500)); // first widget round
    await check('/', async (r) => { if (!(await r.text()).includes('id="stage"')) throw new Error('/ is not the dashboard'); });
    await check('/css/dashboard.css', async () => {});
    await check('/js/app.js', async () => {});
    await check('/api/state', async (r) => {
      const state = await r.json();
      const ids = Object.keys(state.widgets);
      if (!ids.length) throw new Error('/api/state: no widgets');
      const broken = ids.filter((id) => state.widgets[id].error);
      if (broken.length) throw new Error(`/api/state: errors in ${broken.join(', ')}`);
      console.log(`  widgets: ${ids.join(', ')}`);
    });
    await check('/api/layout', async (r) => { if (!Array.isArray((await r.json()).tiles)) throw new Error('/api/layout has no tiles'); });
    await check('/control', async (r) => { if (!(await r.text()).includes('id="control"')) throw new Error('/control is not the control center'); });
    await check('/api/control', async (r) => {
      const control = await r.json();
      if (!control.effective?.display) throw new Error('/api/control has no screen state');
      console.log(`  screen: ${control.effective.display} (${control.effective.reason})`);
    });
    await check('/setup', async (r) => { if (!(await r.text()).includes('id="setup"')) throw new Error('/setup is not the setup page'); });
    await check('/api/config', async (r) => { if (!(await r.json()).fields?.length) throw new Error('/api/config has no fields'); });
    for (const lang of ['en', 'de']) await check(`/i18n/${lang}.json`, async (r) => { if (!(await r.json())['common.loading']) throw new Error(`/i18n/${lang}.json is empty`); });
    stop(0, '✓ Smoke test passed');
  } catch (error) {
    stop(1, `✗ ${error.message}`);
  }
});
