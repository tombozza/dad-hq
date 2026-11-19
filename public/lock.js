// Optional password lock — client half (server half: the Worker's auth.js). OFF by default.
// Load this BEFORE the app's own script: it wraps fetch so any 401 from a write to /api/
// brings up the password screen. When the lock is off this does one GET /api/settings and
// nothing else. Exposes window.AppLock for the Settings screen:
//   AppLock.ready            -> Promise<{ enabled, unlocked }>
//   AppLock.save(on, pw)     -> switch the lock on (with a password) or off; throws on error
//   AppLock.lock()           -> forget the password on this device
//   AppLock.download(name)   -> fetch /api/backup and save it as a .json file
//   AppLock.newRecoveryCode() -> make a fresh recovery code (asks first if there is one) and show it
//   AppLock.mountRecovery(row, { hide }) -> fill an empty <li class="ui-row"> with the "Recovery code" row
//                               (New code / Make one); it hides itself (or `hide`) while the lock is off
// Recovery code (Round 3, 19 Nov 2026): whenever a password is saved the server sends a recovery code once,
// and save() shows it (vendor/safety/recovery-sheet.js) before it resolves. On the lock screen the code works
// in place of the password, and the screen says so before going in.
// Same file in storage-log, spotify-albums (Swipefy), dad-hq and bozza-hq. The lock screen is
// drawn with the shared ui- classes, so the page must load vendor/chassis/tokens.css and
// components.css; its colour is the app's --accent.
(function () {
  const state = { enabled: false, unlocked: true, hasRecoveryCode: false };
  const nativeFetch = window.fetch.bind(window);
  // The shared sheet is a module; a classic script loads it with import() when it's first needed.
  let sheetMod = null;
  const sheet = () => (sheetMod = sheetMod || import('/vendor/safety/recovery-sheet.js'));
  const appName = () =>
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content || document.title || 'this app';
  const changed = () => window.dispatchEvent(new CustomEvent('applock:change', { detail: { ...state } }));

  async function refresh() {
    try {
      const res = await nativeFetch('/api/settings', { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) {
        const d = await res.json();
        state.enabled = !!d.password_enabled;
        state.unlocked = !!d.unlocked;
        state.hasRecoveryCode = !!d.has_recovery_code;
        changed();
      }
    } catch { /* offline: leave as is */ }
    return { ...state };
  }

  window.fetch = async function (input, init) {
    const res = await nativeFetch(input, init);
    if (res.status === 401) {
      try {
        const u = new URL(typeof input === 'string' ? input : input.url, location.href);
        const d = await res.clone().json().catch(() => ({}));
        if (u.origin === location.origin && u.pathname.startsWith('/api/') && u.pathname !== '/api/auth' && d.code === 'locked') {
          state.enabled = true;
          state.unlocked = false;
          show();
        }
      } catch { /* ignore */ }
    }
    return res;
  };

  let overlay = null;
  function show() {
    if (overlay) return;
    if (!document.body) { document.addEventListener('DOMContentLoaded', show, { once: true }); return; }
    const css = document.createElement('style');
    // Built from the shared components (vendor/chassis/components.css: ui-card, ui-input, ui-btn),
    // so it takes the app's --accent and follows light/dark. Only the overlay is drawn here.
    css.textContent = `
      .applock{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
        inline-size:100%;block-size:100%;max-inline-size:none;max-block-size:none;margin:0;border:0;color:inherit;
        padding:16px;background:var(--overlay);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
      .applock::backdrop{background:transparent}
      .applock form{width:100%;max-width:340px;display:grid;gap:var(--sp-3);box-shadow:var(--shadow-lg)}
      .applock .err{color:var(--danger);min-height:1.2em;font-size:var(--text-sm)}
      .applock .err:empty{display:none}`;
    // A modal <dialog>, so it sits above any sheet or dialog the app has open (19 Nov 2026: Swipefy's
    // Settings is a modal dialog, and a plain overlay was drawn underneath it).
    overlay = document.createElement('dialog');
    overlay.className = 'applock';
    overlay.innerHTML = `<form class="ui-card" autocomplete="on">
        <h2 class="ui-h2">Locked</h2>
        <input class="ui-input" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required>
        <p class="ui-hint" data-hint></p>
        <div class="err" aria-live="polite"></div>
        <button class="ui-btn primary block" type="submit">Unlock</button>
      </form>`;
    overlay.appendChild(css);
    // keep keys typed here away from the app's own shortcuts (Enter, arrows…)
    overlay.addEventListener('keydown', (e) => e.stopPropagation());
    overlay.addEventListener('cancel', (e) => e.preventDefault());   // Esc doesn't get past it
    document.body.appendChild(overlay);
    overlay.showModal();
    const form = overlay.querySelector('form');
    const err = overlay.querySelector('.err');
    const input = overlay.querySelector('input');
    const hint = overlay.querySelector('[data-hint]');
    sheet().then((m) => { hint.textContent = m.RECOVERY_HINT; }).catch(() => hint.remove());
    const finish = () => {
      state.unlocked = true;
      overlay.close();
      overlay.remove();
      overlay = null;
      window.dispatchEvent(new CustomEvent('applock:unlocked'));
    };
    setTimeout(() => input.focus({ preventScroll: true }), 50);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        const res = await nativeFetch('/api/auth', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ password: input.value }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(d.error || 'Incorrect password.');
        if (!d.recovered) { finish(); return; }
        // In with the recovery code: say so before going in.
        const note = await sheet().then((m) => m.RECOVERED_NOTE).catch(() => 'Unlocked with your recovery code.');
        form.innerHTML = `<h2 class="ui-h2">Unlocked</h2><p class="ui-note good"></p>
          <button class="ui-btn primary block" type="button" data-continue>Continue</button>`;
        form.querySelector('.ui-note').textContent = note;
        const go = form.querySelector('[data-continue]');
        go.addEventListener('click', finish);
        go.focus({ preventScroll: true });
      } catch (ex) {
        err.textContent = ex.message || 'Could not unlock.';
        input.select();
      }
    });
  }

  async function save(on, password) {
    const res = await nativeFetch('/api/settings', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password_enabled: !!on, password: password || undefined }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { state.unlocked = false; show(); }
    if (!res.ok) throw new Error(d.error || 'Could not save.');
    state.enabled = !!d.password_enabled;
    state.unlocked = true;
    if (!state.enabled) state.hasRecoveryCode = false;
    if (d.recovery_code) {
      // Shown once: the only time the code is ever on screen.
      state.hasRecoveryCode = true;
      await (await sheet()).showRecoveryCode(d.recovery_code, { app: appName() });
    }
    changed();
    return { ...state };
  }

  async function newRecoveryCode() {
    if (state.hasRecoveryCode && !confirm('Make a new recovery code? The old one will stop working.')) return false;
    const res = await nativeFetch('/api/settings', {
      method: 'PUT', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ new_recovery_code: true }),
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) { state.unlocked = false; show(); }
    if (!res.ok || !d.recovery_code) throw new Error(d.error || "Couldn't make a code.");
    state.hasRecoveryCode = true;
    await (await sheet()).showRecoveryCode(d.recovery_code, { app: appName() });
    changed();
    return true;
  }

  // The Settings row. Updated in place, so the page never moves.
  function mountRecovery(row, { hide = row } = {}) {
    row.innerHTML = `<div class="main"><span>Recovery code</span><span class="sub"></span></div>
      <button type="button" class="ui-btn small"></button>`;
    const sub = row.querySelector('.sub'), btn = row.querySelector('button');
    const sync = () => {
      if (!row.isConnected && row.dataset.mounted) { window.removeEventListener('applock:change', sync); return; }
      row.dataset.mounted = '1';
      hide.hidden = !state.enabled;
      sub.textContent = state.hasRecoveryCode
        ? 'Works in place of the password if you forget it.'
        : 'None yet. Make one in case you forget the password.';
      btn.textContent = state.hasRecoveryCode ? 'New code' : 'Make one';
    };
    btn.addEventListener('click', async () => {
      try { await newRecoveryCode(); } catch (e) { sub.textContent = e.message; return; }
      sync();
    });
    window.addEventListener('applock:change', sync);
    sync();
  }

  async function lock() {
    await nativeFetch('/api/auth', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'logout' }),
    });
    await refresh();
    if (state.enabled && !state.unlocked) show();
  }

  async function download(prefix) {
    const res = await fetch('/api/backup', { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error(res.status === 401 ? 'Unlock first.' : 'Backup failed (' + res.status + ').');
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${prefix}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return blob.size;
  }

  window.AppLock = {
    state,
    ready: refresh().then((s) => { if (s.enabled && !s.unlocked) show(); return s; }),
    refresh, save, lock, download, newRecoveryCode, mountRecovery,
  };
})();
