// Who may reach the dashboard and who may change things.
//
// Reading stays open in the home network: the wall shows everything anyway.
// Three checks keep other web pages and other devices out:
//
//   Host       only names used at home or over Tailscale (reframe.local, an IP
//              address, reframe.tailnet.ts.net, …). A foreign page whose domain a
//              DNS trick points at this machine ("DNS rebinding") gets nothing.
//   changes    (POST/PUT under /api/) only as JSON and only from the
//              dashboard's own origin. A page on another site cannot send
//              JSON without the browser asking first, and nobody answers.
//   PIN        optional, REFRAME_PIN: changes from other devices need the PIN
//              once per browser (a cookie), or in the header x-dashboard-pin
//              (Home Assistant's rest_command). The kiosk on the laptop itself
//              (127.0.0.1) never asks.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const HOME_SUFFIXES = ['.local', '.lan', '.home', '.home.arpa', '.internal', '.localdomain', '.fritz.box', '.speedport.ip', '.ts.net'];
const COOKIE = 'reframe_dash';
const MAX_FAILURES = 5;
const MAX_FAILURES_ALL = 20; // from all addresses together
const LOCKOUT_MS = 10 * 60_000;

export const isLoopback = (address) => /^(::ffff:)?127\./.test(String(address ?? '')) || address === '::1';

// "reframe.local:7777" → "reframe.local"; "[fe80::1]:7777" → "fe80::1"
export function hostName(header) {
  const text = String(header ?? '').trim().toLowerCase();
  if (text.startsWith('[')) {
    const end = text.indexOf(']');
    return end > 1 ? text.slice(1, end) : '';
  }
  return text.replace(/:\d*$/, '').replace(/\.$/, '');
}

export function isAllowedHost(header, extra = []) {
  const host = hostName(header);
  if (!host) return false;
  if (host.includes(':')) return /^[0-9a-f:.]+$/.test(host); // an IPv6 address
  // Only what a browser sends as a host name: no userinfo, no spaces
  if (!/^[a-z0-9._-]+$/.test(host)) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host === 'localhost' || !host.includes('.')) return true; // "reframe"
  return HOME_SUFFIXES.some((suffix) => host.endsWith(suffix)) || extra.includes(host);
}

// The Origin header of a change must name this very dashboard.
export function isSameOrigin(origin, hostHeader) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host === String(hostHeader ?? '').toLowerCase();
  } catch {
    return false;
  }
}

const parseList = (text) =>
  String(text ?? '')
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);

function cookieValue(header, name) {
  for (const part of String(header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

const digest = (text) => createHash('sha256').update(String(text)).digest();

export function createAccess({ config, store, now = () => Date.now() }) {
  const get = (key) => String(config.get?.(key, '') ?? '').trim();
  // Read on every request: the setup page can set or change them while running
  const pinNow = () => get('REFRAME_PIN');
  const hostsNow = () => parseList(get('REFRAME_ALLOWED_HOSTS'));
  const failures = new Map(); // address → { count, until }
  const everyone = { count: 0, since: 0, until: 0 }; // all addresses together
  let secret = null;

  // A random key in the data directory; the cookie is an HMAC of the PIN with
  // it, so a new PIN logs every browser out and the cookie reveals nothing.
  async function token() {
    if (!secret) {
      const saved = await store.read('secret.json', null);
      if (typeof saved?.secret === 'string' && saved.secret.length >= 32) secret = saved.secret;
      else {
        secret = randomBytes(32).toString('hex');
        await store.write('secret.json', { secret });
      }
    }
    return createHmac('sha256', secret).update(`pin:${pinNow()}`).digest('hex');
  }

  async function unlocked(req) {
    const value = cookieValue(req.headers.cookie, COOKIE);
    return Boolean(value) && timingSafeEqual(digest(value), digest(await token()));
  }

  // Five wrong PINs from one address lock it out for ten minutes. Twenty
  // within ten minutes from all addresses together lock out every device but
  // the kiosk: guessing from many addresses at once gets no further either.
  function checkPin(address, attempt) {
    const t = now();
    const record = failures.get(address);
    if ((record && record.until > t) || everyone.until > t) {
      throw Object.assign(new Error('Too many attempts, please try again in 10 minutes'), { status: 429 });
    }
    if (typeof attempt === 'string' && timingSafeEqual(digest(attempt.trim()), digest(pinNow()))) {
      failures.delete(address);
      return true;
    }
    // A lockout that has run out starts the count again
    const count = (record && !record.until ? record.count : 0) + 1;
    failures.set(address, { count, until: count >= MAX_FAILURES ? t + LOCKOUT_MS : 0 });
    if (t - everyone.since >= LOCKOUT_MS) Object.assign(everyone, { count: 0, since: t });
    everyone.count += 1;
    if (everyone.count >= MAX_FAILURES_ALL) Object.assign(everyone, { count: 0, since: t, until: t + LOCKOUT_MS });
    return false;
  }

  return {
    get allowedHosts() {
      return hostsNow();
    },
    get pinSet() {
      return Boolean(pinNow());
    },
    isAllowedHost: (header) => isAllowedHost(header, hostsNow()),

    async status(req) {
      const local = isLoopback(req.socket.remoteAddress);
      const free = !pinNow() || local;
      return { local, pinRequired: !free, locked: !free && !(await unlocked(req)) };
    },

    async canChange(req) {
      if (!pinNow() || isLoopback(req.socket.remoteAddress) || (await unlocked(req))) return true;
      const header = req.headers['x-dashboard-pin'];
      return header !== undefined && checkPin(req.socket.remoteAddress, header);
    },

    // → the Set-Cookie value; throws 401 for a wrong PIN, 429 after five
    async unlock(req, attempt) {
      if (!pinNow()) return null;
      if (!checkPin(req.socket.remoteAddress, attempt)) throw Object.assign(new Error('Wrong PIN'), { status: 401 });
      return `${COOKIE}=${await token()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`;
    },
  };
}
