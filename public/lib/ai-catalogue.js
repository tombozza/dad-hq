// Everything AI does in Dad HQ, in one list: the AI actions page (Add new › AI actions) is drawn
// from it, and each job's `job` id is what the proxy logs its cost under (src/ai-usage.js).
// Same shape as food-planner/ui/lib/ai-catalogue.js.
//
// Add a row here whenever an AI feature is added, or it won't be on the page.
//   job       the id passed to askClaude({ job }).
//   search    the job looks things up on the web (each search costs, and so do the pages it reads).
//   estimate  dollars per run until real runs replace it. Worked out from Haiku 5.5 prices ($0.10 in /
//             $0.50 out per million tokens, since 12 Nov 2026; web search $10 per 1,000) at the usual size
//             (10 ideas). The searches are most of a search job's cost now.
//   off       the Claude route is switched off on purpose (says why); the job is free-only.
//   open      what tapping it does: 'ideas:<type>' opens that sheet, 'addnew' goes to the list,
//             'card' says how to reach it (it needs a card open).

export const AI_GROUPS = ['Ideas', 'Look things up', 'Cards'];

export const AI_ACTIONS = [
  { group: 'Ideas', title: 'Get place ideas', job: 'ideas-act', search: true, estimate: 0.06, open: 'ideas:act',
    text: 'New days out near home, checked on the web, skipping the ones you have', where: 'Places › Get ideas' },
  { group: 'Ideas', title: 'Get meal ideas', job: 'ideas-meal', estimate: 0.0015, open: 'ideas:meal',
    text: 'Meals Harry would eat, skipping the ones you have', where: 'Meals › Get ideas' },
  { group: 'Ideas', title: 'Get craft ideas', job: 'ideas-craft', estimate: 0.0015, open: 'ideas:craft',
    text: 'Crafts for his age, skipping the ones you have', where: 'Crafts › Get ideas' },
  { group: 'Look things up', title: 'Find events', job: 'find-events', search: true, estimate: 0.06, open: 'ideas:event', off: 'switched off, too costly',
    text: 'Real dated family events nearby, skipping ones already listed', where: 'Events › Find events' },
  { group: 'Look things up', title: 'Fill in the details', job: 'fill-details', search: true, estimate: 0.05, open: 'addnew',
    text: 'Looks up everything you jotted on the Add new list', where: 'Add new (＋) › Fill in the details' },
  { group: 'Cards', title: 'Rewrite a card', job: 'rewrite-card', estimate: 0.0004, open: 'card',
    text: 'Tighter wording, or say what to change; you check it before it’s saved', where: 'Open any card › Edit › Rewrite it' },
];

// Above this a job is flagged as pricey on the page.
export const PRICEY = 0.25;

/** "0.4¢", "12¢", "$1.20". */
export function money(d) {
  if (d == null || !Number.isFinite(d)) return '—';
  if (d === 0) return '0¢';
  if (d < 0.0005) return '<0.1¢';
  if (d < 0.1) return `${(d * 100).toFixed(1).replace(/\.0$/, '')}¢`;
  if (d < 1) return `${Math.round(d * 100)}¢`;
  return `$${d.toFixed(2)}`;
}

/** What a job costs: the average of its recent runs, or the estimate. */
export function jobCost(job, ledger) {
  const recent = ledger?.jobs?.[job]?.recent ?? [];
  if (recent.length) return { cost: recent.reduce((t, r) => t + r.cost, 0) / recent.length, runs: ledger.jobs[job].runs, measured: true };
  const est = AI_ACTIONS.find(a => a.job === job)?.estimate;
  return { cost: est ?? null, runs: 0, measured: false };
}
