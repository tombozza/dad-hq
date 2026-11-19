// The safety net, server side (Round 2, 19 Nov 2026): Recently deleted and Restore from a backup.
// Shared byte for byte by Dad HQ and Bozza HQ (src/safety.js in each); only the options differ, and
// they live in each app's src/index.js. Runs after the password gate, so every write here is gated
// exactly like the app's other writes, and GET /api/bin is open like its other reads.
//
//   GET    /api/bin              what was deleted in the last 30 days (no data, just labels)
//   POST   /api/bin/:id/restore  put it back (INSERT OR IGNORE with its own ids: never overwrites)
//   DELETE /api/bin/:id          delete it for good (a separate, confirmed tap in the sheet)
//   POST   /api/restore          { tables: { places: [row…], … } } from a backup file: adds only the
//                                rows whose id isn't there now, never changes or deletes anything
//
// The deletes themselves call keepDeleted() (below) in the same request: read the rows, delete, keep.

import { binAdd, binList, binRestore, binForget, rowsOf } from '../public/vendor/safety/bin-d1.js';

/** Read rows, delete them, then keep them in the bin. Returns how many rows were deleted. */
export async function keepDeleted(db, bin, { kind, label, table, where, binds, children = [] }) {
  const rows = await rowsOf(db, table, where, binds);
  if (!rows.length) return 0;
  const kept = { [table]: rows };
  for (const c of children) kept[c.table] = await rowsOf(db, c.table, c.where, c.binds);
  for (const c of children) await db.prepare(`DELETE FROM ${c.table} WHERE ${c.where}`).bind(...c.binds).run();
  await db.prepare(`DELETE FROM ${table} WHERE ${where}`).bind(...binds).run();
  await binAdd(db, bin, { kind, label: typeof label === 'function' ? label(rows[0]) : label, rows: kept });
  return rows.length;
}

/**
 * opts: { bin: 'dh_bin', restorable: ['places', …], json, special?(db, entry) }
 * special lets an app restore an entry its own way (Dad HQ's hidden built-ins: restoring one deletes
 * the hide flag). It gets { id, kind, data } and returns a result, or null to restore as usual.
 */
export async function handleSafety(request, env, url, opts) {
  const { pathname } = url;
  const method = request.method;
  const { bin, restorable, json } = opts;

  if (pathname === '/api/bin' && method === 'GET') return json(await binList(env.DB, bin));

  const m = pathname.match(/^\/api\/bin\/([^/]+)(\/restore)?$/);
  if (m && m[2] && method === 'POST') {
    const id = decodeURIComponent(m[1]);
    if (opts.special) {
      const entry = await env.DB.prepare(`SELECT id, kind, data FROM ${bin} WHERE id = ?`).bind(id).first().catch(() => null);
      const r = entry ? await opts.special(env.DB, entry) : null;
      if (r) return json(r);
    }
    const r = await binRestore(env.DB, bin, id);
    return json(r, r.error ? 404 : 200);
  }
  if (m && !m[2] && method === 'DELETE') return json(await binForget(env.DB, bin, decodeURIComponent(m[1])));

  if (pathname === '/api/restore' && method === 'POST') {
    const body = await request.json().catch(() => null);
    const tables = body && body.tables;
    if (!tables || typeof tables !== 'object') return json({ error: 'Send { tables: { name: [rows] } } from a backup file.' }, 400);
    const added = {};
    for (const t of restorable) {
      const list = Array.isArray(tables[t]) ? tables[t] : [];
      added[t] = 0;
      if (!list.length) continue;
      // Only the table's real columns, so a backup can't name anything else.
      const info = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
      const cols = new Set((info.results || []).map((c) => c.name));
      const stmts = [];
      for (const row of list) {
        if (!row || typeof row !== 'object' || row.id == null) continue;
        const keys = Object.keys(row).filter((k) => cols.has(k));
        stmts.push(env.DB.prepare(`INSERT OR IGNORE INTO ${t} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`)
          .bind(...keys.map((k) => (row[k] !== null && typeof row[k] === 'object' ? JSON.stringify(row[k]) : row[k]))));
      }
      for (let i = 0; i < stmts.length; i += 80) {
        const res = await env.DB.batch(stmts.slice(i, i + 80));
        for (const r of res) added[t] += (r.meta && r.meta.changes) || 0;
      }
    }
    return json({ ok: true, added });
  }

  return null;
}
