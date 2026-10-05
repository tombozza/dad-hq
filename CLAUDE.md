# Dad HQ

Family planning and activity finder for days out with Harry (5), centred on
**Macclesfield**. Cloudflare Worker + D1 + a hand-curated single-page PWA.

Live: https://dad-hq.tombolton21.workers.dev · Repo: `github.com/tombozza/dad-hq`
See also [`README.md`](README.md) for the fuller product write-up.

## Layout

```
src/index.js        Worker: serves the PWA from ASSETS, hosts the events API,
                    and defines the search PERSONA
src/events.js       the events engine — Claude-with-web-search → D1
src/places.js       place data helpers
src/sync.js         cross-device state sync
public/index.html   the entire curated PWA — ~9k lines, one file
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

## How a refresh works

"Refresh events" is **manual and costs money**. One Claude call with a few web searches
finds real, dated family events near Macclesfield and UK-wide over the next ~4 months,
then upserts them into D1. Starred events and in-plans flags are stored separately and
**survive a refresh** — never wipe the table on refresh, upsert into it.

Without `ANTHROPIC_API_KEY` everything works except the refresh button, which returns a
clear "no key set" message. Keep that graceful failure.

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
npx wrangler secret put ANTHROPIC_API_KEY   # one-time
npm run deploy
```

This is a **Worker**, so a new secret applies immediately — no redeploy needed
(unlike the Pages apps in this directory).
