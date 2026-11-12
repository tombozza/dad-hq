// Events engine — shared shape across Bozza HQ and Dad HQ.
// Pulls upcoming events (festivals, car shows, fairs, celebrations…) via the
// Claude API web-search tool and upserts them into D1. The only thing that
// differs between the two sites is the `persona` passed in from index.js.

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

// Home base + how far each region sits from it. Shared by both sites so
// "local" means the same thing everywhere.
export const LOCATION_CONTEXT = `Home base is Macclesfield, Cheshire, England. Use these approximate driving distances when tagging the "region" and "distance_miles" fields:
- "local": within ~20 miles of Macclesfield (e.g. Knutsford, Wilmslow, Northwich, Altrincham, Stockport)
- "manchester": Greater Manchester, ~20 miles
- "peaks": Peak District & Derbyshire, ~20-30 miles
- "chester": Chester & Cheshire west / Ellesmere Port, ~40 miles
- "liverpool": Liverpool & Merseyside, ~45 miles
- "uk": anywhere else in the UK worth travelling for (set distance_miles to null)`;

const EVENT_COLS =
  'id,title,category,start_date,end_date,region,distance_miles,location,price,url,description,kid_friendly,source,favourite,in_plans,refreshed_at,created_at';

function rowToEvent(r) {
  return {
    id: r.id, title: r.title, category: r.category,
    startDate: r.start_date, endDate: r.end_date,
    region: r.region, distanceMiles: r.distance_miles,
    location: r.location, price: r.price, url: r.url,
    description: r.description, kidFriendly: !!r.kid_friendly,
    source: r.source, favourite: !!r.favourite, inPlans: !!r.in_plans,
    refreshedAt: r.refreshed_at, createdAt: r.created_at,
  };
}

function slug(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function plusMonthsISO(months) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

// Replace "smart"/typographic punctuation with plain ASCII so JSON.parse can
// read it. Pasting out of some chat apps turns " and ' into curly quotes,
// which is the single most common reason an otherwise-valid paste won't parse.
function normalizeQuotes(s) {
  return s
    .replace(/[“”„‟″‶]/g, '"') // curly / double-prime → "
    .replace(/[‘’‚‛′‵]/g, "'") // curly / prime → '
    .replace(/ /g, ' '); // non-breaking space → space
}

// Pull a JSON array out of Claude's reply, tolerating stray prose or fences.
function parseEventsArray(text) {
  if (!text) return [];
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  const slice = t.slice(start, end + 1);
  // Try as-is first, then again with smart quotes normalized to ASCII.
  for (const candidate of [slice, normalizeQuotes(slice)]) {
    try {
      const arr = JSON.parse(candidate);
      if (Array.isArray(arr)) return arr;
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

// The research brief for the manual copy-into-ChatGPT path.
// `opts.age` tunes the audience; `opts.existingEvents` is the list of events
// already in the app, so the AI knows not to hand back duplicates.
function buildResearchPrompt(persona, from, to, opts = {}) {
  const age = Number.isFinite(opts.age) ? opts.age : (persona.defaultAge || 5);
  const count = Number.isFinite(opts.count) ? opts.count : 12;
  const focus = typeof persona.focus === 'function' ? persona.focus(age) : persona.focus;
  const existing = Array.isArray(opts.existingEvents) ? opts.existingEvents : [];
  const existingBlock = existing.length
    ? `\n\nAlready in the app — do NOT return any of these again. Find different, additional events:\n` +
      existing.map((e) => `- ${e.title} (${e.start_date})`).join('\n')
    : '';

  return `You are an events researcher for ${persona.site}. Search the web for real, specific, upcoming events and return them as structured data.

${LOCATION_CONTEXT}

Audience & focus for this site:
${focus}

Rules:
- Only include events whose start date is between ${from} and ${to} (the next ~4 months).
- Prefer specific dated events (a festival on a weekend, a car show on a Sunday) over always-on attractions.
- Search the web as much as you need to confirm real, current dates and venues — do not invent events or guess dates.
- Do NOT return any event already in the app (the list at the end) — only new, additional events. Skip near-duplicates of those too.
- Aim for about ${count} good events across the categories and regions — quality over quantity. Spread them across local, the named regions, and a few UK-wide highlights.
- "category" must be one of: festival, car_show, fair, celebration, market, music, food_drink, sport, comedy, seasonal, family, other.
- Set "kid_friendly" to true only if the event genuinely suits a young child.

When finished, respond with ONLY a JSON array (no prose, no markdown) where each item is:
{"title": str, "category": str, "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "region": str, "distance_miles": int|null, "location": str, "price": str, "url": str, "description": str (1-2 sentences), "kid_friendly": bool}${existingBlock}`;
}

// Upsert parsed events into D1. Returns the number of rows written.
async function upsertEvents(env, raw, source) {
  const now = new Date().toISOString();
  const stmts = [];
  let upserts = 0;
  for (const e of raw) {
    if (!e || !e.title || !e.start_date) continue;
    const id = `${slug(e.title)}__${e.start_date}`;
    stmts.push(
      env.DB.prepare(
        `INSERT INTO events
           (id,title,category,start_date,end_date,region,distance_miles,location,price,url,description,kid_friendly,source,refreshed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
           title=excluded.title, category=excluded.category, start_date=excluded.start_date,
           end_date=excluded.end_date, region=excluded.region, distance_miles=excluded.distance_miles,
           location=excluded.location, price=excluded.price, url=excluded.url,
           description=excluded.description, kid_friendly=excluded.kid_friendly,
           refreshed_at=excluded.refreshed_at`
      ).bind(
        id, e.title, e.category || 'other', e.start_date, e.end_date || e.start_date,
        e.region || 'uk', Number.isFinite(e.distance_miles) ? e.distance_miles : null,
        e.location || '', e.price || '', e.url || '', e.description || '',
        e.kid_friendly ? 1 : 0, source, now
      )
    );
    upserts++;
  }
  if (stmts.length) await env.DB.batch(stmts);
  return upserts;
}

// Router: returns a Response if the request is an events route, else null.
export async function handleEvents(request, env, ctx, url, persona) {
  const { pathname } = url;

  // List events (optionally only kid-friendly, for Dad HQ scope sharing).
  if (pathname === '/api/events' && request.method === 'GET') {
    const kidsOnly = url.searchParams.get('kids') === '1';
    const where = kidsOnly ? 'WHERE kid_friendly=1' : '';
    const { results } = await env.DB.prepare(
      `SELECT ${EVENT_COLS} FROM events ${where} ORDER BY start_date ASC`
    ).all();
    return json(results.map(rowToEvent));
  }

  // Toggle favourite / in_plans (and allow note-free field edits).
  const m = pathname.match(/^\/api\/events\/([^/]+)$/);
  if (m && request.method === 'PATCH') {
    const id = decodeURIComponent(m[1]);
    const b = await request.json();
    const map = { favourite: 'favourite', inPlans: 'in_plans' };
    const sets = [], vals = [];
    for (const [k, col] of Object.entries(map)) {
      if (k in b) {
        sets.push(`${col}=?`);
        vals.push(b[k] ? 1 : 0);
      }
    }
    if (!sets.length) return json({ error: 'nothing to update' }, 400);
    vals.push(id);
    await env.DB.prepare(`UPDATE events SET ${sets.join(',')} WHERE id=?`).bind(...vals).run();
    const { results } = await env.DB.prepare(`SELECT ${EVENT_COLS} FROM events WHERE id=?`)
      .bind(id)
      .all();
    return results.length ? json(rowToEvent(results[0])) : json({ error: 'not found' }, 404);
  }

  // Delete an event.
  if (m && request.method === 'DELETE') {
    const id = decodeURIComponent(m[1]);
    await env.DB.prepare('DELETE FROM events WHERE id=?').bind(id).run();
    return json({ ok: true });
  }

  // Manual mode, step 1: hand out the research prompt so it can be pasted
  // into any free chat AI (ChatGPT, claude.ai…). No API key needed.
  if (pathname === '/api/events/prompt' && request.method === 'GET') {
    const from = todayISO();
    const to = plusMonthsISO(4);
    const ageParam = parseInt(url.searchParams.get('age'), 10);
    const age = Number.isFinite(ageParam) ? Math.max(0, Math.min(17, ageParam)) : undefined;
    const countParam = parseInt(url.searchParams.get('count'), 10);
    const count = Number.isFinite(countParam) ? Math.max(1, Math.min(50, countParam)) : undefined;
    // Everything still upcoming OR currently running — so the AI doesn't hand
    // back what we already have (including events that started before today
    // but haven't finished yet).
    const { results: existingEvents } = await env.DB.prepare(
      `SELECT title, start_date FROM events
        WHERE COALESCE(end_date, start_date) >= ?
        ORDER BY start_date ASC`
    )
      .bind(from)
      .all();
    const prompt =
      buildResearchPrompt(persona, from, to, { age, count, existingEvents }) +
      `\n\nFind upcoming events between ${from} and ${to}, then reply with ONLY the JSON array.`;
    return json({ prompt, from, to });
  }

  // Manual mode, step 2: accept the AI's pasted reply and upsert it.
  if (pathname === '/api/events/manual' && request.method === 'POST') {
    let text = '';
    try {
      const b = await request.json();
      text = String(b.text || '');
    } catch {
      return json({ error: 'Send JSON like {"text": "...pasted reply..."}' }, 400);
    }
    const raw = parseEventsArray(text);
    if (!raw.length) {
      return json({ error: 'Could not find a JSON array of events in that paste — copy the whole reply and try again.' }, 400);
    }
    const upserts = await upsertEvents(env, raw, 'manual');
    return json({ ok: true, count: upserts });
  }

  return null;
}
