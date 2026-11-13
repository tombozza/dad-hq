// Optional password lock — client half (server half: the Worker's auth.js). OFF by default.
// Load this BEFORE the app's own script: it wraps fetch so any 401 from a write to /api/
// brings up the password screen. When the lock is off this does one GET /api/settings and
// nothing else. Exposes window.AppLock for the Settings screen:
//   AppLock.ready            -> Promise<{ enabled, unlocked }>
//   AppLock.save(on, pw)     -> switch the lock on (with a password) or off; throws on error
//   AppLock.lock()           -> forget the password on this device
//   AppLock.download(name)   -> fetch /api/backup and save it as a .json file
// Same file in storage-log, spotify-albums (Swipefy), dad-hq and bozza-hq. The lock screen is
// drawn with the shared ui- classes, so the page must load vendor/chassis/tokens.css and
// components.css; its colour is the app's --accent.
(function () {
  const state = { enabled: false, unlocked: true };
  const nativeFetch = window.fetch.bind(window);

  async function refresh() {
    try {
      const res = await nativeFetch('/api/settings', { cache: 'no-store', credentials: 'same-origin' });
      if (res.ok) {
        const d = await res.json();
        state.enabled = !!d.password_enabled;
        state.unlocked = !!d.unlocked;
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
        padding:16px;background:var(--overlay);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
      .applock form{width:100%;max-width:340px;display:grid;gap:var(--sp-3);box-shadow:var(--shadow-lg)}
      .applock .err{color:var(--danger);min-height:1.2em;font-size:var(--text-sm)}
      .applock .err:empty{display:none}`;
    overlay = document.createElement('div');
    overlay.className = 'applock';
    overlay.innerHTML = `<form class="ui-card" autocomplete="on">
        <h2 class="ui-h2">🔒 Locked</h2>
        <input class="ui-input" type="password" name="password" autocomplete="current-password" placeholder="Password" aria-label="Password" required>
        <div class="err" aria-live="polite"></div>
        <button class="ui-btn primary block" type="submit">Unlock</button>
      </form>`;
    overlay.appendChild(css);
    // keep keys typed here away from the app's own shortcuts (Enter, arrows…)
    overlay.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.appendChild(overlay);
    const form = overlay.querySelector('form');
    const err = overlay.querySelector('.err');
    const input = overlay.querySelector('input');
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
        state.unlocked = true;
        overlay.remove();
        overlay = null;
        window.dispatchEvent(new CustomEvent('applock:unlocked'));
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
    return { ...state };
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
    refresh, save, lock, download,
  };
})();
