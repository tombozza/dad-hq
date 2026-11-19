// Home town and child, synced (Round 4, 19 Nov 2026). The shape and the rules are in
// public/lib/profile.js (shared with the page); this is the storage and the route.
//
//   GET /api/profile  → { profile, saved }   (open, like every read; saved: false = still the defaults)
//   PUT /api/profile  { home, children }     (a write, so the password gate covers it when the lock is on)
//
// One row in D1 table dh_profile, created on first use (and in schema.sql). Nothing is stored until Tom
// saves Settings, so a fresh database reads as today's values (Macclesfield, Harry, age 5).

import { normaliseProfile, cleanProfile } from '../public/lib/profile.js';

const ensure = db => db.prepare(`CREATE TABLE IF NOT EXISTS dh_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT, updated_at TEXT)`).run();

async function readRow(env) {
  await ensure(env.DB);
  return env.DB.prepare('SELECT data, updated_at FROM dh_profile WHERE id = 1').first();
}

/** The profile, always whole: the defaults when nothing is saved or the row can't be read. */
export async function loadProfile(env) {
  try {
    const row = await readRow(env);
    return normaliseProfile(row && row.data ? JSON.parse(row.data) : null);
  } catch {
    return normaliseProfile(null);
  }
}

export async function handleProfile(request, env, url, json) {
  if (url.pathname !== '/api/profile') return null;
  if (request.method === 'GET') {
    const row = await readRow(env);
    let stored = null; try { stored = row && row.data ? JSON.parse(row.data) : null; } catch { /* defaults */ }
    return json({ profile: normaliseProfile(stored), saved: !!stored, updatedAt: (row && row.updated_at) || null });
  }
  if (request.method === 'PUT') {
    let b; try { b = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
    const { profile, error } = cleanProfile(b);
    if (error) return json({ error }, 400);
    await ensure(env.DB);
    await env.DB.prepare(`INSERT INTO dh_profile (id, data, updated_at) VALUES (1, ?1, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET data = ?1, updated_at = datetime('now')`).bind(JSON.stringify(profile)).run();
    return json({ ok: true, profile, saved: true });
  }
  return json({ error: 'Use GET or PUT.' }, 405);
}
