// The release gate itself: it must catch what it promises to catch, and let
// ordinary files through.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkFileName, scanText } from '../../scripts/release-gate.mjs';

const found = (text) => scanText(text, 'x.js').length;

test('keys, personal places and sources it must refuse', () => {
  assert.equal(found('const token = "ghp_' + 'a'.repeat(30) + '"'), 1);
  assert.equal(found('-----BEGIN OPENSSH PRIVATE KEY-----'), 1);
  assert.equal(found('https://chicken-702b6-default-rtdb.example'), 1);
  assert.equal(found('the Knuddl app'), 1);
  assert.equal(found('default place: Hamburg'), 1);
  assert.equal(found('runs on the XPS 13'), 1);
  assert.equal(found('clips from Mixkit'), 1);
  assert.equal(found('mail me at someone@gmail.com'), 1);
  assert.equal(found('cd /home/user/project'), 1);
});

test('ordinary text passes', () => {
  assert.equal(found('const place = "Berlin"; // a city'), 0);
  assert.equal(found('Co-authored by noreply@anthropic.com'), 0);
  assert.equal(found('git config user.email 12345+name@users.noreply.github.com'), 0);
  assert.equal(found('contact: you@example.com'), 0);
  assert.equal(found('Signed-off-by: dependabot[bot] <support@github.com>'), 0);
  assert.equal(found('committer: GitHub <noreply@github.com>'), 0);
  assert.equal(found('mail me at paul@github.com'), 1);
  assert.equal(found("host 'evil.example:7777@reframe.local' is refused"), 0, 'a host name with userinfo, not an address');
  assert.equal(found('curl http://umbrel.local:2283'), 0);
});

test('files that must not be committed', () => {
  for (const name of ['.env', 'config/.env.local', 'cert.pem', 'id_rsa', 'media/day-coast.mp4', 'clip.MOV']) {
    assert.equal(checkFileName(name).length, 1, name);
  }
  for (const name of ['.env.example', 'app/server/env.js', 'docs/screenshots/dashboard.png', 'media/README.md']) {
    assert.equal(checkFileName(name).length, 0, name);
  }
});
