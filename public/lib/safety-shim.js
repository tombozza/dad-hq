// The safety net's glue for a classic-script app (Round 2, 19 Nov 2026). Shared byte for byte by Dad HQ
// and Bozza HQ (public/lib/safety-shim.js in each). Load it as a plain <script data-app="name"> before the
// app's own script; public/lib/safety.js (a module, so it runs later) builds the real save queue from
// vendor/safety/save-queue.js and takes over; saves made before then are already in its store.
//
//   sqPush({ url, method, body, key, coll, id, item | patch })  queue one save (key: a newer one replaces it)
//   sqWaiting()   the saves not sent yet (also those left from last time, before the module is up)
//   sqOverlay(list, coll)  a list the server just sent, with the waiting saves laid over it: a reload
//                          never puts back what's deleted on screen or undoes an edit not sent yet
(function () {
  'use strict';
  const name = document.currentScript.dataset.app;
  // Before the queue is up, a save goes straight into the queue's own store (same key, same shape), so
  // it's kept even if the module never loads (offline with a cold cache) and the queue sends it later.
  const KEY = 'sq:' + name;
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; } };
  const early = [];   // only if storage is blocked
  window.sqName = name;
  window.sqPush = (op) => {
    if (window.saveQueue) return window.saveQueue.push(op);
    const list = read().filter((x) => op.key == null || x.op.key !== op.key);
    list.push({ op, at: Date.now() });
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (_) { early.push(op); }
  };
  window.sqTake = () => early.splice(0);
  window.sqWaiting = () => (window.saveQueue ? window.saveQueue.waiting() : [...read().map((x) => x.op), ...early]);
  window.sqOverlay = (list, coll, idOf = (x) => x.id) => {
    let out = Array.isArray(list) ? list.slice() : [];
    for (const op of window.sqWaiting()) {
      if (!op || op.coll !== coll) continue;
      const i = out.findIndex((x) => String(idOf(x)) === String(op.id));
      if (op.method === 'DELETE') { if (i >= 0) out.splice(i, 1); }
      else if (op.item) { if (i >= 0) out[i] = op.item; else out.push(op.item); }
      else if (op.patch && i >= 0) out[i] = { ...out[i], ...op.patch };
    }
    return out;
  };
})();
