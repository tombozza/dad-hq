// What each Claude call cost, worked out from the token counts Anthropic sends back.
//
// A copy of food-planner/functions/api/_ai-usage.js, plus web search (Dad HQ's places, events and
// Fill in the details look things up: each search is charged, and the pages it reads come back as
// input tokens, which is where most of a search run's cost is). The proxy (ai.js) records every
// paid call here; the AI actions page reads it. Stored in D1 table `ai_usage` (one row). Two
// calls landing at the same moment can lose one record: fine for a running estimate.

// US dollars per million tokens (Anthropic's price list, Nov 2026). A model not listed is priced
// as the dearest one here, so an unknown model never looks cheap.
export const PRICES = {
  'claude-haiku-4-5': { in: 1, out: 5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
};
const DEAREST = { in: 2, out: 10 };
export const PER_SEARCH = 0.01;   // web search: $10 per 1,000 searches, on top of the tokens

const RECENT = 10;          // runs kept per job for the average

// "claude-haiku-4-5-20251001" → the price-list name
const priceOf = model => PRICES[String(model ?? '').replace(/-\d{8}$/, '')] ?? DEAREST;

/** Dollars for one reply's `usage` block. Cache writes cost 1.25×, cache reads 0.1× of input; each web search 1¢. */
export function costOf(model, usage = {}) {
  const p = priceOf(model);
  const n = k => Number(usage?.[k]) || 0;
  const input = n('input_tokens') + 1.25 * n('cache_creation_input_tokens') + 0.1 * n('cache_read_input_tokens');
  const searches = Number(usage?.server_tool_use?.web_search_requests) || 0;
  return (input * p.in + n('output_tokens') * p.out) / 1e6 + searches * PER_SEARCH;
}

/** A job name the page sent, or 'other'. */
export const jobName = j => (/^[a-z0-9-]{1,40}$/.test(String(j ?? '')) ? j : 'other');

export const emptyLedger = () => ({ total: 0, runs: 0, months: {}, jobs: {} });

/** The ledger with one call added (a new object; the old one is left alone). */
export function record(ledger, { job, model, usage, at = new Date().toISOString() }) {
  const l = structuredClone(ledger ?? emptyLedger());
  const cost = costOf(model, usage);
  const month = at.slice(0, 7);
  const j = l.jobs[job] ?? { runs: 0, cost: 0, recent: [] };
  j.runs += 1;
  j.cost += cost;
  j.recent = [...j.recent, { cost, in: Number(usage?.input_tokens) || 0, out: Number(usage?.output_tokens) || 0, searches: Number(usage?.server_tool_use?.web_search_requests) || 0, model, at }].slice(-RECENT);
  j.lastAt = at;
  l.jobs[job] = j;
  l.months[month] = (l.months[month] ?? 0) + cost;
  l.total += cost;
  l.runs += 1;
  return l;
}

/** Credit left: the balance Tom typed in, less what's been spent here since he typed it. */
export function remaining(ledger, balance) {
  if (!balance || !Number.isFinite(balance.amount)) return null;
  return balance.amount - ((ledger?.total ?? 0) - (balance.spentAtSet ?? 0));
}

// ---- Storage: one row in D1 (created on first use, like app_settings) ----
const ensure = env => env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1), ledger TEXT, balance TEXT, updated_at TEXT)`).run();

export async function load(env) {
  await ensure(env);
  const row = await env.DB.prepare('SELECT ledger, balance FROM ai_usage WHERE id = 1').first();
  const parse = t => { try { return t ? JSON.parse(t) : null; } catch { return null; } };
  return { ledger: parse(row?.ledger) ?? emptyLedger(), balance: parse(row?.balance) };
}

export async function save(env, { ledger, balance }) {
  await ensure(env);
  await env.DB.prepare(`INSERT INTO ai_usage (id, ledger, balance, updated_at) VALUES (1, ?1, ?2, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET ledger = ?1, balance = ?2, updated_at = datetime('now')`)
    .bind(JSON.stringify(ledger), balance ? JSON.stringify(balance) : null).run();
}

/** Log one call's cost. */
export async function logCall(env, { job, model, usage }) {
  const s = await load(env);
  await save(env, { ...s, ledger: record(s.ledger, { job, model, usage }) });
}

/** GET /api/ai-usage → { ledger, balance, remaining }; POST { balance: 12.5 | null }. */
export async function handleUsage(request, env) {
  const out = s => Response.json({ ...s, remaining: remaining(s.ledger, s.balance) }, { headers: { 'cache-control': 'no-store' } });
  if (request.method === 'GET') return out(await load(env));
  if (request.method !== 'POST') return Response.json({ error: { message: 'Use GET or POST.' } }, { status: 405 });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: { message: 'Only Dad HQ’s own pages can change this.' } }, { status: 403 });
  let body; try { body = await request.json(); } catch { return Response.json({ error: { message: 'bad json' } }, { status: 400 }); }
  const s = await load(env);
  if (body?.balance === null) { s.balance = null; await save(env, s); return out(s); }
  const amount = Number(body?.balance);
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return Response.json({ error: { message: 'That isn’t an amount.' } }, { status: 400 });
  s.balance = { amount, asOf: new Date().toISOString(), spentAtSet: s.ledger.total };
  await save(env, s);
  return out(s);
}
