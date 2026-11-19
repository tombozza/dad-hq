// Round 4 (19 Nov 2026): the home town, the child and the AI model are settings, and with nothing
// saved everything reads exactly as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseProfile, cleanProfile, ageOn, homeBase, locationContext, placeRegionLines, eventsFocus, firstChild, isDefaultHome,
} from '../public/lib/profile.js';
import { handleProfile, loadProfile } from '../src/profile.js';
import { defaultModel, retiredModel } from '../src/ai.js';
import { priceFor, costOf, record } from '../src/ai-usage.js';

const OLD_FOCUS = age => `Days out and events suitable for a dad with a ${age}-year-old son (Harry). Family-friendly festivals and fairs, character meet-and-greets, kids' theatre and storytelling, farm and animal events, soft-play and outdoor play events, school-holiday activities, Santa's grottos and seasonal family days, fun runs and family sports days, and family-friendly food/market events. Crossover events the dad would enjoy too — car shows, transport rallies, air shows, steam-railway days — are welcome (mark kid_friendly true). Mark kid_friendly true for anything genuinely suited to a young child; bias the whole list toward things a ${age}-year-old would love.`;

test('nothing saved: Macclesfield, Harry, no birthday, and the prompts word for word as before', () => {
  const p = normaliseProfile(null);
  assert.deepEqual(p, { home: { name: 'Macclesfield', area: 'Cheshire, England', lat: 53.2587, lon: -2.1268, radius: 20 }, children: [{ name: 'Harry', relation: 'son', birthDate: null }] });
  assert.equal(homeBase(null), 'Macclesfield, Cheshire, England');
  assert.equal(isDefaultHome(null), true);
  assert.equal(locationContext(null), null, 'the events engine keeps its own home block');
  assert.equal(eventsFocus(firstChild(null), 5), OLD_FOCUS(5));
  assert.match(placeRegionLines(null), /^Home base is Macclesfield, central Cheshire, England\./);
  assert.match(placeRegionLines(null), /Knutsford, Wilmslow, Macclesfield/);
  assert.deepEqual(normaliseProfile({ junk: 1, home: 'x', children: 'y' }), p, 'unreadable → defaults');
});

test('a moved home and another child change the prompts', () => {
  const p = { home: { name: 'Stockport', area: 'Greater Manchester, England', lat: 53.41, lon: -2.16, radius: 15 }, children: [{ name: 'Amy', relation: 'daughter', birthDate: '2019-03-01' }] };
  assert.equal(homeBase(p), 'Stockport, Greater Manchester, England');
  assert.match(locationContext(p), /Home base is Stockport, Greater Manchester, England\./);
  assert.match(locationContext(p), /"local": within ~15 miles of Stockport/);
  assert.doesNotMatch(locationContext(p) + placeRegionLines(p), /Macclesfield/);
  assert.match(eventsFocus(firstChild(p), 7), /a 7-year-old daughter \(Amy\)/);
  assert.equal(isDefaultHome({ home: { ...p.home, name: 'Macclesfield', area: 'Cheshire, England', radius: 25 } }), false, 'a new radius is a change too');
});

test('age from the birthday moves on by itself', () => {
  assert.equal(ageOn(null), null);
  assert.equal(ageOn('2020-06-15', '2026-06-14'), 5);
  assert.equal(ageOn('2020-06-15', '2026-06-15'), 6);
  assert.equal(ageOn('2020-06-15', '2027-01-01'), 6);
  assert.equal(ageOn('not a date', '2026-01-01'), null);
});

test('a save is checked strictly', () => {
  const ok = cleanProfile({ home: { name: 'Leek', lat: 53.1, lon: -2.02, radius: 10 }, children: [{ name: 'Harry', birthDate: '2020-06-15' }] });
  assert.equal(ok.error, undefined);
  assert.equal(ok.profile.children[0].relation, 'son');
  assert.match(cleanProfile({ home: { name: '' }, children: [{ name: 'H' }] }).error, /home town/);
  assert.match(cleanProfile({ home: { name: 'Leek', radius: 7 }, children: [{ name: 'H' }] }).error, /Local/);
  assert.match(cleanProfile({ home: { name: 'Leek' }, children: [] }).error, /one child/);
  assert.match(cleanProfile({ home: { name: 'Leek' }, children: [{ name: 'H', birthDate: '2999-01-01' }] }).error, /future/);
  assert.match(cleanProfile({ home: { name: 'Leek' }, children: [{ name: 'H', relation: 'cat' }] }).error, /Son, daughter/);
});

// A one-row fake of D1, enough for src/profile.js.
function fakeEnv() {
  const rows = {};
  return {
    rows,
    DB: {
      prepare(sql) {
        let args = [];
        const st = {
          bind: (...a) => { args = a; return st; },
          run: async () => { if (/^INSERT/.test(sql)) rows[1] = { data: args[0], updated_at: 'now' }; return {}; },
          first: async () => rows[1] ?? null,
        };
        return st;
      },
    },
  };
}
const json = (d, status = 200) => new Response(JSON.stringify(d), { status });
const req = (method, body) => new Request('https://x/api/profile', { method, body: body && JSON.stringify(body) });

test('GET /api/profile with nothing saved gives the defaults; PUT saves; a bad PUT is refused', async () => {
  const env = fakeEnv(), url = new URL('https://x/api/profile');
  let d = await (await handleProfile(req('GET'), env, url, json)).json();
  assert.equal(d.saved, false);
  assert.equal(d.profile.home.name, 'Macclesfield');
  const bad = await handleProfile(req('PUT', { home: {}, children: [{ name: 'H' }] }), env, url, json);
  assert.equal(bad.status, 400);
  const good = await handleProfile(req('PUT', { home: { name: 'Leek', lat: 53.1, lon: -2.02, radius: 10 }, children: [{ name: 'Harry', birthDate: '2020-06-15' }] }), env, url, json);
  assert.equal(good.status, 200);
  d = await (await handleProfile(req('GET'), env, url, json)).json();
  assert.equal(d.saved, true);
  assert.equal(d.profile.home.name, 'Leek');
  assert.equal((await loadProfile(env)).children[0].birthDate, '2020-06-15');
  assert.equal(await handleProfile(req('GET'), env, new URL('https://x/api/other'), json), null);
});

test('loadProfile never throws: a broken database reads as the defaults', async () => {
  const env = { DB: { prepare: () => { throw new Error('no D1'); } } };
  assert.equal((await loadProfile(env)).home.name, 'Macclesfield');
});

test('AI model: AI_MODEL wins when it is a claude- name, else Haiku 5.5', () => {
  assert.equal(defaultModel({}), 'claude-haiku-5-5');
  assert.equal(defaultModel({ AI_MODEL: '  claude-haiku-6  ' }), 'claude-haiku-6');
  assert.equal(defaultModel({ AI_MODEL: 'gpt-5' }), 'claude-haiku-5-5');
  assert.equal(defaultModel({ AI_MODEL: '' }), 'claude-haiku-5-5');
});

test('a retired model gets a clear answer naming AI_MODEL; other errors pass through', async () => {
  const r = retiredModel(404, JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: claude-old' } }), 'claude-old');
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.match(body.error.message, /The AI model claude-old isn’t available any more\. Set AI_MODEL in the Cloudflare dashboard \(Workers & Pages › dad-hq › Settings › Variables\)/);
  assert.match(body.error.message, /free route still works/);
  assert.equal(retiredModel(400, '{}', 'x'), null);
  assert.equal(retiredModel(404, 'not json', 'x'), null);
});

test('cost log: an unknown model takes the nearest known price and is marked estimated', () => {
  assert.deepEqual(priceFor('claude-haiku-5-5'), { price: priceFor('claude-haiku-5-5').price, estimated: false });
  assert.equal(priceFor('claude-haiku-4-5-20251001').estimated, false);
  const h6 = priceFor('claude-haiku-6');
  assert.equal(h6.estimated, true);
  assert.equal(h6.price, priceFor('claude-haiku-5-5').price, 'newest listed haiku');
  assert.equal(priceFor('claude-sonnet-9').price, priceFor('claude-sonnet-5-5').price);
  assert.equal(priceFor('claude-mystery').estimated, true);
  assert.ok(costOf('claude-haiku-6', { input_tokens: 1000, output_tokens: 100 }) > 0);
  const l = record(null, { job: 'ideas-meal', model: 'claude-haiku-6', usage: { input_tokens: 10, output_tokens: 10 } });
  assert.equal(l.jobs['ideas-meal'].recent[0].estimated, true);
  const k = record(null, { job: 'ideas-meal', model: 'claude-haiku-5-5', usage: { input_tokens: 10, output_tokens: 10 } });
  assert.equal(k.jobs['ideas-meal'].recent[0].estimated, undefined);
});
