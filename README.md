# Dad HQ

Family planning & activity finder for days out with a young child (Harry, 5), centred on **Macclesfield**. Activities, Meals and Crafts are a hand-curated single-page PWA ([`public/index.html`](public/index.html)); the new **📅 Events** tab auto-updates from the web.

> Formerly the `harry-planner` folder — renamed to `dad-hq` and wrapped in a thin Cloudflare Worker so it can power the events feature. The original curated page is unchanged; it's now served as a static asset by the Worker.

## Stack

- **Cloudflare Worker** ([`src/index.js`](src/index.js)) — serves the PWA and the events API.
- **D1** — stores events + your favourite / in-plans flags (syncs across devices).
- **Claude API** (web search) — finds upcoming kid & family-friendly events on demand.

The events engine ([`src/events.js`](src/events.js)) is shared byte-for-byte with Bozza HQ; only the search **persona** differs (set in [`src/index.js`](src/index.js)). Dad HQ looks for things a 5-year-old would love — family fairs, character shows, farm days, soft play, Santa's grottos — plus crossover events a dad enjoys too (car shows, steam railways), tagged kid-friendly.

## Events tab

Hit **Refresh events** and the Worker asks Claude (with web search) to find real, dated family events near Macclesfield and across the UK over the next ~4 months, then upserts them into D1. Star events or add them to your plans (both persist and survive refreshes). Toggle between **list** and **calendar** views and filter by category or area.

## Run it locally

```bash
npm install

# 1. Create the D1 database, then paste the printed database_id into wrangler.jsonc
npx wrangler d1 create dad-hq

# 2. Load the schema into the LOCAL db
npm run db:init

# 3. Add your Anthropic API key for the events refresh (local dev)
echo 'ANTHROPIC_API_KEY = "sk-ant-..."' > .dev.vars

# 4. Run
npm run dev        # http://localhost:8787
```

The API key is separate from any Claude subscription — put a little credit on it. Without it, everything works except the Refresh button (which returns a clear "no key set" message). A refresh is one Claude call with a few web searches — a few pennies — and it's manual, so you only pay when you press it.

## Deploy

```bash
npm run db:init:remote                      # schema into production D1
npx wrangler secret put ANTHROPIC_API_KEY   # one-time: the events API key
npm run deploy                              # publish the Worker + the PWA
```
