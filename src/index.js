// Dad HQ — Cloudflare Worker. Serves the existing single-file PWA as a static
// asset and adds the events API (kid & family-friendly events near home).

import { handleEvents } from './events.js';
import { handlePlaces } from './places.js';
import { handleSync } from './sync.js';

// What kind of events Dad HQ pulls in — days out with a young child.
// `focus` is a function of the child's age so the prompt can be tuned from the
// app (the age comes in on the /api/events/prompt query string).
const EVENTS_PERSONA = {
  site: 'Dad HQ',
  childName: 'Harry',
  defaultAge: 5,
  focus(age) {
    return `Days out and events suitable for a dad with a ${age}-year-old son (Harry). Family-friendly festivals and fairs, character meet-and-greets, kids' theatre and storytelling, farm and animal events, soft-play and outdoor play events, school-holiday activities, Santa's grottos and seasonal family days, fun runs and family sports days, and family-friendly food/market events. Crossover events the dad would enjoy too — car shows, transport rallies, air shows, steam-railway days — are welcome (mark kid_friendly true). Mark kid_friendly true for anything genuinely suited to a young child; bias the whole list toward things a ${age}-year-old would love.`;
  },
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type',
        },
      });
    }

    try {
      // ---- Events (kid/family-friendly) ----
      const ev = await handleEvents(request, env, ctx, url, EVENTS_PERSONA);
      if (ev) return ev;

      // ---- Custom places (user-added, cross-device) ----
      const pl = await handlePlaces(request, env, ctx, url);
      if (pl) return pl;

      // ---- Meals, crafts, favourites & hidden flags (cross-device) ----
      const sy = await handleSync(request, env, ctx, url);
      if (sy) return sy;

      // ---- Static assets (the PWA) ----
      return env.ASSETS.fetch(request);
    } catch (err) {
      return json({ error: String((err && err.message) || err) }, 500);
    }
  },
};
