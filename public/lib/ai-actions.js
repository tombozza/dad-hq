// AI actions (Add new › AI actions): every AI job in Dad HQ on one page, with what each costs.
// The same page as Food Planner's (food-planner/ui/app/ai-actions.js), fitted to this app.
//
// Tom (12 Nov 2026): "a generic AI helper section that has all of the potential options … if I can't
// find it within the tool itself", and of Dad HQ in particular: "if it generates me ideas using
// Claude's API, it ended up costing me like $6 … if I could see that that would only cost me 1 cent,
// I would be more likely to do it." And: "do you want to do the free version or the paid version?
// This is how much the paid version is." So every row shows both, and tapping one asks which.
//
// Costs: the average of each job's last 10 runs (logged by the Worker, src/ai-usage.js), or an
// estimate until it has run. Credit left: Anthropic has no balance call, so it's the figure typed in
// here after a top-up, less what Dad HQ has spent since. Other apps and the Console aren't counted.
// index.html is a classic script: this module reaches its globals (selectTab, getIdeas, …) on window.

import { AI_ACTIONS, AI_GROUPS, PRICEY, money, jobCost } from './ai-catalogue.js';
import { aiUsage } from './claude.js';

const st = { q: '', editing: false, saving: false, error: '' };
let data = null;   // GET /api/ai-usage
const TAB = { act: 'activities', meal: 'meals', craft: 'crafts', event: 'events' };

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const howSure = c => (c.measured ? `avg of ${Math.min(c.runs, 10)} run${c.runs === 1 ? '' : 's'}` : 'estimate');
const root = () => document.getElementById('ai-body');
const toast = m => (window.dhToast ? window.dhToast(m) : null);
let app = { drafts: () => 0, open: () => true };   // from index.html: its state `S` isn't on window

function credit() {
  if (!data) return '<p class="ui-hint">Reading what’s been spent…</p>';
  const l = data.ledger, monthSpend = l.months?.[new Date().toISOString().slice(0, 7)] ?? 0;
  const left = data.remaining == null ? '—' : money(Math.max(0, data.remaining));
  const form = `<form class="ui-stack" data-balform>
      <label class="ui-field"><span>Credit ($)</span>
        <input class="ui-input" name="amount" inputmode="decimal" placeholder="e.g. 18.40" value="${data.balance ? data.balance.amount : ''}"></label>
      <div class="ui-actions"><button class="ui-btn primary small" ${st.saving ? 'disabled' : ''}>Save</button>
        <button type="button" class="ui-btn quiet small" data-balcancel>Cancel</button>
        ${data.balance ? '<button type="button" class="ui-btn quiet small" data-balclear>Remove</button>' : ''}</div>
      ${st.error ? `<p class="ui-hint dh-ai-error">${esc(st.error)}</p>` : ''}
      <p class="ui-hint">console.anthropic.com › Billing</p>
    </form>`;
  return `<div class="ui-stats">
      <div class="ui-stat"><strong>${left}</strong><span>Credit left${data.balance ? ` · from ${money(data.balance.amount)} on ${new Date(data.balance.asOf).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : ''}</span></div>
      <div class="ui-stat"><strong>${money(monthSpend)}</strong><span>This month · ${l.runs} run${l.runs === 1 ? '' : 's'}</span></div>
    </div>
    ${st.editing ? form : `<div class="ui-actions"><button class="ui-btn small" data-baledit>${data.balance ? 'Update credit balance' : 'Set credit balance'}</button></div>`}`;
}

function costLine(a) {
  if (a.off) return `<span class="dh-ai-cost"><span class="ui-badge good">Free</span><span class="ui-badge">Paid · off</span></span>`;
  const c = jobCost(a.job, data?.ledger);
  const cls = c.cost != null && c.cost > PRICEY ? 'warn' : 'accent';
  return `<span class="dh-ai-cost"><span class="ui-badge good">Free</span>
    <span class="ui-badge ${cls}">Paid · ${money(c.cost).startsWith('<') ? '' : '~'}${money(c.cost)}</span>
    <small>${howSure(c)}${a.search ? ' · uses web search' : ''}</small></span>`;
}

const row = a => `<li><button class="ui-row" data-job="${a.job}" data-ai-row data-text="${esc(`${a.title} ${a.text} ${a.where} ${a.group}`.toLowerCase())}">
    <span class="main"><span>${esc(a.title)}</span>${costLine(a)}</span></button></li>`;

function draw() {
  const el = root(); if (!el) return;
  el.innerHTML = `
    <div class="ui-stack">
      <div class="ui-head"><button class="ui-btn quiet small" data-aiback>← Back</button></div>
      <h1 class="ui-title"><magic-mark></magic-mark> AI actions</h1>
    </div>
    <div class="ui-card ui-stack" data-credit>${credit()}</div>
    <input class="ui-input search" type="search" placeholder="Search — ideas, events, rewrite…" value="${esc(st.q)}" data-aiq aria-label="Search AI actions">
    ${AI_GROUPS.map(g => `<section class="ui-stack" data-ai-group>
      <span class="ui-label">${esc(g)}</span>
      <div class="ui-card"><ul class="ui-list">${AI_ACTIONS.filter(a => a.group === g).map(row).join('')}</ul></div></section>`).join('')}
    <p class="ui-hint" data-ainone hidden>Nothing matches.</p>`;
  filter();
}

// filter in place: typing never redraws the page, so focus and scroll stay put
function filter() {
  const el = root(); if (!el) return;
  const q = st.q.trim().toLowerCase();
  let shown = 0;
  el.querySelectorAll('[data-ai-row]').forEach(r => { const on = !q || q.split(/\s+/).every(w => r.dataset.text.includes(w)); r.parentElement.hidden = !on; if (on) shown++; });
  el.querySelectorAll('[data-ai-group]').forEach(g => { g.hidden = !g.querySelector('li:not([hidden])'); });
  const none = el.querySelector('[data-ainone]'); if (none) none.hidden = shown > 0;
}

const drawCredit = () => { const el = root()?.querySelector('[data-credit]'); if (el) el.innerHTML = credit(); };

async function save(balance) {
  st.saving = true; st.error = ''; drawCredit();
  try {
    const res = await fetch('/api/ai-usage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ balance }) });
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw new Error('The password lock is on: unlock this device first.');
    if (!res.ok || !body?.ledger) throw new Error(body?.error?.message ?? `Couldn’t save (HTTP ${res.status})`);
    data = body; st.editing = false; aiUsage({ fresh: true });
    toast(balance == null ? 'Credit balance removed' : 'Credit balance saved');
  } catch (e) { st.error = e.message; }
  st.saving = false; drawCredit();
}

// Free or paid? The answer is what the magic sheet opens on (it remembers the last route: 'magic-route').
function choose(a) {
  const c = jobCost(a.job, data?.ledger);
  let dlg = document.getElementById('ai-choose');
  if (!dlg) {
    dlg = document.createElement('dialog');
    dlg.className = 'ui-sheet t-act'; dlg.id = 'ai-choose';
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    document.body.append(dlg);
  }
  dlg.innerHTML = `<header><h2>${esc(a.title)}</h2><button class="ui-btn quiet icon small" data-close aria-label="Close">✕</button></header>
    <div class="body">
      <div class="ui-card"><ul class="ui-list">
        <li><button class="ui-row" data-route="run"><span class="main"><span>Paid · ${money(c.cost).startsWith('<') ? '' : '~'}${money(c.cost)}</span></span></button></li>
        <li><button class="ui-row" data-route="free"><span class="main"><span>Free</span></span></button></li>
      </ul></div>
    </div>`;
  dlg.onclick = e => {
    if (e.target === dlg || e.target.closest('[data-close]')) return dlg.close();
    const b = e.target.closest('[data-route]'); if (!b) return;
    try { localStorage.setItem('magic-route', b.dataset.route); } catch { /* private mode: the sheet asks again */ }
    dlg.close();
    go(a);
  };
  dlg.showModal();
}

function go(a) {
  const [kind, type] = a.open.split(':');
  if (kind === 'ideas') { window.selectTab(TAB[type]); window.getIdeas(type); }
  else if (kind === 'addnew') {
    window.openAddNew();
    if (app.drafts()) window.fillDrafts();
    else { document.getElementById('an-name')?.scrollIntoView({ block: 'center' }); toast('List is empty'); }
  } else { window.selectTab('activities'); }
}

/** Draw the page into #ai-body (renderTab('ai') calls this, passing what it needs from S). */
export function renderAiActions(from) {
  if (from) app = from;
  const el = root(); if (!el) return;
  if (!el.dataset.wired) {
    el.dataset.wired = '1';
    el.addEventListener('input', e => { if (e.target.matches('[data-aiq]')) { st.q = e.target.value; filter(); } });
    el.addEventListener('submit', e => {
      if (!e.target.matches('[data-balform]')) return;
      e.preventDefault();
      const raw = String(new FormData(e.target).get('amount') ?? '').replace(/[$£,\s]/g, '');
      const n = Number(raw);
      if (!raw || !Number.isFinite(n) || n < 0) { st.error = 'Type the amount in dollars, like 18.40.'; return drawCredit(); }
      save(n);
    });
    el.addEventListener('click', e => {
      const job = e.target.closest('[data-job]');
      if (job) { const a = AI_ACTIONS.find(x => x.job === job.dataset.job); return a.off ? go(a) : choose(a); }
      if (e.target.closest('[data-aiback]')) { window.openAddNew(); return document.getElementById('an-settings')?.previousElementSibling?.scrollIntoView({ block: 'center' }); }
      if (e.target.closest('[data-baledit]')) { st.editing = true; st.error = ''; drawCredit(); root().querySelector('[data-balform] input')?.focus(); }
      else if (e.target.closest('[data-balcancel]')) { st.editing = false; st.error = ''; drawCredit(); }
      else if (e.target.closest('[data-balclear]')) save(null);
    });
  }
  draw();
  aiUsage({ fresh: true }).then(u => {
    data = u ?? { ledger: { total: 0, runs: 0, months: {}, jobs: {} }, balance: null, remaining: null };
    // fill in the figures in place, so a search already being typed keeps its focus
    if (!app.open()) return;
    drawCredit();
    root().querySelectorAll('[data-ai-row] .dh-ai-cost').forEach(c => { c.outerHTML = costLine(AI_ACTIONS.find(a => a.job === c.closest('[data-job]').dataset.job)); });
  });
}
