// Cross-device sync for the rest of the user's data:
//   - custom meals   → /api/meals   (JSON-blob rows)
//   - custom crafts  → /api/crafts  (JSON-blob rows)
//   - "add new" drafts → /api/drafts (JSON-blob rows)
//   - card edits      → /api/edits   (JSON-blob rows, keyed by the item's id)
//   - favourites & hidden built-ins → /api/flags
// Custom places live in places.js; events carry their own columns. Everything
// here follows the same no-auth, single-household model as the rest of the app.

import { keepDeleted } from './safety.js';
import { binAdd } from '../public/vendor/safety/bin-d1.js';

// What a deleted row is called in Recently deleted. ?bin=0 on a DELETE skips the bin: the app's own
// tidy-ups (the jotted list cleared after Fill in the details, an edit folded into an event).
const BIN_KIND = { meals: 'meal', crafts: 'craft', drafts: 'jotted item', edits: 'card changes' };
const labelOf = (r) => { try { return JSON.parse(r.data).name || r.id; } catch { return r.id; } };

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

// A JSON-blob collection (meals, crafts): store the client object verbatim,
// keyed by its id, and hand it straight back.
function collectionRoutes(name, table) {
  return async function (request, env, url, bin) {
    const { pathname } = url;

    if (pathname === `/api/${name}` && request.method === 'GET') {
      const { results } = await env.DB.prepare(
        `SELECT data FROM ${table} ORDER BY created_at ASC`
      ).all();
      const items = [];
      for (const r of results) {
        try { items.push(JSON.parse(r.data)); } catch { /* skip a corrupt row */ }
      }
      return json(items);
    }

    if (pathname === `/api/${name}` && request.method === 'POST') {
      let item;
      try { item = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
      if (!item || !item.id || !item.name) return json({ error: 'id and name are required' }, 400);
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO ${table} (id, data, created_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data`
      ).bind(String(item.id), JSON.stringify(item), now).run();
      return json({ ok: true, id: item.id });
    }

    const m = pathname.match(new RegExp(`^/api/${name}/([^/]+)$`));
    if (m && request.method === 'DELETE') {
      const id = decodeURIComponent(m[1]);
      if (bin && url.searchParams.get('bin') !== '0') {
        await keepDeleted(env.DB, bin, { kind: BIN_KIND[name] || name, label: labelOf, table, where: 'id = ?', binds: [id] });
      } else {
        await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(id).run();
      }
      return json({ ok: true });
    }

    return null;
  };
}

const handleMeals = collectionRoutes('meals', 'meals');
const handleCrafts = collectionRoutes('crafts', 'crafts');
// "Add new" drafts: things the user has jotted down but not researched yet.
const handleDrafts = collectionRoutes('drafts', 'drafts');
// Card edits: per-item overrides of icon/name/description, keyed by item id.
const handleEdits = collectionRoutes('edits', 'edits');

const FLAG_SCOPES = ['fav', 'wish', 'hidden'];
const FLAG_KINDS = ['act', 'meal', 'craft'];

async function handleFlags(request, env, url, bin) {
  const { pathname } = url;
  if (pathname !== '/api/flags') return null;

  // Return { fav: {act:[], meal:[], craft:[]}, hidden: {...} }.
  if (request.method === 'GET') {
    const out = {};
    for (const s of FLAG_SCOPES) { out[s] = {}; for (const k of FLAG_KINDS) out[s][k] = []; }
    const { results } = await env.DB.prepare('SELECT scope, kind, item_id FROM flags').all();
    for (const r of results) {
      if (out[r.scope] && out[r.scope][r.kind]) out[r.scope][r.kind].push(r.item_id);
    }
    return json(out);
  }

  // Set or clear one flag: { scope, kind, item_id, on }.
  if (request.method === 'POST') {
    let b;
    try { b = await request.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
    const scope = String(b.scope || ''), kind = String(b.kind || ''), id = String(b.item_id || '');
    if (!FLAG_SCOPES.includes(scope) || !FLAG_KINDS.includes(kind) || !id) {
      return json({ error: 'bad scope/kind/item_id' }, 400);
    }
    if (b.on) {
      const res = await env.DB.prepare(
        'INSERT OR IGNORE INTO flags (scope, kind, item_id) VALUES (?, ?, ?)'
      ).bind(scope, kind, id).run();
      // Hiding a built-in is its Remove, so it shows in Recently deleted; Restore there un-hides it
      // (index.js's special restore deletes the flag). Only when it wasn't hidden already.
      if (bin && scope === 'hidden' && res.meta && res.meta.changes) {
        await binAdd(env.DB, bin, { kind: 'hidden', label: String(b.label || id).slice(0, 200), rows: { flags: [{ scope, kind, item_id: id }] } });
      }
    } else {
      await env.DB.prepare(
        'DELETE FROM flags WHERE scope=? AND kind=? AND item_id=?'
      ).bind(scope, kind, id).run();
    }
    return json({ ok: true });
  }

  return null;
}

// Router: returns a Response if the request is a sync route, else null.
export async function handleSync(request, env, ctx, url, bin) {
  return (
    (await handleMeals(request, env, url, bin)) ||
    (await handleCrafts(request, env, url, bin)) ||
    (await handleDrafts(request, env, url, bin)) ||
    (await handleEdits(request, env, url, bin)) ||
    (await handleFlags(request, env, url, bin))
  );
}
