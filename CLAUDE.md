# Dad HQ

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
public/vendor/chassis COPY of the shared tokens; vendored, not loaded (see the alias block)
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
- **Get ideas** (Activities, Meals, Crafts) and **Find events** — a small picker (Harry's age,
  how many), then the sheet. The events prompt comes from `GET /api/events/prompt` so it can
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

`ANTHROPIC_API_KEY` is optional. Without it `/api/status` says `ai: false`, the sheet shows
only the Free route, and everything works.

There is a `GET /api/dad-hq` export on the Bozza HQ side that pushes kid-friendly places
here — the two apps are linked in that one direction.

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
