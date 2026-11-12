# Dad HQ: handover

Front door for anyone taking this project over. Written 10 Nov 2026 from the code, the existing
docs, git history and Tom's past chats. The detail lives in [`../CLAUDE.md`](../CLAUDE.md) (layout,
events engine, magic button, password lock) and [`../README.md`](../README.md) (product write-up);
this file summarises and links to them. Rules shared by all of Tom's apps (hosting account, GitHub
accounts, secrets, icons, UI rules) are in the `sites/` folder's own `CLAUDE.md`, one level above
this repo, and are not repeated here.

This repo is **public** on GitHub. Keep personal details and secrets out of every file.

## What it is

A family planner for days out with Harry (5), centred on Macclesfield: hand-curated Activities,
Meals and Crafts (hundreds of each, filterable, searchable), an Events tab of real dated family
events, favourites (star) and a wishlist (bookmark), an "Add new" page for jotting things to look
up, and card editing. It is a single-household app used on Tom's phone and laptop, synced through
D1 so every device sees the same data. Installable as a PWA.

Live: https://dad-hq.tombolton21.workers.dev

## Run it locally

From a fresh clone (Node 18+):

```bash
npm ci                 # installs wrangler only
npm run db:init        # loads schema.sql into the LOCAL D1 (safe to re-run)
cp .dev.vars.example .dev.vars   # optional; fill AUTH_SECRET only if you test the password lock
npm run dev            # http://localhost:8787
```

Do **not** run `wrangler d1 create dad-hq` (the README's old step 1): the database already exists
and its id is in `wrangler.jsonc`, local dev uses a local copy (`preview_database_id`), and the
Cloudflare account has no free D1 slots left (see the `sites/` CLAUDE.md, "D1 slot sharing").

There is no build step and no test suite. A quick offline sanity check is
`npx wrangler deploy --dry-run --outdir /tmp/dadhq-dry` (bundles the Worker, uploads nothing).

## Deploy

```bash
npm run db:init:remote   # only when schema.sql changed (create-if-missing, keeps data)
npm run deploy           # wrangler deploy: the Worker in src/ plus everything in public/
```

What is deployed: `src/*.js` (the Worker) and every file in `public/` as static assets. What isn't:
`schema.sql`, docs, `.claude/`. Pushing to GitHub deploys nothing; there is no CI. It is a Worker,
so a new secret applies immediately without a redeploy. Before pushing, a new clone needs the
per-repo GitHub credential lines (see the `sites/` CLAUDE.md, "Two GitHub accounts").

## How it's built

- **`public/index.html`**: the whole app, about 9k lines in one file, including all the curated
  content. One file on purpose: it is one cacheable document for the offline PWA (`public/sw.js`).
  Don't split it.
- **`src/index.js`**: Cloudflare Worker. Order of handling: AI proxy, CORS preflight, password
  gate, `/api/backup`, events, places, sync, then static assets. Also defines the events
  *persona* (what kind of events to look for).
- **`src/events.js`**: events engine, **byte-identical to `../bozza-hq/src/events.js`** (checked
  10 Nov 2026). Change one, copy to the other. Builds the research prompt (`GET
  /api/events/prompt`, which lists events already stored so they aren't repeated) and upserts
  pasted or returned JSON (`POST /api/events/manual`).
- **`src/places.js`, `src/sync.js`**: user-added places, meals, crafts, drafts, card edits,
  favourites and hidden flags, stored as JSON blobs in D1 so they sync across devices.
- **`src/ai.js` + `public/lib/claude.js`**: the paid "Run it" route of the shared magic sheet.
  Locked proxy to Anthropic: Haiku only, max_tokens capped, same-origin only, optional web search
  (max 5) for events, places and "Fill in the details".
- **`src/auth.js` + `public/lock.js`**: optional password lock, a copy of the one in Bozza HQ,
  Storage Log and Swipefy.
- **`public/vendor/magic`, `public/vendor/chassis`**: copies of `sites/_shared/`. Edit the
  source there and run `node _shared/sync.mjs dad-hq`; never edit the copies.

External services: Cloudflare (Workers, D1), Anthropic API (only when someone taps Run it), and
whatever chatbot Tom pastes prompts into on the free route. Bozza HQ exposes `GET /api/dad-hq`
that offers kid-friendly places to this app (one direction only).

## Config and secrets

Names only. Locally in `.dev.vars` (gitignored; template in `.dev.vars.example`); live via
`npx wrangler secret put <NAME>`.

| Name | What for | Live? |
|---|---|---|
| `AUTH_SECRET` | Signs the `dh_session` cookie for the password lock. Lock fails closed without it. | Unconfirmed: check with `npx wrangler secret list` |
| `ANTHROPIC_API_KEY` | Site-wide key for Run it. | Deliberately **not** set (see Decisions) |

Bindings in `wrangler.jsonc`: `DB` (D1 `dad-hq`), `ASSETS` (`public/`). In the browser,
`localStorage` key `anthropic-key` holds the user's own Anthropic key, per device.

## Data

All real data is in Cloudflare D1 database **`dad-hq`**: tables `events`, `places`, `meals`,
`crafts`, `drafts`, `edits`, `flags`, `refresh_status`, `app_settings`. The built-in curated
Activities/Meals/Crafts are not in D1; they are in `public/index.html` (so they are in git).

Backup:
- In the app: Add new (the ＋ button) → Password & backup → **Download a backup**. That is
  `GET /api/backup`, a JSON file of events, places, meals, crafts, drafts, edits and flags
  (not `app_settings` or `refresh_status`). Needs the unlock cookie if the lock is on.
- From the command line: `npx wrangler d1 export dad-hq --remote --output dad-hq-backup.sql`
  (whole database as SQL; read-only on the live database).

There is **no import**. Restoring means writing the rows back by hand.

## Decisions

Newest first. Dates are from commits or from the day Tom said it in a chat.

- 2026-11-12: **AI Updates daily copy**: the module in `public/index.html` takes the App Hub's `#ai-hub-key=…` set-up link on load (`captureHubKey`), and `shareAiContext()` (next to `openAiUpdates()`) shares the AI Updates context with the App Hub (`shareContext`) once a page load, after the synced data (`window.dadDataLoaded`) and the saved events are in. It does nothing on a device without the Hub key or while the lock screen is up. Test in `test/ai-updates.test.mjs`; the contract is still `public/ai/`. Vendor ai-protocol and chassis re-synced. Service worker dadhq-v21.
- 2026-11-12: **AI Updates** (sites/ai-updates, Phase 4). Add new › **AI Updates** opens the shared
  paste/preview/apply sheet (`vendor/ai-protocol`), with Copy for ChatGPT. App id `dad_hq`, v1,
  actions `add_place`, `add_meal`, `add_craft`, `add_events`, `add_jot`, `set_flag`. Everything is in
  **`public/ai/`**: `schema.js` (the contract, plus `ENUMS`, the one list of allowed values), `guide.md`
  (for ChatGPT), `updates.js` (pure resolve, handlers, context). Applies through the app's own mappers,
  `saveImported`, a new `saveDraft` (Add to list now uses it) and a new `setItemFlag`; on this path a
  failed save throws and the sheet reports it (`postStrict`), while Get ideas / Fill in the details keep
  their offline-friendly saves. Names already in the app show "Already have …" with Add anyway.
  `src/events.js` untouched (still identical to Bozza HQ). Tests: `npm test`.
  Drift noted, not changed: the Fill in the details prompt omits craft `messy` (the mapper and 27
  built-ins use it, so AI Updates allows it); home base is "Macclesfield" in the app's prompts but
  "central Cheshire" in the shared events engine (AI Updates says Macclesfield).

- 12 Nov 2026: deployed the move onto the new shared pieces (stepper, cards, toasts, photo pieces and the rest; Tom's yes). Live site checked after clearing the service worker: new pieces present, data loads, no console errors.
- 12 Nov 2026 (later): synced shared components.css (_shared cbadf25): a `.ui-count` on a `.ui-btn.small` now sits out over the corner; also brings `.ui-stepper.small` and `.ui-table .tight`. No app code change. Not deployed.
- 12 Nov 2026: the Wishlist tab count and the Add new drafts count are the shared `.ui-count` (a dot-style count on the tab and on the + button; shown with `hidden`, not inline display). The 📍 and + buttons in the top bar are full-size `ui-btn quiet icon` (44px), because on the 36px small button the count covered the +. Cards stay `div.ui-card` with onclick: every card holds its own star/bookmark buttons, so none can be a `button.ui-card`. Dad HQ has no back-to-top button, so nothing moved to `.ui-fab`. `lock.js` is still the older copy (storage-log has the newer one), left alone. Service worker dadhq-v19. Not deployed.
- 2026-11-12: **Haiku 5.5** for every Claude job (was Haiku 4.5): about a tenth of the price per token. Thinking
  is sent off, as 4.5 had none. Web search on 5.5 hadn't been tried on this account, so if Anthropic refuses a
  search request (400) `src/ai.js` reruns it once on Haiku 4.5. Step 1 of moving every app; Food Planner moved too.
- 2026-11-12: **Find events is free-only.** Tom: the events job was the one that "cost loads" on Claude (web
  search re-reads every page it found before each next search). Its sheet shows Run it greyed out, "Switched off:
  too costly" (the shared sheet's new `runOff` option), and its AI actions row says so instead of a price. The other
  five jobs keep both routes.
- 2026-11-12: **AI actions page** (Add new › AI actions, `public/lib/ai-actions.js`), the same as Food Planner's.
  It lists all six AI jobs (`public/lib/ai-catalogue.js`, add a row with every new AI feature), and every row
  shows Free · ChatGPT and Paid · ~cost. Tapping one asks free or paid, then opens that job's sheet on the
  chosen route. The Worker logs every Claude run's cost (tokens at Haiku prices plus 1¢ per web search) in D1
  table `ai_usage` (one row, created on first use), and sends it back in an `x-ai-cost` header. A job's price
  is its last 10 runs' average, or an estimate until it has run. Each sheet's Run it note uses the same figure:
  the fixed "about 1p / 5p" notes were far too low for web-search jobs, which is likely where the $6 went.
  Credit left = a balance Tom types in (Anthropic has no balance API) less what's logged since. Setting it is a
  write, so it needs the unlock when the password lock is on. Tom: "do you want to do the free version or
  the paid version? This is how much the paid version is." Estimates still need checking against real runs.
- 12 Nov 2026: deployed the shared components update (missing pieces + four CSS fixes); live checked. Service worker dadhq-v15.
- 2026-11-11: shared `ui-badge` good/warn/bad text now mixes 30% of `--text` into the status colour (the green and amber were about 2.7:1 in Light; now 4.5:1 or better in both themes). Synced copy of `components.css`, deployed 11 Nov.
- 2026-11-11: shared `--success` and `--warning` are deeper in Light (`#15803d`, `#b45309`, 5:1 on white; the old bright ones were about 3.2:1 as words) and stay bright in Dark. Synced copy of `tokens.css`.
- 2026-11-11: shared light/dark switch. `vendor/chassis/theme.js` first in `<head>`, `<theme-switch>`
  at the top of the Settings card (bottom of Add new). Section colours have deeper Light values (readable
  as text on white) and the old bright ones in Dark, in the three token places. `lock.js` is now
  storage-log's shared ui- version (the old one had its own @media-only dark). SW `dadhq-v12`. Commit
  `d485903`, deployed and checked live 11 Nov.
- 2026-11-10: every screen built from the shared `ui-` components (`vendor/chassis/components.css`):
  shared top bar and bottom tab bar, chips, badges, cards, sheets on `<dialog>`, toast, empty
  states. Each section keeps its own colour through `--accent` on `.t-*`; Nunito for the name
  only. Tom OK'd the look in the browser first. Commit `2528462`, deployed the same evening.
- 2026-11-10: Checkboxes, switches and the slider are drawn by the shared chassis controls, not
  hand-styled (rule from the `sites/` CLAUDE.md).
- 2026-11-05: Added an optional password lock, **off by default**: writes locked, reads open.
  Put it at the bottom of Add new because the app has no settings screen. Backup is download-only;
  no import because a safe merge needs per-table rules (events' flags, for example).
- 2026-11-04: Every AI job (Get ideas, Find events, Fill in the details, Rewrite it) goes through
  the shared magic sheet, replacing the app's own ChatGPT copy/paste boxes. Sparkle only on these.
- 2026-11-04: No site-wide Anthropic key. Run it is always offered; the first tap asks for the
  user's own key, kept in that browser only and never stored on the server. If a site key is
  ever set, it wins.
- 2026-10-05: Moved from a static page to a Worker + D1 so that everything syncs. Fuzzy search,
  clear (×) buttons on inputs, and 16px inputs so iOS never zooms on focus.
- 2026-08-05: Every "Add place/meal/craft" goes to one global **Add new** page: jot a list, then
  one button produces a prompt to look them all up. Cards can be edited by hand or by a prompt.
  Tom asked that the site "not zoom in ever" on iPhone.
- 2026-08-02: Removed the events **calendar view** ("all it shows is dots"); a Month filter
  replaced it. Events can't be favourited, because they expire. Removed "Pick for me" from all
  pages. Card detail modal trimmed to Directions, Edit, Remove (and Website for events); star and
  bookmark live on the card. Events cards use the same card and modal as the other three tabs.
  Wishlist added as a bookmark icon next to the location pin, with its own page.
- 2026-07-28: Dropped the server-side, API-driven "refresh events" in favour of the free ChatGPT
  prompt first; the prompt takes Harry's age and a count (5 to 30) from dropdowns and lists the
  events already stored so they aren't duplicated. Same mechanic for activities, crafts and meals.
  Tom: "I always want things to sync across devices", so user additions go to D1, not local storage.
- 2026-07-28: Every section (Activities, Meals, Crafts, Events) shares the same filter bar and
  search, inline with the Filters button.
- 2026-06 (from commits): the events engine is shared with Bozza HQ, with only the persona
  different. The app was renamed from the `harry-planner` folder to `dad-hq`.
- 2026-06-10: Places should be specific and plannable (not "regional" catch-alls). Local filters
  of under 5, 10 and 20 miles, measured from the current home location (a guest location can be set).

## Status (12 Nov 2026)

Works: all four tabs with filters and search, favourites and wishlist, Add new with the magic
sheet, the AI actions page with logged costs, AI Updates (paste a ChatGPT block; `public/ai/`), card editing, events import (paid or free route), cross-device sync, optional password
lock, backup download, offline PWA.

Known issues and loose ends:
- `README.md` is partly stale: it still mentions a list/calendar toggle on Events (removed) and
  tells you to `wrangler d1 create` the database (don't). This handover is correct; the README
  was left unchanged.
- Run it's web search only works if web search is enabled for the key's Anthropic organisation;
  otherwise the sheet sends you to the free route.
- No import for backups.
- Automated tests cover only AI Updates (`npm test`, `test/ai-updates.test.mjs`).

## Parked ideas

- A server-side, scheduled events refresh (removed 2026-07-28; the free prompt route won).
- Events calendar view (removed 2026-08-02).
- A backup import / restore (deliberately not built, 2026-11-05).
- Splitting `index.html` into modules (rejected: the offline PWA depends on one file).

## Setup check

10 Nov 2026, fresh `git clone` of the local repo into a scratch folder: `npm ci` passed,
`npm run db:init` (local D1) passed, `wrangler deploy --dry-run` bundled the Worker with the `DB`
and `ASSETS` bindings, `node --check src/index.js` passed. Result: **pass**. The only fix needed
was in the docs: skip the README's `d1 create` step (noted above). Dev server not started.
