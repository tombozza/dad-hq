// Cross-device sync for the rest of the user's data:
//   - custom meals   → /api/meals   (JSON-blob rows)
//   - custom crafts  → /api/crafts  (JSON-blob rows)
//   - "add new" drafts → /api/drafts (JSON-blob rows)
//   - card edits      → /api/edits   (JSON-blob rows, keyed by the item's id)
//   - favourites & hidden built-ins → /api/flags
// Custom places live in places.js; events carry their own columns. Everything
// here follows the same no-auth, single-household model as the rest of the app.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

// A JSON-blob collection (meals, crafts): store the client object verbatim,
// keyed by its id, and hand it straight back.
function collectionRoutes(name, table) {
  return async function (request, env, url) {
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
      await env.DB.prepare(`DELETE FROM ${table} WHERE id=?`).bind(decodeURIComponent(m[1])).run();
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

async function handleFlags(request, env, url) {
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
      await env.DB.prepare(
        'INSERT OR IGNORE INTO flags (scope, kind, item_id) VALUES (?, ?, ?)'
      ).bind(scope, kind, id).run();
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
export async function handleSync(request, env, ctx, url) {
  return (
    (await handleMeals(request, env, url)) ||
    (await handleCrafts(request, env, url)) ||
    (await handleDrafts(request, env, url)) ||
    (await handleEdits(request, env, url)) ||
    (await handleFlags(request, env, url))
  );
}
