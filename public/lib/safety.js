// The safety net in a classic-script app (Round 2, 19 Nov 2026). Shared byte for byte by Dad HQ and
// Bozza HQ (public/lib/safety.js in each). Builds the save queue (vendor/safety/save-queue.js) that
// lib/safety-shim.js hands saves to, shows its status in [data-save-status], and puts the two sheets
// (Recently deleted, Restore from a backup) on window for the app's classic script.
import { createSaveQueue, saveStatus } from '/vendor/safety/save-queue.js';
import { openBin, openRestore } from '/vendor/safety/bin-sheet.js';
import { restoreMissingAll } from '/vendor/safety/bin.js';

async function send(op) {
  const init = { method: op.method, credentials: 'same-origin' };
  if (op.body !== undefined) { init.headers = { 'content-type': 'application/json' }; init.body = JSON.stringify(op.body); }
  const r = await fetch(op.url, init);
  if (r.ok) return;
  const d = await r.json().catch(() => ({}));
  throw Object.assign(new Error((typeof d.error === 'string' && d.error) || `HTTP ${r.status}`), { status: r.status });
}

const queue = createSaveQueue({
  name: window.sqName,
  send,
  // The server refused a save for good (a 4xx): say so, once, rather than retrying forever.
  onDrop: (op, e) => window.dispatchEvent(new CustomEvent('save-dropped', { detail: { op, message: e.message } })),
});
window.saveQueue = queue;
for (const op of window.sqTake()) queue.push(op);
window.addEventListener('applock:unlocked', () => queue.flush());
// When the last waiting save lands, the app can reload from the server again.
let was = queue.pending();
queue.subscribe((s) => {
  if (was && !s.waiting) window.dispatchEvent(new CustomEvent('save-settled'));
  was = s.waiting > 0;
});
for (const slot of document.querySelectorAll('[data-save-status]')) slot.append(saveStatus(queue));

Object.assign(window, { openBin, openRestore, restoreMissingAll });
window.dispatchEvent(new CustomEvent('safety-ready'));
