// AI Updates for Dad HQ: resolve (names → the app's own records), the handlers (each action →
// the app's own save functions), and the "Copy for ChatGPT" context. Pure: no DOM, no fetch.
// Everything that touches the app comes in through `app`, which public/index.html builds from its
// own functions (openAiUpdates there); test/ai-updates.test.mjs passes a fake one.
//
// The `app` adapter:
//   knownNames(type)            Set of lower-cased names already in the app (index.html's knownNames)
//   items(type)                 [{id, name, alt?}] built-in + custom, for type act|meal|craft (name = as shown, alt = original)
//   customItems(type)           [{id, name}] the items Tom added, for act|meal|craft
//   flagged(scope, type)        array/Set of ids with that flag (scope fav|wish|hidden)
//   events()                    the saved events, as served ({title, startDate, endDate})
//   drafts()                    the Add new list ([{kind, name, note}])
//   age()                       Harry's age setting
//   map: {act, meal, craft, event}   the app's own mappers (mapImportedAct… and normaliseEvent)
//   saveImported(type, items)   the app's save for mapped items; must throw if the save fails
//   addDraft(kind, name, note)  add to the Add new list; must throw if the save fails
//   setFlag(scope, type, id, on)  set or clear one flag; must throw if the save fails

import schema, { ENUMS } from './schema.js';

export { schema, ENUMS };

// ChatGPT's words for a kind ↔ the app's codes.
export const KIND = { place: 'act', meal: 'meal', craft: 'craft', event: 'event' };
export const KIND_NAME = { act: 'place', meal: 'meal', craft: 'craft', event: 'event' };
const TAB_NAME = { act: 'Activities', meal: 'Meals', craft: 'Crafts', event: 'Events' };
const FLAG_SCOPE = { favourite: 'fav', wishlist: 'wish', hidden: 'hidden' };
const FLAG_WORDS = {
  favourite: ['Star', 'Take the star off'],
  wishlist: ['Add to the wishlist', 'Take off the wishlist'],
  hidden: ['Hide', 'Show again'],
};

// The home base the app's own prompts use (buildDraftPrompt, buildEditPrompt, the paid search's
// user_location). The shared events engine says "central Cheshire" instead (audit §4.4).
export const HOME_BASE = 'Macclesfield, Cheshire, England';

export const lower = x => String(x ?? '').trim().toLowerCase();
/** Looser form for close matches: no accents, punctuation, "the"/"a", or "(National Trust)"-style asides. */
export const loose = x => lower(x).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\([^)]*\)/g, ' ').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();

/** How close two names are, 0..1 (1 = the same once loosened). */
export function closeness(a, b) {
  const x = loose(a), y = loose(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if ((x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y))) return 0.8;
  const tx = new Set(x.split(' ')), ty = new Set(y.split(' '));
  const shared = [...tx].filter(t => ty.has(t) && t.length > 2).length;
  return shared / Math.max(tx.size, ty.size);
}

const pickLabel = (type, it) => `${it.name} · ${KIND_NAME[type]}`;

/**
 * Find the item a set_flag names: the id first, then an exact name, then close names.
 * @returns {{match:{type,id,name}} | {options:{type,id,name}[]} | {none:true}}
 */
export function findItem(app, { kind, item, item_id }) {
  const types = kind ? [KIND[kind]] : ['act', 'meal', 'craft'];
  const all = types.flatMap(type => app.items(type).map(it => ({ type, id: String(it.id), name: it.name, alt: it.alt })));
  if (item_id) {
    const byId = all.filter(it => it.id === String(item_id));
    if (byId.length === 1) return { match: byId[0] };
  }
  const want = lower(item);
  const exact = all.filter(it => lower(it.name) === want || (it.alt && lower(it.alt) === want));
  if (exact.length === 1) return { match: exact[0] };
  if (exact.length > 1) return { options: exact };
  const close = all.map(it => ({ it, s: Math.max(closeness(item, it.name), it.alt ? closeness(item, it.alt) : 0) }))
    .filter(x => x.s >= 0.6) // "Lyme Park" vs "Tatton Park" (one shared word of two) isn't close
    .sort((p, q) => q.s - p.s).slice(0, 6).map(x => x.it);
  return close.length ? { options: close } : { none: true };
}

// ---------------------------------------------------------------------------------------
// Action → the input the app's mappers already take (the shape the Get ideas jobs produce)

export const placeInput = a => ({ name: a.name, icon: a.icon, desc: a.desc, cat: a.cat, weather: a.weather, region: a.region, dist: a.dist, price: a.price, tags: a.tags });
export const mealInput = a => ({ name: a.name, icon: a.icon, desc: a.desc, cat: a.cat, time: a.time, ingredients: a.ingredients });
export const craftInput = a => ({ name: a.name, icon: a.icon, desc: a.desc, cat: a.cat, time: a.time, mess: a.mess, materials: a.materials });
/** An event as Find events returns it (snake_case, which is what POST /api/events/manual reads). */
export const eventInput = e => {
  const out = { title: e.title, start_date: e.start_date, category: e.category, region: e.region, location: e.location };
  for (const k of ['end_date', 'distance_miles', 'price', 'url', 'description', 'kid_friendly']) if (e[k] !== undefined) out[k] = e[k];
  return out;
};

const ADD = { add_place: ['act', placeInput], add_meal: ['meal', mealInput], add_craft: ['craft', craftInput] };

// ---------------------------------------------------------------------------------------
// Dates (UK time)

export const ukDate = (now = new Date()) => now.toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
export const addDays = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Split an add_events list into new, already-saved (same title) and already-over events. */
export function sortEvents(app, events, today) {
  const known = app.knownNames('event');
  const out = { fresh: [], dup: [], past: [], backwards: [] };
  events.forEach((e, i) => {
    if (e.end_date && e.end_date < e.start_date) out.backwards.push(i);
    else if ((e.end_date || e.start_date) < today) out.past.push(i);
    else if (known.has(lower(e.title))) out.dup.push(i);
    else out.fresh.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------------------
// resolve: what the preview shows, and whether the row starts ticked

export function makeResolve(app, now = () => new Date()) {
  return async function resolve(item) {
    const a = item.action;
    if (ADD[a.type]) {
      const [type] = ADD[a.type];
      if (app.knownNames(type).has(lower(a.name))) {
        return { ok: false, reason: `Already have “${a.name}” in ${TAB_NAME[type]}`, options: [{ value: 'add', label: 'Add anyway' }] };
      }
      return { ok: true, text: `${item.text} → ${TAB_NAME[type]}` };
    }
    if (a.type === 'add_events') {
      const s = sortEvents(app, a.events, ukDate(now()));
      if (s.backwards.length) {
        return { ok: false, reason: `“${a.events[s.backwards[0]].title}” ends before it starts. Ask ChatGPT to fix the dates.` };
      }
      if (!s.dup.length && !s.past.length) return { ok: true, text: `${item.text} → Events` };
      const said = [
        s.dup.length ? `Already have ${s.dup.map(i => `“${a.events[i].title}”`).join(', ')}` : '',
        s.past.length ? `${s.past.map(i => `“${a.events[i].title}”`).join(', ')} ${s.past.length === 1 ? 'is' : 'are'} already over` : '',
      ].filter(Boolean).join('. ');
      const options = [];
      if (s.fresh.length) options.push({ value: 'new', label: `Add only the ${s.fresh.length} new one${s.fresh.length === 1 ? '' : 's'}` });
      options.push({ value: 'all', label: a.events.length === 1 ? 'Add anyway' : `Add all ${a.events.length} anyway` });
      return { ok: false, reason: said, options };
    }
    if (a.type === 'add_jot') {
      const type = KIND[a.kind];
      if (app.drafts().some(d => d.kind === type && lower(d.name) === lower(a.name))) {
        return { ok: false, reason: `“${a.name}” is already on the Add new list`, options: [{ value: 'add', label: 'Add anyway' }] };
      }
      if (app.knownNames(type).has(lower(a.name))) {
        return { ok: false, reason: `Already have “${a.name}” in ${TAB_NAME[type]}`, options: [{ value: 'add', label: 'Jot it anyway' }] };
      }
      return { ok: true, text: `${item.text} → the Add new list` };
    }
    if (a.type === 'set_flag') {
      const on = a.on !== false;
      const words = FLAG_WORDS[a.flag][on ? 0 : 1];
      const f = findItem(app, a);
      if (f.match) {
        const already = new Set(app.flagged(FLAG_SCOPE[a.flag], f.match.type)).has(f.match.id) === on;
        return { ok: true, text: `${words}: ${f.match.name} (${TAB_NAME[f.match.type]})${already ? ' — it already is' : ''}` };
      }
      const what = a.kind ?? 'place, meal or craft';
      if (f.none) return { ok: false, reason: `No ${what} called “${a.item}” in Dad HQ` };
      return { ok: false, reason: `Which “${a.item}”?`, options: f.options.map(it => ({ value: `${it.type}:${it.id}`, label: pickLabel(it.type, it) })) };
    }
    return { ok: false, reason: 'Not something this app does' };
  };
}

// ---------------------------------------------------------------------------------------
// handlers: one per action type, calling the app's own functions. They throw on failure.

export function makeHandlers(app, now = () => new Date()) {
  const addOne = type => async a => {
    const [, input] = ADD[a.type];
    const it = app.map[type](input(a));
    if (!it) throw new Error('That item has no name.');
    await app.saveImported(type, [it]);
    return it.id;
  };
  return {
    add_place: addOne('act'),
    add_meal: addOne('meal'),
    add_craft: addOne('craft'),
    async add_events(a, choice) {
      let list = a.events;
      if (choice === 'new') { const s = sortEvents(app, a.events, ukDate(now())); list = s.fresh.map(i => a.events[i]); }
      const items = list.map(e => app.map.event(eventInput(e))).filter(Boolean);
      if (!items.length) throw new Error('No events left to add.');
      return app.saveImported('event', items);
    },
    async add_jot(a) {
      return app.addDraft(KIND[a.kind], a.name.trim(), (a.note ?? '').trim());
    },
    async set_flag(a, choice) {
      let target;
      if (choice) {
        const at = String(choice).indexOf(':');
        target = { type: choice.slice(0, at), id: choice.slice(at + 1) };
      } else {
        const f = findItem(app, a);
        if (!f.match) throw new Error(`Couldn’t find “${a.item}”.`);
        target = f.match;
      }
      if (!['act', 'meal', 'craft'].includes(target.type)) throw new Error('Not a place, meal or craft.');
      await app.setFlag(FLAG_SCOPE[a.flag], target.type, target.id, a.on !== false);
      return target.id;
    },
  };
}

/** The sheet's apply: the handler for the item's type, with Tom's choice from the preview. */
export const makeApply = handlers => (item, choice) => {
  const h = handlers[item.type];
  if (!h) throw new Error(`“${item.type}” isn’t something Dad HQ does`);
  return h(item.action, choice);
};

// ---------------------------------------------------------------------------------------
// context: the "Copy for ChatGPT" data (ids plus names, never the whole database)

export function buildContext(app, now = new Date()) {
  const today = ukDate(now);
  const until = addDays(today, 60);
  const named = type => {
    const byId = new Map(app.items(type).map(it => [String(it.id), it.name]));
    return scope => [...app.flagged(scope, type)].map(String).filter(id => byId.has(id)).map(id => ({ id, name: byId.get(id) }));
  };
  const per = fn => ({ places: fn('act'), meals: fn('meal'), crafts: fn('craft') });
  const upcoming = app.events()
    .filter(e => e.startDate && (e.endDate || e.startDate) >= today && e.startDate <= until)
    .sort((x, y) => x.startDate.localeCompare(y.startDate))
    .map(e => ({ title: e.title, date: e.endDate && e.endDate !== e.startDate ? `${e.startDate} to ${e.endDate}` : e.startDate }));
  return {
    data: {
      today,
      home_base: HOME_BASE,
      harry_age: app.age(),
      allowed: {
        place_cat: ENUMS.place_cat, weather: ENUMS.weather, place_region: ENUMS.place_region,
        price: '0 free, 1 £, 2 ££, 3 £££ (per person)',
        meal_cat: ENUMS.meal_cat, craft_cat: ENUMS.craft_cat, craft_mess: '1 tidy, 2 messy, 3 very messy',
        event_category: ENUMS.event_category, event_region: ENUMS.event_region,
      },
      added_by_tom: per(type => app.customItems(type).map(it => ({ id: String(it.id), name: it.name }))),
      favourites: per(type => named(type)('fav')),
      wishlist: per(type => named(type)('wish')),
      upcoming_events: upcoming,
      add_new_list: app.drafts().map(d => ({ kind: KIND_NAME[d.kind] ?? d.kind, name: d.name })),
    },
    note: 'The hundreds of built-in places, meals and crafts aren’t listed: refer to one by name and Dad HQ will match it.',
  };
}

/** Everything the sheet needs, from the app's adapter. */
export function makeAiUpdates(app, now = () => new Date()) {
  const handlers = makeHandlers(app, now);
  return { schema, handlers, resolve: makeResolve(app, now), apply: makeApply(handlers), context: () => buildContext(app, now()) };
}
