// Optional password lock — OFF by default. Same idea as golf-tracker / life-kanban's
// shared password gate, adapted for a Worker router. The client half is public/lock.js.
// (Storage Log, Swipefy and Bozza HQ carry copies of this file; only the storage adapter at
// the bottom and the cookie name differ.)
//
//   GET  /api/settings              -> { password_enabled, unlocked, has_recovery_code }  (always open)
//   PUT  /api/settings              { password_enabled, password? }    (gated when on)
//                                   -> { password_enabled, recovery_code? } (a new password makes a new code)
//   PUT  /api/settings              { new_recovery_code: true } -> { recovery_code }  (lock must be on)
//   POST /api/auth                  { password }  -> session cookie     (always open)
//                                   the recovery code works in place of the password: { ok, recovered: true }
//   POST /api/auth                  { action: 'logout' } -> clears it
//
// When the lock is on, every non-GET request under /api/ needs the session cookie,
// which is HMAC(AUTH_SECRET, "authenticated") — stateless, compare don't decode.
// Reads stay open (apart from the full backup). Passwords are stored as salted
// PBKDF2-SHA256 hashes, never in plain text.
//
// Recovery code (Round 3, "Never locked out", 19 Nov 2026): whenever a password is set the server makes a
// recovery code, keeps only its hash (recovery_hash) and sends the code back once for the screen to show.
// Turning the lock off clears it. The shared code is vendor/safety/recovery.js (source: _shared/safety/).

import { makeRecoveryCode, hashRecoveryCode, checkRecoveryCode } from '../public/vendor/safety/recovery.js';

const COOKIE = 'dh_session';

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));

const ITER = 100000; // the Workers runtime caps PBKDF2 at 100k iterations

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${hex(salt)}$${await pbkdf2(password, salt, ITER)}`;
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function checkPassword(password, stored) {
  const [kind, iter, salt, hash] = String(stored || '').split('$');
  if (kind !== 'pbkdf2' || !hash) return false;
  return same(await pbkdf2(password, unhex(salt), Number(iter)), hash);
}

async function sessionToken(env) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode('authenticated')));
}

function getCookie(request, name) {
  const m = (request.headers.get('Cookie') || '').match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

async function hasSession(request, env) {
  if (!env.AUTH_SECRET) return false;
  const token = getCookie(request, COOKIE);
  return !!token && same(token, await sessionToken(env));
}

const setCookie = (value, maxAge) =>
  `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// Returns a Response for /api/settings and /api/auth, or a 401 when the lock is on and
// this is a write without a session; null means "carry on to the normal routes".
export async function handleAuth(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  if (!pathname.startsWith('/api/')) return null;

  if (pathname === '/api/auth' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    if (body.action === 'logout') return json({ ok: true }, 200, { 'Set-Cookie': setCookie('', 0) });
    const s = await loadSettings(env);
    if (!s.password_enabled) return json({ ok: true });
    if (!env.AUTH_SECRET) return json({ error: 'The password lock is not set up on this site (AUTH_SECRET missing).' }, 503);
    let recovered = false;
    if (!body.password || !(await checkPassword(String(body.password), s.password_hash))) {
      recovered = await checkRecoveryCode(body.password, s.recovery_hash);
      if (!recovered) return json({ error: 'Incorrect password.' }, 401);
    }
    return json({ ok: true, recovered }, 200, { 'Set-Cookie': setCookie(await sessionToken(env), 31536000) });
  }

  if (pathname === '/api/settings' && method === 'GET') {
    const s = await loadSettings(env);
    return json({
      password_enabled: s.password_enabled,
      unlocked: !s.password_enabled || (await hasSession(request, env)),
      has_recovery_code: s.password_enabled && !!s.recovery_hash,
    });
  }

  // Everything below needs the session when the lock is on: all writes (settings included)
  // and the full backup download.
  const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  if (!isWrite && pathname !== '/api/backup') return null;
  const s = await loadSettings(env);
  if (s.password_enabled && !(await hasSession(request, env))) {
    return json({ error: 'Locked — enter the password to make changes.', code: 'locked' }, 401);
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    if (body.new_recovery_code) {
      // A fresh code for a lock that's on; the old one stops working.
      if (!s.password_enabled) return json({ error: 'Turn the password on first.' }, 400);
      const code = makeRecoveryCode();
      await saveSettings(env, { ...s, recovery_hash: await hashRecoveryCode(code) });
      return json({ password_enabled: true, recovery_code: code });
    }
    if (!body.password_enabled) {
      await saveSettings(env, { password_enabled: false, password_hash: null, recovery_hash: null });
      return json({ password_enabled: false });
    }
    if (!env.AUTH_SECRET) return json({ error: 'The password lock is not set up on this site (AUTH_SECRET missing).' }, 503);
    const password = body.password ? String(body.password) : '';
    if (!password && !s.password_hash) return json({ error: 'Choose a password of at least 4 characters.' }, 400);
    if (password && password.length < 4) return json({ error: 'Choose a password of at least 4 characters.' }, 400);
    // A new password makes a new recovery code; a blank box keeps both.
    const code = password ? makeRecoveryCode() : null;
    await saveSettings(env, {
      password_enabled: true,
      password_hash: password ? await hashPassword(password) : s.password_hash,
      recovery_hash: code ? await hashRecoveryCode(code) : s.recovery_hash,
    });
    // The device that switched it on stays unlocked. The code is shown once and never again.
    return json({ password_enabled: true, ...(code ? { recovery_code: code } : {}) }, 200,
      { 'Set-Cookie': setCookie(await sessionToken(env), 31536000) });
  }

  return null;
}

// ---- Storage: one row in app_settings, in this app's own D1 database. ----
// recovery_hash is added to an older table on first save (SELECT * reads it as missing until then).
async function loadSettings(env) {
  try {
    const row = await env.DB.prepare('SELECT * FROM app_settings WHERE id = 1').first();
    return {
      password_enabled: !!(row && row.password_enabled),
      password_hash: (row && row.password_hash) || null,
      recovery_hash: (row && row.recovery_hash) || null,
    };
  } catch (e) {
    if (String(e && e.message).includes('no such table')) return { password_enabled: false, password_hash: null, recovery_hash: null };
    throw e;
  }
}

// Sets every column, so always pass all three (recovery_hash included).
async function saveSettings(env, s) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1), password_enabled INTEGER DEFAULT 0,
      password_hash TEXT, recovery_hash TEXT, updated_at TEXT DEFAULT (datetime('now')))`).run();
  try { await env.DB.prepare('ALTER TABLE app_settings ADD COLUMN recovery_hash TEXT').run(); } catch { /* already there */ }
  await env.DB.prepare(`INSERT INTO app_settings (id, password_enabled, password_hash, recovery_hash, updated_at)
      VALUES (1, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET password_enabled = excluded.password_enabled,
        password_hash = excluded.password_hash, recovery_hash = excluded.recovery_hash,
        updated_at = excluded.updated_at`)
    .bind(s.password_enabled ? 1 : 0, s.password_hash || null, s.recovery_hash || null).run();
}
