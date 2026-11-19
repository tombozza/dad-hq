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
// The key is the site's secret if it has one; otherwise the person's own key, which the
// page keeps on their device and sends in `x-user-key` (the sheet asks for it on first use).
// The person's key is used for that one call and never stored here.
// Without either it says so plainly — the Free route in the sheet still works.

import { costOf, jobName, logCall } from './ai-usage.js';
import { loadProfile } from './profile.js';

const MODELS = new Set(['claude-haiku-5-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5']);
const BUILT_IN_MODEL = 'claude-haiku-5-5';

// The model is a setting (Round 4, 19 Nov 2026): a plain Cloudflare variable AI_MODEL (Workers & Pages ›
// dad-hq › Settings › Variables). Set to a claude- model, it's the default and the allowlist takes it;
// unset (or not a claude- name), Haiku 5.5 as before. The page no longer names a model.
export const defaultModel = env => {
  const m = String((env && env.AI_MODEL) || '').trim();
  return /^claude-[a-z0-9.-]{1,60}$/.test(m) ? m : BUILT_IN_MODEL;
};
const allowed = (env, m) => MODELS.has(m) || m === defaultModel(env);

/** A clear answer when Anthropic says the model doesn't exist (a retired model, or a typo in AI_MODEL). */
export function retiredModel(status, text, model) {
  if (status !== 404) return null;
  let type = ''; try { type = JSON.parse(text)?.error?.type ?? ''; } catch { /* not JSON */ }
  if (type !== 'not_found_error') return null;
  return err(`The AI model ${model} isn’t available any more. Set AI_MODEL in the Cloudflare dashboard (Workers & Pages › dad-hq › Settings › Variables) to a current model. The free route still works.`, 404);
}
const FALLBACK_MODEL = 'claude-haiku-4-5-20251001';   // if Haiku 5.5 turns down the web search tool
const MAX_TOKENS_CAP = 8192; // 30 events as JSON is ~6k tokens
const MAX_SEARCHES = 5;

const err = (message, status) =>
  Response.json({ type: 'error', error: { message } }, { status });

export async function handleAI(request, env, url, ctx) {
  const { pathname } = url;

  if (pathname === '/api/status' && request.method === 'GET') {
    return Response.json({ ai: !!env.ANTHROPIC_API_KEY, model: defaultModel(env) }, { headers: { 'cache-control': 'no-store' } });
  }

  if (pathname !== '/api/anthropic') return null;
  // No CORS for this one: only Dad HQ's own pages may spend its key.
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return err('Use POST.', 405);
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return err('Not allowed from another site.', 403);
  const userKey = (request.headers.get('x-user-key') || '').trim();
  const apiKey = env.ANTHROPIC_API_KEY || (/^sk-ant-\S{20,}$/.test(userKey) ? userKey : '');
  if (!apiKey) return err('No API key yet — add yours in the sheet, or use the Free route.', 401);

  let body;
  try { body = await request.json(); } catch { return err('Invalid request body.', 400); }
  if (!Array.isArray(body.messages)) return err('No messages provided.', 400);
  const model = body.model && allowed(env, body.model) ? body.model : defaultModel(env);
  const max_tokens = Math.min(Number(body.max_tokens) || 1500, MAX_TOKENS_CAP);
  // Haiku 5.5 thinks by default and thinking is billed as output; these jobs ran fine on 4.5 with none.
  const payload = { model, max_tokens, messages: body.messages, ...(model.startsWith('claude-haiku-5') ? { thinking: { type: 'disabled' } } : {}) };
  if (body.search === true) {
    // Searches are placed near home: the town in Settings (Macclesfield until it's changed).
    const home = env.DB ? (await loadProfile(env)).home.name : 'Macclesfield';
    payload.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: MAX_SEARCHES, user_location: { type: 'approximate', country: 'GB', city: home } }];
  }

  const call = p => fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(p),
  });
  let res, text;
  try {
    res = await call(payload);
    text = await res.text();
    // Web search on Haiku 5.5 hasn't been tried on this account yet: if the request itself is refused
    // (400), run that one call on Haiku 4.5 rather than fail the job.
    if (res.status === 400 && payload.tools && payload.model !== FALLBACK_MODEL) {
      const { thinking, ...rest } = payload;
      res = await call({ ...rest, model: FALLBACK_MODEL });
      text = await res.text();
    }
  } catch (e) {
    return err('Couldn’t reach Anthropic: ' + (e.message || e), 502);
  }
  const gone = retiredModel(res.status, text, model);
  if (gone) return gone;
  const headers = { 'content-type': 'application/json' };
  // What it cost (12 Nov 2026): logged per job for the AI actions page, and sent back in a header
  // so the page can say so. Logged whichever key paid. A reply we can't read passes through untouched.
  if (res.ok && env.DB) {
    let reply = null; try { reply = JSON.parse(text); } catch { /* pass it through */ }
    if (reply?.usage) {
      headers['x-ai-cost'] = costOf(reply.model ?? model, reply.usage).toFixed(6);
      const saving = logCall(env, { job: jobName(body.job), model: reply.model ?? model, usage: reply.usage }).catch(() => {});
      if (ctx?.waitUntil) ctx.waitUntil(saving); else await saving;
    }
  }
  return new Response(text, { status: res.status, headers });
}
