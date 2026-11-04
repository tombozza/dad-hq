// The paid route for the magic sheet (public/vendor/magic): is there a key on the site, and
// one call through the locked-down proxy (src/ai.js). Every AI job goes through these, so the
// model id lives in one place. Haiku unless a job genuinely needs more (sites/CLAUDE.md).
// Based on sites/_shared/starter/public/lib/claude.js, plus a `search` option (web search,
// capped on the server) for jobs about real places and dated events.

const MODEL = 'claude-haiku-4-5-20251001';
const KEY = 'anthropic-key';   // this device's own key, if the person added one (per site)
let status = null;

/** The person's own API key on this device — the magic sheet's `key` option. */
export const userKey = {
  get: () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } },
  has: () => !!userKey.get(),
  save: k => { try { localStorage.setItem(KEY, k); } catch { throw new Error('This browser won’t save it (private mode?).'); } },
  clear: () => { try { localStorage.removeItem(KEY); } catch { /* nothing saved */ } },
};

/** Resolves true when the site has an Anthropic key (asked once per page load). */
export function aiAvailable() {
  status ??= fetch('/api/status').then(r => (r.ok ? r.json() : {})).then(j => !!j.ai).catch(() => false);
  return status;
}

/** Ask Claude. `content` is a prompt string or a list of parts. Resolves to the reply text. */
export async function askClaude(content, { maxTokens = 2000, search = false } = {}) {
  const res = await fetch('/api/anthropic', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(userKey.has() ? { 'x-user-key': userKey.get() } : {}) },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, search, messages: [{ role: 'user', content }] }),
  });
  let body; try { body = await res.json(); } catch { body = null; }
  if (res.status === 401 && userKey.has()) throw new Error('Anthropic didn’t accept your API key — tap Change key to fix it');
  if (!res.ok || !body || body.type === 'error') throw new Error(body?.error?.message ?? `Claude didn’t answer (HTTP ${res.status})`);
  // With web search on, the reply mixes search blocks with text; only the text is the answer.
  return (body.content ?? []).filter(c => c.type === 'text').map(c => c.text ?? '').join('');
}
