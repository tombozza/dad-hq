// AI Updates for Dad HQ: npm test (node --test test/).
// The schema, examples, resolve, handlers and context in public/ai/, checked with the shared
// library's own processReply. The app's real mappers are lifted out of public/index.html, so the
// handlers are tested against the code that runs in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { processReply, checkAppSchema } from '../public/vendor/ai-protocol/protocol.js';
import schema, { examples, ENUMS } from '../public/ai/schema.js';
import { makeAiUpdates, makeHandlers, makeResolve, buildContext, findItem, closeness, sortEvents } from '../public/ai/updates.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../public/ai/guide.md', import.meta.url), 'utf8');

// The app's own mappers, from index.html (uid, oneOf, mapImportedAct/Meal/Craft, normaliseEvent).
const MAP = (() => {
  const a = html.indexOf('const uid = p =>'), b = html.indexOf('// Client-side prompt builders');
  const ev = /function normaliseEvent\(e\) \{[\s\S]*?\n\}\n/.exec(html)[0];
  assert.ok(a > 0 && b > a, 'mappers found in index.html');
  const m = new Function(`${html.slice(a, b)}\n${ev}\nreturn { act: mapImportedAct, meal: mapImportedMeal, craft: mapImportedCraft, event: normaliseEvent };`)();
  return m;
})();

const envelope = (actions, id = '2026-11-12-dad-test') => JSON.stringify({ protocol: 'ai-updates', v: 1, id, apps: { dad_hq: { v: 1, actions } } });
const NOW = new Date('2026-11-12T10:00:00Z');

// A small fake Dad HQ: built-ins, Tom's additions, flags, events and the Add new list.
function fakeApp({ failSave = false } = {}) {
  const st = {
    builtIn: {
      act: [{ id: 'a04', name: 'Lyme Park (National Trust)' }, { id: 'a07', name: 'Tatton Park' }, { id: 'a197', name: 'Laserzone, Stockport' }, { id: 'a300', name: 'Lyme Park Moorland Walk' }],
      meal: [{ id: 'm127', name: 'Fish Finger Sandwiches' }],
      craft: [{ id: 'c12', name: 'Salt Dough Shapes' }],
    },
    custom: { act: [{ id: 'custom-act-1-aaaaa', name: 'Brookside Miniature Railway' }], meal: [], craft: [] },
    flags: { fav: { act: new Set(['a07']), meal: new Set(), craft: new Set() }, wish: { act: new Set(['custom-act-1-aaaaa', 'gone-id']), meal: new Set(), craft: new Set() }, hidden: { act: new Set(), meal: new Set(), craft: new Set() } },
    events: [
      { title: 'Macclesfield Christmas Market', startDate: '2026-12-13', endDate: '2026-12-13' },
      { title: 'Bonfire night', startDate: '2026-11-05', endDate: '2026-11-05' },
      { title: 'Lantern trail', startDate: '2026-11-01', endDate: '2026-11-30' },
      { title: 'Easter egg hunt', startDate: '2027-04-01', endDate: '2027-04-01' },
    ],
    drafts: [{ id: 'draft-1', kind: 'act', name: 'Bents Garden', note: '' }],
    saved: [], jots: [], flagCalls: [],
  };
  const all = type => [...st.builtIn[type], ...st.custom[type]];
  const app = {
    st,
    knownNames: type => new Set((type === 'event' ? st.events.map(e => ({ name: e.title })) : all(type)).map(x => String(x.name).trim().toLowerCase())),
    items: type => all(type).map(x => ({ id: x.id, name: x.name, alt: x.name })),
    customItems: type => st.custom[type],
    flagged: (scope, type) => st.flags[scope][type],
    events: () => st.events,
    drafts: () => st.drafts,
    age: () => 5,
    map: MAP,
    async saveImported(type, items) {
      if (failSave) throw new Error('Couldn’t save (HTTP 500)');
      st.saved.push({ type, items });
      if (type !== 'event') st.custom[type].push(...items);
      return items.length;
    },
    async addDraft(kind, name, note) { if (failSave) throw new Error('offline'); st.jots.push({ kind, name, note }); return 'draft-x'; },
    async setFlag(scope, type, id, on) { if (failSave) throw new Error('locked'); st.flagCalls.push([scope, type, id, on]); },
  };
  return app;
}
const itemFor = action => processReply(envelope([action]), schema).items[0];

// ---------------------------------------------------------------------------------------
// Schema and examples

test('the schema passes the shared check, and every action is strict and documented', () => {
  checkAppSchema(schema);
  assert.equal(schema.app, 'dad_hq');
  assert.equal(schema.v, 1);
  assert.deepEqual(schema.accepts, [1]);
  for (const [type, def] of Object.entries(schema.actions)) {
    assert.equal(def.schema.additionalProperties, false, type);
    assert.equal(def.schema.properties.type.const, type);
    assert.ok(def.schema.description, `${type} has a description`);
    for (const [k, p] of Object.entries(def.schema.properties)) if (k !== 'type') assert.ok(p.description, `${type}.${k} has a description`);
  }
  assert.equal(schema.defs.event.additionalProperties, false);
});

test('every example passes processReply, and every action type has one', () => {
  const seen = new Set();
  for (const ex of examples) {
    assert.ok(ex.title && ex.said && ex.actions.length, ex.title);
    const r = processReply(envelope(ex.actions), schema);
    assert.equal(r.ok, true, ex.title);
    for (const it of r.items) { assert.equal(it.status, 'ready', `${ex.title}: ${it.errors.join('; ')}`); assert.ok(it.text); seen.add(it.type); }
  }
  assert.deepEqual([...seen].sort(), Object.keys(schema.actions).sort());
});

test('bad actions are caught: wrong enum, missing field, extra field, bad date', () => {
  const r = processReply(envelope([
    { type: 'add_place', name: 'X', desc: 'Y', cat: 'park', weather: 'both', region: 'local', dist: 3, price: 0 },
    { type: 'add_craft', name: 'X', desc: 'Y', cat: 'messy', time: 10 },
    { type: 'add_meal', name: 'X', desc: 'Y', cat: 'quick', time: 10, kidRating: 3 },
    { type: 'add_events', events: [{ title: 'X', start_date: '12/12/2026', category: 'fair', region: 'local', location: 'Y' }] },
    { type: 'add_events', events: [{ title: 'X', start_date: '2026-12-12', category: 'fair', region: 'wales', location: 'Y' }] },
    { type: 'delete_place', name: 'X' },
  ]), schema);
  assert.deepEqual(r.items.map(i => i.status), ['invalid', 'invalid', 'invalid', 'invalid', 'invalid', 'unknown']);
  assert.match(r.items[0].errors[0], /cat: should be one of/);
  assert.match(r.items[1].errors[0], /mess: is missing/);
  assert.match(r.items[2].errors[0], /kidRating: isn’t a field/);
  assert.match(r.items[3].errors[0], /should be a date/);
  assert.match(r.items[4].errors[0], /region: should be one of/);
});

test('ENUMS are what index.html’s mappers and lists accept (one source, no drift)', () => {
  const arr = re => JSON.parse(re.exec(html)[1].replace(/'/g, '"'));
  assert.deepEqual(ENUMS.place_cat, arr(/oneOf\(o\.cat, (\['outdoor'[^\]]*\])/));
  assert.deepEqual(ENUMS.weather, arr(/oneOf\(o\.weather, (\[[^\]]*\])/));
  assert.deepEqual(ENUMS.meal_cat, arr(/oneOf\(o\.cat, (\['quick'[^\]]*\])/));
  assert.deepEqual(ENUMS.craft_cat, arr(/oneOf\(o\.cat, (\['painting'[^\]]*\])/));
  assert.deepEqual(ENUMS.craft_mess, arr(/mess: (\[[0-9,]+\])\.includes/));
  const evCats = [...html.slice(html.indexOf('const EVENT_CATS'), html.indexOf('const evCatFor')).matchAll(/key:'([a-z_]+)'/g)].map(m => m[1]);
  assert.deepEqual([...ENUMS.event_category].sort(), evCats.sort());
  const evRegions = Object.keys(new Function(`return ${/const EV_REGION_LABEL = (\{[^}]*\})/.exec(html)[1]}`)());
  assert.deepEqual(ENUMS.event_region, evRegions);
  const chips = html.slice(html.indexOf('const actRegions'), html.indexOf("document.getElementById('act-region-row')"));
  const placeRegions = [...chips.matchAll(/val:'([a-z0-9]+)'/g)].map(m => m[1]).filter(v => !['all', 'local5', 'local10'].includes(v));
  assert.deepEqual([...ENUMS.place_region].sort(), [...placeRegions, 'uk'].sort());
  // and every region the built-in places use is allowed
  for (const [, r] of html.matchAll(/region:"([a-z]+)"/g)) assert.ok(ENUMS.place_region.includes(r), r);
});

test('the guide has the sections the docs build expects', () => {
  const heads = [...guide.matchAll(/^#{1,2} .+$/gm)].map(m => m[0]);
  assert.deepEqual(heads, ['# Dad HQ', '## What it is', '## Context', '## When to use each action', '## Rules', '## Not done here']);
  const lines = guide.split('\n').length;
  assert.ok(lines >= 60 && lines <= 150, `guide is ${lines} lines`);
});

test('the handler keys equal the schema’s action keys', () => {
  assert.deepEqual(Object.keys(makeHandlers(fakeApp())).sort(), Object.keys(schema.actions).sort());
  assert.deepEqual(Object.keys(makeAiUpdates(fakeApp()).handlers).sort(), Object.keys(schema.actions).sort());
});

// ---------------------------------------------------------------------------------------
// resolve

test('resolve: a new add is ready; a name already in the app is flagged with Add anyway', async () => {
  const resolve = makeResolve(fakeApp(), () => NOW);
  const fresh = await resolve(itemFor(examples[0].actions[0]));
  assert.equal(fresh.ok, true);
  assert.match(fresh.text, /Crewe Heritage Centre.*→ Activities/);
  const dup = await resolve(itemFor({ type: 'add_meal', name: 'fish finger sandwiches ', desc: 'x', cat: 'quick', time: 10 }));
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /^Already have “fish finger sandwiches ” in Meals/);
  assert.deepEqual(dup.options, [{ value: 'add', label: 'Add anyway' }]);
  const dupCraft = await resolve(itemFor({ type: 'add_craft', name: 'Salt Dough Shapes', desc: 'x', cat: 'messy', time: 10, mess: 2 }));
  assert.match(dupCraft.reason, /in Crafts/);
  const dupCustom = await resolve(itemFor({ type: 'add_place', name: 'Brookside Miniature Railway', desc: 'x', cat: 'outdoor', weather: 'outdoor', region: 'local', dist: 5, price: 1 }));
  assert.match(dupCustom.reason, /Already have/);
});

test('resolve: events split into new, already saved and already over', async () => {
  const resolve = makeResolve(fakeApp(), () => NOW);
  const ev = (title, start_date, end_date) => ({ title, start_date, ...(end_date ? { end_date } : {}), category: 'seasonal', region: 'local', location: 'Macc' });
  const allNew = await resolve(itemFor({ type: 'add_events', events: [ev('Santa run', '2026-12-06')] }));
  assert.equal(allNew.ok, true);
  const mixed = await resolve(itemFor({ type: 'add_events', events: [ev('Santa run', '2026-12-06'), ev('macclesfield christmas market', '2026-12-13'), ev('Halloween trail', '2026-10-31')] }));
  assert.equal(mixed.ok, false);
  assert.match(mixed.reason, /Already have “macclesfield christmas market”\. “Halloween trail” is already over/);
  assert.deepEqual(mixed.options.map(o => o.value), ['new', 'all']);
  assert.equal(mixed.options[0].label, 'Add only the 1 new one');
  const onlyDup = await resolve(itemFor({ type: 'add_events', events: [ev('Macclesfield Christmas Market', '2026-12-13')] }));
  assert.deepEqual(onlyDup.options, [{ value: 'all', label: 'Add anyway' }]);
  const backwards = await resolve(itemFor({ type: 'add_events', events: [ev('Odd', '2026-12-10', '2026-12-01')] }));
  assert.equal(backwards.ok, false);
  assert.equal(backwards.options, undefined);
  assert.deepEqual(sortEvents(fakeApp(), [ev('A', '2026-11-12')], '2026-11-12').fresh, [0], 'today counts as upcoming');
});

test('resolve: a jot already on the list, or already in the app, is flagged', async () => {
  const resolve = makeResolve(fakeApp(), () => NOW);
  assert.equal((await resolve(itemFor({ type: 'add_jot', kind: 'craft', name: 'Pinecone owls' }))).ok, true);
  const onList = await resolve(itemFor({ type: 'add_jot', kind: 'place', name: 'bents garden' }));
  assert.match(onList.reason, /already on the Add new list/);
  const inApp = await resolve(itemFor({ type: 'add_jot', kind: 'place', name: 'Tatton Park' }));
  assert.match(inApp.reason, /Already have “Tatton Park” in Activities/);
  assert.equal(inApp.options[0].value, 'add');
  // a kind it isn't: no clash
  assert.equal((await resolve(itemFor({ type: 'add_jot', kind: 'meal', name: 'Tatton Park' }))).ok, true);
});

test('resolve set_flag: id first, then exact name, then close names to pick from, never a guess', async () => {
  const app = fakeApp();
  const resolve = makeResolve(app, () => NOW);
  const byId = await resolve(itemFor({ type: 'set_flag', item: 'whatever it was called', item_id: 'a07', flag: 'favourite', on: false }));
  assert.equal(byId.ok, true);
  assert.match(byId.text, /Take the star off: Tatton Park \(Activities\)/);
  const exact = await resolve(itemFor({ type: 'set_flag', kind: 'meal', item: 'fish finger sandwiches', flag: 'favourite' }));
  assert.equal(exact.ok, true);
  assert.match(exact.text, /^Star: Fish Finger Sandwiches \(Meals\)$/);
  const already = await resolve(itemFor({ type: 'set_flag', item: 'Tatton Park', flag: 'favourite' }));
  assert.match(already.text, /it already is/);
  const close = await resolve(itemFor({ type: 'set_flag', kind: 'place', item: 'Lyme Park', flag: 'wishlist' }));
  assert.equal(close.ok, false);
  assert.equal(close.reason, 'Which “Lyme Park”?');
  assert.deepEqual(close.options.map(o => o.value), ['act:a04', 'act:a300']);
  const none = await resolve(itemFor({ type: 'set_flag', kind: 'craft', item: 'Rocket launch', flag: 'hidden' }));
  assert.equal(none.ok, false);
  assert.equal(none.options, undefined);
  assert.match(none.reason, /No craft called “Rocket launch”/);
  // a bad id falls back to the name
  assert.equal(findItem(app, { item: 'Tatton Park', item_id: 'nope' }).match.id, 'a07');
  // kind narrows the search
  assert.ok(findItem(app, { kind: 'meal', item: 'Tatton Park' }).none);
  assert.ok(closeness('Lyme Park', 'Lyme Park (National Trust)') >= 0.8);
});

// ---------------------------------------------------------------------------------------
// handlers, against the fake store and the real mappers

test('add_place / add_meal / add_craft go through the app’s mappers and saveImported', async () => {
  const app = fakeApp();
  const { apply } = makeAiUpdates(app, () => NOW);
  const place = examples[0].actions[0];
  const id = await apply(itemFor(place));
  assert.match(id, /^custom-act-\d+-[a-z0-9]+$/);
  const saved = app.st.saved[0];
  assert.equal(saved.type, 'act');
  assert.deepEqual({ ...saved.items[0], id: 'x' }, { id: 'x', name: 'Crewe Heritage Centre', icon: '🚂', desc: place.desc, cat: 'museum', weather: 'both', region: 'local', dist: 25, price: 1, priceLabel: '£', tags: ['trains', 'railway', 'rainy day'] });
  await apply(itemFor(examples[1].actions[0]));
  await apply(itemFor(examples[1].actions[1]));
  const [meal, craft] = [app.st.saved[1].items[0], app.st.saved[2].items[0]];
  assert.match(meal.id, /^custom-meal-/);
  assert.equal(meal.kidRating, 2);
  assert.deepEqual(meal.ingredients, ['sausages', 'pasta', 'chopped tomatoes', 'cheddar']);
  assert.match(craft.id, /^custom-craft-/);
  assert.equal(craft.cat, 'messy');
  assert.equal(craft.mess, 2);
  // no icon: the mapper's default
  await apply(itemFor({ type: 'add_meal', name: 'Beans on toast', desc: 'Classic.', cat: 'quick', time: 5 }));
  assert.equal(app.st.saved[3].items[0].icon, '🍽️');
  assert.deepEqual(app.st.saved[3].items[0].ingredients, []);
});

test('add_events saves snake_case events, all or only the new ones', async () => {
  const app = fakeApp();
  const { apply } = makeAiUpdates(app, () => NOW);
  const item = itemFor(examples[2].actions[0]);
  const n = await apply(item, 'new'); // the market is already saved
  assert.equal(n, 1);
  const [santa] = app.st.saved[0].items;
  assert.equal(app.st.saved[0].type, 'event');
  assert.deepEqual(santa, { title: 'Santa Special at the Churnet Valley Railway', category: 'seasonal', start_date: '2026-12-05', end_date: '2026-12-24', region: 'peaks', distance_miles: 20, location: 'Cheddleton Station, Leek', price: 'From £18', url: 'https://www.churnetvalleyrailway.co.uk/', description: 'A steam train ride to meet Santa, with a present for each child.', kid_friendly: true });
  assert.equal(await apply(item, 'all'), 2);
  const market = app.st.saved[1].items[1];
  assert.equal(market.end_date, '2026-12-13', 'a one-day event ends on its start date');
  assert.equal(market.kid_friendly, true, 'the app’s default');
  assert.equal(market.distance_miles, 0);
});

test('add_jot and set_flag call the app’s functions with its own codes', async () => {
  const app = fakeApp();
  const { apply } = makeAiUpdates(app, () => NOW);
  await apply(itemFor({ type: 'add_jot', kind: 'event', name: ' Dinosaur show ', note: 'at the Lowry?' }));
  await apply(itemFor({ type: 'add_jot', kind: 'craft', name: 'Pinecone owls' }));
  assert.deepEqual(app.st.jots, [{ kind: 'event', name: 'Dinosaur show', note: 'at the Lowry?' }, { kind: 'craft', name: 'Pinecone owls', note: '' }]);
  await apply(itemFor(examples[4].actions[0]));                       // hide by exact name
  await apply(itemFor(examples[4].actions[1]));                       // un-star by id
  await apply(itemFor({ type: 'set_flag', kind: 'place', item: 'Lyme Park', flag: 'wishlist' }), 'act:a04'); // Tom's pick
  assert.deepEqual(app.st.flagCalls, [['hidden', 'act', 'a197', true], ['fav', 'act', 'a07', false], ['wish', 'act', 'a04', true]]);
  await assert.rejects(apply(itemFor({ type: 'set_flag', kind: 'place', item: 'Lyme Park', flag: 'wishlist' })), /Couldn’t find/);
});

test('a failed save throws, so the sheet reports it', async () => {
  const { apply } = makeAiUpdates(fakeApp({ failSave: true }), () => NOW);
  await assert.rejects(apply(itemFor(examples[0].actions[0])), /HTTP 500/);
  await assert.rejects(apply(itemFor(examples[2].actions[0]), 'all'), /HTTP 500/);
  await assert.rejects(apply(itemFor(examples[3].actions[0])), /offline/);
  await assert.rejects(apply(itemFor(examples[3].actions[1])), /locked/);
});

// ---------------------------------------------------------------------------------------
// context

test('context: home base, age, the allowed values, Tom’s items, flags and the next 60 days of events', () => {
  const { data, note } = buildContext(fakeApp(), NOW);
  assert.deepEqual(Object.keys(data), ['today', 'home_base', 'harry_age', 'allowed', 'added_by_tom', 'favourites', 'wishlist', 'upcoming_events', 'add_new_list']);
  assert.equal(data.today, '2026-11-12');
  assert.equal(data.home_base, 'Macclesfield, Cheshire, England');
  assert.equal(data.harry_age, 5);
  assert.deepEqual(data.allowed.place_region, ENUMS.place_region);
  assert.deepEqual(data.allowed.event_category, ENUMS.event_category);
  assert.deepEqual(data.added_by_tom, { places: [{ id: 'custom-act-1-aaaaa', name: 'Brookside Miniature Railway' }], meals: [], crafts: [] });
  assert.deepEqual(data.favourites.places, [{ id: 'a07', name: 'Tatton Park' }]);
  assert.deepEqual(data.wishlist.places, [{ id: 'custom-act-1-aaaaa', name: 'Brookside Miniature Railway' }], 'unknown ids are dropped');
  assert.deepEqual(data.upcoming_events, [{ title: 'Lantern trail', date: '2026-11-01 to 2026-11-30' }, { title: 'Macclesfield Christmas Market', date: '2026-12-13' }]);
  assert.deepEqual(data.add_new_list, [{ kind: 'place', name: 'Bents Garden' }]);
  assert.match(note, /refer to one by name/);
  // no built-in list
  assert.ok(!JSON.stringify(data).includes('Lyme Park'));
  const size = JSON.stringify(data).length;
  assert.ok(size < 3000, `context is ${size} characters`);
});

test('a context block pasted back is refused, not applied', () => {
  const { context, schema: s } = makeAiUpdates(fakeApp(), () => NOW);
  const text = `AI Updates context\n${JSON.stringify({ protocol: 'ai-updates', kind: 'context', app: 'dad_hq', v: 1, data: context().data })}`;
  assert.match(processReply(text, s).error, /context block/);
});
