// The paid route for the magic sheet (public/vendor/magic), on the site's own key
// (npx wrangler secret put ANTHROPIC_API_KEY — a Worker sees a new secret straight away).
//
// Adapted from sites/_shared/starter/functions/api/{anthropic,status}.js for a Worker:
//   GET  /api/status     → { ai: true|false } — is the paid route available?
//   POST /api/anthropic  → one Claude call, Anthropic's response shape passed straight back
//
// Locked down so it can't be used as a general LLM proxy on the account key: the model is
// checked against an allowlist, max_tokens is capped, no client-supplied tools or system
// prompt, and calls from other sites are refused. The one extra over the starter is
// `search: true`, which turns on Anthropic's web search tool with a hard cap on searches —
// Dad HQ's jobs are about real places and dated events, and Haiku would guess dates without it.
// Without a key it says so plainly — the Free route in the sheet still works.

const MODELS = new Set(['claude-haiku-4-5-20251001', 'claude-haiku-4-5']);
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS_CAP = 8192; // 30 events as JSON is ~6k tokens
const MAX_SEARCHES = 5;

const err = (message, status) =>
  Response.json({ type: 'error', error: { message } }, { status });

export async function handleAI(request, env, url) {
  const { pathname } = url;

  if (pathname === '/api/status' && request.method === 'GET') {
    return Response.json({ ai: !!env.ANTHROPIC_API_KEY }, { headers: { 'cache-control': 'no-store' } });
  }

  if (pathname !== '/api/anthropic') return null;
  // No CORS for this one: only Dad HQ's own pages may spend its key.
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return err('Use POST.', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return err('Not allowed from another site.', 403);
  if (!env.ANTHROPIC_API_KEY) return err('One-tap isn’t set up on this site — use the Free route.', 503);

  let body;
  try { body = await request.json(); } catch { return err('Invalid request body.', 400); }
  if (!Array.isArray(body.messages)) return err('No messages provided.', 400);
  const model = MODELS.has(body.model) ? body.model : DEFAULT_MODEL;
  const max_tokens = Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS_CAP);
  const payload = { model, max_tokens, messages: body.messages };
  if (body.search === true) {
    payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES, user_location: { type: 'approximate', country: 'GB', city: 'Macclesfield' } }];
  }

  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return err('Couldn’t reach Anthropic: ' + (e.message || e), 502);
  }
  return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } });
}
