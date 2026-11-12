# Dad HQ

Read docs/HANDOVER.md first.

Family planning and activity finder for days out with Harry (5), centred on
**Macclesfield**. Cloudflare Worker + D1 + a hand-curated single-page PWA.

Live: https://dad-hq.tombolton21.workers.dev · Repo: `github.com/tombozza/dad-hq`
See also [`README.md`](README.md) for the fuller product write-up.

## Layout

```
src/index.js        Worker: serves the PWA from ASSETS, hosts the events API,
                    and defines the search PERSONA
src/ai.js           the magic sheet's paid route: /api/status + locked /api/anthropic
src/events.js       the events engine — research prompt out, pasted/returned JSON → D1
src/places.js       place data helpers
src/sync.js         cross-device state sync
public/index.html   the entire curated PWA — ~9k lines, one file
public/lib/claude.js  aiAvailable() + askClaude() for the paid route (model id lives here)
public/vendor/magic   COPY of sites/_shared/magic — edit there, run node _shared/sync.mjs dad-hq
public/vendor/chassis COPY of sites/_shared/chassis: tokens, controls, ui- components (all loaded)
schema.sql          D1 schema (no migrations dir; this is applied wholesale)
```

`public/index.html` is the app. Activities, Meals and Crafts are all hand-curated content
inside it. It is large and monolithic **by design** — don't split it into modules on a
whim, the offline PWA story depends on it being one cacheable document.

## The shared events engine — read this before editing

[`src/events.js`](src/events.js) is shared **byte-for-byte with Bozza HQ**
(`../bozza-hq/src/events.js`). Only the search *persona* differs, and that lives in
`src/index.js`, not in the engine.

**If you change `events.js` here, copy it to Bozza HQ (or explain why you didn't).**
They are meant to stay identical; a silent fork is the failure mode.

Dad HQ's persona looks for what a 5-year-old would love — family fairs, character shows,
farm days, soft play, Santa's grottos — plus crossover events a dad enjoys too (car shows,
steam railways), tagged kid-friendly. Bozza HQ's persona is the grown-up equivalent.

## AI features: the magic button (4 Nov 2026)

Every AI job goes through the shared magic sheet (`openMagic()` from `public/vendor/magic/`),
which offers **Run it** (Claude Haiku through this Worker, on the site's key) and **Free**
(copy the prompt into ChatGPT/claude.ai, paste the reply back). Nothing is saved until the
check step: lists come back as tick boxes, a rewrite drops into the edit fields.
`index.html` is a classic script, so a small module in `<head>` puts `openMagic`,
`aiAvailable` and `askClaude` on `window`; `magicSheet()` in the app wraps it.

The four jobs, all marked with the sparkle (and nothing else is):
- **Get ideas** (Activities, Meals, Crafts) and **Find events** — `getIdeas(type)` opens the sheet
  straight away, with Harry's age and how many as dropdowns on it (the sheet's `choices`). The events prompt comes from `GET /api/events/prompt` so it can
  skip what's already in D1; the ticked events go to `POST /api/events/manual`.
- **Fill in the details** on the Add new tab — looks up everything on the jotted list.
- **Rewrite it** in the edit-card modal.

The paid route (`src/ai.js`) is locked: Haiku allowlist, `max_tokens` capped at 8192, no
client tools or system prompt, refuses other origins. `search: true` adds Anthropic's web
search tool, capped at 5 searches — used for events, places and Fill in the details, because
those need real dates and venues. Web search must be enabled for the API key's organisation
in the Anthropic console, or those runs fail (the sheet then points at the Free route).

There is **no server-side Claude call** in the events engine any more: an earlier version
refreshed events from the Worker; now both routes go through the sheet and end in the same
upsert. Starred events and in-plans flags **survive** an import — upsert, never wipe the table.

**Keys.** The site has no `ANTHROPIC_API_KEY` secret (checked 4 Nov 2026) and doesn't need one.
Tom's call: Run it is always offered; the first tap asks for his own Anthropic key, which is
saved in that browser only (`localStorage` `anthropic-key`, so once per device) and sent with
each run in `x-user-key`; `src/ai.js` uses it for that call and never stores it. "Change key"
under the Run it button changes or removes it. This is the shared sheet's `key` option
(`userKey` in `public/lib/claude.js`). If a site secret is ever set, it wins and nobody is asked.
With no key anywhere, the Free route works as before.

**AI actions page and costs (12 Nov 2026).** Add new › AI actions (`public/lib/ai-actions.js`) lists every AI
job from `public/lib/ai-catalogue.js`, with Free and Paid and the paid price. **Add a row there with any new AI
feature, and pass its `job` id to `askClaude`**, or its cost is logged as `other`. `src/ai-usage.js` (a copy of
Food Planner's `_ai-usage.js`, plus web search at 1¢ a search) logs each run in D1 table `ai_usage`;
`GET/POST /api/ai-usage` reads it and sets the typed-in credit balance.

There is a `GET /api/dad-hq` export on the Bozza HQ side that pushes kid-friendly places
here — the two apps are linked in that one direction.

## Password lock and backup (Nov 2026)

Bottom of the **Add new** tab (the ＋ button) → **Password & backup**. Dad HQ has no other
settings screen, so the card lives there.

- **Require a password** — off by default; when off the app works exactly as before. When on,
  every write under `/api/` (POST/PATCH/DELETE/PUT) and the backup download need the
  `dh_session` cookie, `HMAC(AUTH_SECRET, "authenticated")`; reads stay open and the app shows a
  password screen until the device is unlocked. The magic sheet's `/api/anthropic` and
  `/api/status` are handled before the gate (they're origin-locked and use Tom's own key).
  Same pattern as golf-tracker / life-kanban's gate, adapted for this Worker: `src/auth.js`
  (server) + `public/lock.js` (client, loaded first in `<head>`). Copies of both live in
  Storage Log, Swipefy and Bozza HQ — only the cookie name and storage differ.
- Stored in D1 table `app_settings` (one row, PBKDF2 hash, never plain text; created on first
  save). Secret: `AUTH_SECRET`. Forgot it?
  `npx wrangler d1 execute dad-hq --remote --command "UPDATE app_settings SET password_enabled=0, password_hash=NULL WHERE id=1"`.
- **Download a backup** (`GET /api/backup`): every row of events, places, meals, crafts,
  drafts, edits and flags as JSON. No import (a safe merge would need per-table rules, e.g.
  events' favourite/in_plans flags) — restore by hand if ever needed.

## Look: the shared components (10 Nov 2026)

Every button, field, card, list row, chip, badge, sheet, toast and the bottom tab bar are the shared
`ui-` classes from `vendor/chassis/components.css`; the `<style>` in `index.html` only lays them out
(`dh-` classes). Each section keeps its colour by setting `--accent` on its `.t-act/.t-meal/.t-craft/
.t-event/.t-wish` container. Nunito is `--font-display` only. Don't add app-made buttons or cards
back; if a piece is missing, it goes in `sites/_shared/chassis/` first.

## Commands

```bash
npm install
npm run db:init          # schema into LOCAL d1
npm run dev              # http://localhost:8787
```

Deploy:

```bash
npm run db:init:remote                      # only when schema.sql changed
npx wrangler secret put ANTHROPIC_API_KEY   # optional — turns on Run it in the magic sheet
npm run deploy
```

This is a **Worker**, so a new secret applies immediately — no redeploy needed
(unlike the Pages apps in this directory).

## Keep the handover current

At the end of any session that makes a decision or changes what works or what's next, add a
dated line to `docs/HANDOVER.md`'s Decisions and update its Status and Parked ideas.
