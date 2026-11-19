// Dad HQ — Cloudflare Worker. Serves the existing single-file PWA as a static
// asset and adds the events API (kid & family-friendly events near home).

import { handleEvents } from './events.js';
import { handlePlaces } from './places.js';
import { handleSync } from './sync.js';
import { handleAI } from './ai.js';
import { handleAuth } from './auth.js';
import { handleUsage } from './ai-usage.js';
import { handleSafety } from './safety.js';
import { handleProfile, loadProfile } from './profile.js';
import { firstChild, ageOn, eventsFocus, locationContext, DEFAULT_AGE } from '../public/lib/profile.js';

// Recently deleted lives in this D1 table (created on first use). See src/safety.js.
const BIN = 'dh_bin';

// What kind of events Dad HQ pulls in — days out with a young child.
// `focus` is a function of the child's age so the prompt can be tuned from the
// app (the age comes in on the /api/events/prompt query string). The child's name and the
// home town come from Settings (D1 dh_profile, src/profile.js; Round 4, 19 Nov 2026), so this is
// built per request for the prompt route; the default profile gives today's words exactly.
function eventsPersona(profile) {
  const kid = firstChild(profile);
  return {
    site: 'Dad HQ',
    bin: BIN, // the events engine keeps a deleted event here
    childName: kid.name,
    defaultAge: ageOn(kid.birthDate) ?? DEFAULT_AGE,
    // null keeps the engine's own home block (Macclesfield); a moved home brings its own.
    locationContext: locationContext(profile),
    focus: age => eventsFocus(kid, age),
  };
}
const EVENTS_PERSONA = eventsPersona(null);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ---- The magic sheet's paid route (Claude, locked proxy) + /api/status ----
    // Before the open CORS preflight below: the proxy must not be callable from other sites.
    try {
      const ai = await handleAI(request, env, url, ctx);
      if (ai) return ai;
    } catch (err) {
      return json({ type: 'error', error: { message: String((err && err.message) || err) } }, 500);
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    try {
      // ---- Optional password lock (off by default) — see src/auth.js ----
      const gated = await handleAuth(request, env, url);
      if (gated) return gated;

      // ---- What Claude has cost here (AI actions page). After the gate: reading is open, setting the balance is a write ----
      if (url.pathname === '/api/ai-usage') return await handleUsage(request, env);

      // ---- Backup: every table, as one JSON download (Add new → Download a backup) ----
      if (url.pathname === '/api/backup' && request.method === 'GET') {
        await loadProfile(env); // makes sure dh_profile exists, so the SELECT below can't fail
        const tables = ['events', 'places', 'meals', 'crafts', 'drafts', 'edits', 'flags', 'dh_profile'];
        const rows = await Promise.all(tables.map((t) => env.DB.prepare(`SELECT * FROM ${t}`).all().then((r) => r.results)));
        const data = Object.fromEntries(tables.map((t, i) => [t, rows[i]]));
        const day = new Date().toISOString().slice(0, 10);
        return new Response(JSON.stringify({
          app: 'dad-hq', version: 1, exported_at: new Date().toISOString(),
          counts: Object.fromEntries(tables.map((t, i) => [t, rows[i].length])), ...data,
        }), { headers: {
          'content-type': 'application/json', 'cache-control': 'no-store',
          'content-disposition': `attachment; filename="dad-hq-backup-${day}.json"`,
        } });
      }

      // ---- Recently deleted, and Restore from a backup (adds only) ----
      const sf = await handleSafety(request, env, url, {
        bin: BIN, json, restorable: ['places', 'events', 'meals', 'crafts'],
        // A hidden built-in comes back by deleting its hide flag (the built-in itself was never deleted).
        special: async (db, entry) => {
          if (entry.kind !== 'hidden') return null;
          let flags = [];
          try { flags = JSON.parse(entry.data).rows.flags || []; } catch { /* unreadable: nothing to un-hide */ }
          for (const f of flags) {
            await db.prepare('DELETE FROM flags WHERE scope=? AND kind=? AND item_id=?').bind(f.scope, f.kind, f.item_id).run();
          }
          await db.prepare(`DELETE FROM ${BIN} WHERE id = ?`).bind(entry.id).run();
          return { ok: true, restored: flags.length };
        },
      });
      if (sf) return sf;

      // ---- Home town and child (Settings) ----
      const pr = await handleProfile(request, env, url, json);
      if (pr) return pr;

      // ---- Events (kid/family-friendly). Only the prompt needs the saved profile. ----
      const persona = url.pathname === '/api/events/prompt' ? eventsPersona(await loadProfile(env)) : EVENTS_PERSONA;
      const ev = await handleEvents(request, env, ctx, url, persona);
      if (ev) return ev;

      // ---- Custom places (user-added, cross-device) ----
      const pl = await handlePlaces(request, env, ctx, url, BIN);
      if (pl) return pl;

      // ---- Meals, crafts, favourites & hidden flags (cross-device) ----
      const sy = await handleSync(request, env, ctx, url, BIN);
      if (sy) return sy;

      // ---- Static assets (the PWA) ----
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
