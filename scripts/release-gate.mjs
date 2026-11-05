// The release gate: nothing leaves this repository that should not.
//
//   node scripts/release-gate.mjs             the files that are tracked by git
//   node scripts/release-gate.mjs --history   every line ever added, in every commit
//
// It looks for keys and tokens, anything that points at a person or a place
// that is not meant to be here, absolute paths of a build machine, files that
// should never be committed (env files, keys, videos) and files that are too
// large. CI runs it on every push, so it cannot get worse unnoticed.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RULES = [
  { name: 'a key or token', pattern: /(ghp_|github_pat_)[A-Za-z0-9_]{20,}|AIza[0-9A-Za-z_-]{30,}|xox[baprs]-[0-9A-Za-z-]{10,}|tskey-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9]{32,}/ },
  { name: 'a personal service or place', pattern: /knuddl|minifunk|firebase|chicken-702b6|rahlstedt|m(ö|oe)nckeberg|hamburg/i },
  { name: 'a laptop the code was first written for', pattern: /\bxps\b|9350/i },
  { name: 'a video source whose terms forbid redistribution', pattern: /mixkit/i },
  { name: 'an email address (use a no-reply address or example.com)', pattern: /[A-Za-z0-9._%+-]+(?:(?<!\b(?:support|noreply))@|@(?!github\.com\b))(?!users\.noreply\.github\.com|example\.(com|org|net)\b|anthropic\.com\b|[A-Za-z0-9.-]*\.local\b)[A-Za-z0-9-]+\.[A-Za-z.]{2,}/ },
  { name: 'an absolute path of a build machine', pattern: /\/home\/user\b|\/tmp\/claude|\/Users\/[a-z]/i },
];

const FORBIDDEN_FILE = /(^|\/)(\.env(\..+)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519)|.*\.(mp4|mov|mkv|webm|avi|m4v))$/i;
const ENV_EXAMPLE = /\.env\.example$/;
const MAX_BYTES = 1024 * 1024;
const LARGE_OK = /(^|\/)(fonts\/|docs\/screenshots\/)/;
const SKIP = /(^|\/)(scripts\/release-gate\.mjs|app\/test\/release-gate\.test\.js|package-lock\.json)$/;
const BINARY = /\.(png|jpe?g|gif|webp|ico|woff2?|ttf)$/i;

export function scanText(text, label) {
  const problems = [];
  text.split('\n').forEach((line, index) => {
    for (const rule of RULES) {
      if (rule.pattern.test(line)) problems.push(`${label}:${index + 1}: ${rule.name}: ${line.trim().slice(0, 120)}`);
    }
  });
  return problems;
}

export function checkFileName(path) {
  return FORBIDDEN_FILE.test(path) && !ENV_EXAMPLE.test(path) ? [`${path}: a file that must not be committed`] : [];
}

function scanFiles() {
  const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const problems = [];
  for (const file of files) {
    problems.push(...checkFileName(file));
    if (SKIP.test(file)) continue;
    const size = statSync(file).size;
    if (size > MAX_BYTES && !LARGE_OK.test(file)) problems.push(`${file}: ${(size / 1024 / 1024).toFixed(1)} MB is too large for the repository`);
    if (BINARY.test(file)) continue;
    problems.push(...scanText(readFileSync(file, 'utf8'), file));
  }
  return { count: files.length, problems };
}

function scanHistory() {
  const log = execFileSync('git', ['log', '--all', '--format=commit %H%n%an <%ae>%n%B', '-p', '--no-color'], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  const problems = [];
  let commit = '';
  let file = '';
  for (const line of log.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7, 14);
    else if (line.startsWith('+++ b/')) file = line.slice(6);
    else if (line.startsWith('diff --git')) file = '';
    if (SKIP.test(file)) continue;
    // Commit messages and added lines; "Author:" lines carry the author's address
    const added = line.startsWith('+') && !line.startsWith('+++');
    const header = !line.startsWith('-') && !line.startsWith(' ') && !line.startsWith('+') && !line.startsWith('diff') && !line.startsWith('@@') && !line.startsWith('index') && !line.startsWith('new file') && !line.startsWith('deleted file') && !line.startsWith('---');
    if (!added && !header) continue;
    for (const rule of RULES) if (rule.pattern.test(line)) problems.push(`${commit} ${file || '(message)'}: ${rule.name}: ${line.trim().slice(0, 120)}`);
  }
  const names = execFileSync('git', ['log', '--all', '--name-only', '--format='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n').filter(Boolean);
  for (const name of new Set(names)) problems.push(...checkFileName(name));
  return { count: log.split('\ncommit ').length, problems };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const history = process.argv.includes('--history');
  const { count, problems } = history ? scanHistory() : scanFiles();
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n✗ ${problems.length} problem(s) in ${count} ${history ? 'commits' : 'files'}`);
    process.exit(1);
  }
  console.log(`✓ release gate passed: ${count} ${history ? 'commits' : 'files'} checked`);
}
