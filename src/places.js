// Custom places API — activity places a user adds from the app's "+ Add place"
// form. Stored in D1 so they sync across every device, unlike custom meals and
// crafts, which stay in the browser's localStorage.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

const PLACE_COLS =
  'id,name,icon,description,cat,subcat,weather,region,distance_miles,price,price_label,tags,created_at';

const PRICE_LABELS = ['Free', '£', '££', '£££'];

// Map a D1 row to the shape the front-end activity list expects (see ACTIVITIES
// in index.html): note `desc` and `dist`, and tags as a real array.
function rowToPlace(r) {
  let tags = [];
  try {
    tags = r.tags ? JSON.parse(r.tags) : [];
  } catch {
    tags = [];
  }
  const price = r.price == null ? 0 : r.price;
  return {
    id: r.id,
    name: r.name,
    icon: r.icon || '📌',
    desc: r.description || '',
    cat: r.cat || 'outdoor',
    subcat: r.subcat || undefined,
    weather: r.weather || 'both',
    region: r.region || 'local',
    dist: r.distance_miles == null ? 10 : r.distance_miles,
    price,
    priceLabel: r.price_label || PRICE_LABELS[price] || 'Free',
    tags: Array.isArray(tags) ? tags : [],
    custom: true,
  };
}

// Router: returns a Response if the request is a places route, else null.
export async function handlePlaces(request, env, ctx, url) {
  const { pathname } = url;

  // List every custom place.
  if (pathname === '/api/places' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT ${PLACE_COLS} FROM places ORDER BY created_at ASC`
    ).all();
    return json(results.map(rowToPlace));
  }

  // Add (or, for migration, upsert by id) a place.
  if (pathname === '/api/places' && request.method === 'POST') {
    let b;
    try {
      b = await request.json();
    } catch {
      return json({ error: 'Send JSON with at least a "name".' }, 400);
    }
    const name = String(b.name || '').trim();
    if (!name) return json({ error: 'name is required' }, 400);

    const id =
      String(b.id || '').trim() ||
      `custom-act-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const price = Number.isFinite(b.price) ? Math.max(0, Math.min(3, b.price)) : 0;
    const dist = Number.isFinite(b.dist) ? b.dist : 10;
    const tags = Array.isArray(b.tags)
      ? b.tags.filter((t) => typeof t === 'string').slice(0, 20)
      : [];
    const now = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO places
         (id,name,icon,description,cat,subcat,weather,region,distance_miles,price,price_label,tags,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, icon=excluded.icon, description=excluded.description,
         cat=excluded.cat, subcat=excluded.subcat, weather=excluded.weather,
         region=excluded.region, distance_miles=excluded.distance_miles,
         price=excluded.price, price_label=excluded.price_label, tags=excluded.tags`
    )
      .bind(
        id,
        name,
        String(b.icon || '📌').slice(0, 8),
        String(b.desc || '').slice(0, 1000),
        String(b.cat || 'outdoor'),
        b.subcat ? String(b.subcat) : null,
        String(b.weather || 'both'),
        String(b.region || 'local'),
        dist,
        price,
        String(b.priceLabel || PRICE_LABELS[price] || 'Free'),
        JSON.stringify(tags),
        now
      )
      .run();

    const { results } = await env.DB.prepare(`SELECT ${PLACE_COLS} FROM places WHERE id=?`)
      .bind(id)
      .all();
    return json(results.length ? rowToPlace(results[0]) : { id });
  }

  // Delete a place.
  const m = pathname.match(/^\/api\/places\/([^/]+)$/);
  if (m && request.method === 'DELETE') {
    const id = decodeURIComponent(m[1]);
    await env.DB.prepare('DELETE FROM places WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  return null;
}
