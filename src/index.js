// Dad HQ — Cloudflare Worker. Serves the existing single-file PWA as a static
// asset and adds the events API (kid & family-friendly events near home).

import { handleEvents } from './events.js';
import { handlePlaces } from './places.js';
import { handleSync } from './sync.js';
import { handleAI } from './ai.js';
import { handleAuth } from './auth.js';
import { handleUsage } from './ai-usage.js';
import { handleSafety } from './safety.js';

// Recently deleted lives in this D1 table (created on first use). See src/safety.js.
const BIN = 'dh_bin';

// What kind of events Dad HQ pulls in — days out with a young child.
// `focus` is a function of the child's age so the prompt can be tuned from the
// app (the age comes in on the /api/events/prompt query string).
const EVENTS_PERSONA = {
  site: 'Dad HQ',
  bin: BIN, // the events engine keeps a deleted event here
  childName: 'Harry',
  defaultAge: 5,
  focus(age) {
    return `Days out and events suitable for a dad with a ${age}-year-old son (Harry). Family-friendly festivals and fairs, character meet-and-greets, kids' theatre and storytelling, farm and animal events, soft-play and outdoor play events, school-holiday activities, Santa's grottos and seasonal family days, fun runs and family sports days, and family-friendly food/market events. Crossover events the dad would enjoy too — car shows, transport rallies, air shows, steam-railway days — are welcome (mark kid_friendly true). Mark kid_friendly true for anything genuinely suited to a young child; bias the whole list toward things a ${age}-year-old would love.`;
  },
};

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
        const tables = ['events', 'places', 'meals', 'crafts', 'drafts', 'edits', 'flags'];
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

      // ---- Events (kid/family-friendly) ----
      const ev = await handleEvents(request, env, ctx, url, EVENTS_PERSONA);
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
