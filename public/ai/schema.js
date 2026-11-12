// AI Updates: Dad HQ's section of the envelope (sites/ai-updates/design/ARCHITECTURE.md §6).
// Plain ES module with no imports, so Node (tests, ai-updates/tools) and the browser both load it.
// The handlers, resolve and context live next to it in ./updates.js; the guide for ChatGPT is
// ./guide.md. Change an action here → update the guide, the tests, and the CHANGELOG in ai-updates/.
//
// ENUMS is the one list of allowed values for the AI Updates path: the schemas below, the context
// ("Copy for ChatGPT") and the guide all take them from here. They are what the app's own mappers
// and data accept (public/index.html: mapImportedAct/Meal/Craft, EVENT_CATS, EV_REGION_LABEL and the
// Activities region chips); test/ai-updates.test.mjs reads index.html and fails if they drift apart.

export const ENUMS = {
  // Activities (places). mapImportedAct falls back to "outdoor" for anything else.
  place_cat: ['outdoor', 'museum', 'theme_park', 'farm', 'sport', 'softplay'],
  weather: ['outdoor', 'indoor', 'both'],
  // The Activities region chips plus "uk" (used by the built-in data and the Get ideas prompt).
  place_region: ['local', 'manchester', 'chester', 'liverpool', 'peaks', 'sheffield', 'yorkshire', 'midlands', 'wales', 'lakes', 'north', 'uk'],
  price: [0, 1, 2, 3],
  meal_cat: ['quick', 'proper', 'weekend', 'baking'],
  // "messy" is accepted by the mapper and used by 27 built-in crafts, though the Fill in the details
  // prompt leaves it out (audit §4.3).
  craft_cat: ['painting', 'building', 'nature', 'messy', 'quiet', 'seasonal', 'science'],
  craft_mess: [1, 2, 3],
  event_category: ['festival', 'car_show', 'fair', 'celebration', 'market', 'music', 'food_drink', 'sport', 'comedy', 'seasonal', 'family', 'other'],
  // The Events tab's regions (EV_REGION_LABEL): fewer than Activities, as in the events engine.
  event_region: ['local', 'manchester', 'chester', 'liverpool', 'peaks', 'uk'],
  // How ChatGPT names the kind of item; the app's own codes are act/meal/craft/event.
  item_kind: ['place', 'meal', 'craft'],
  jot_kind: ['place', 'meal', 'craft', 'event'],
  flag: ['favourite', 'wishlist', 'hidden'],
};

const PRICE_LABEL = ['Free', '£', '££', '£££'];
const MESS_LABEL = ['', 'tidy', 'messy', 'very messy'];
const str = (max, description) => ({ type: 'string', minLength: 1, maxLength: max, description });
const icon = { type: 'string', minLength: 1, maxLength: 8, description: 'One emoji for the card. Left out: a default icon.' };
const strings = (maxItems, description) => ({ type: 'array', maxItems, items: { type: 'string', minLength: 1, maxLength: 60 }, description });

export default {
  app: 'dad_hq',
  name: 'Dad HQ',
  v: 1,
  accepts: [1],
  defs: {
    date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', hint: 'should be a date like 2026-11-14' },
    event: {
      type: 'object',
      required: ['title', 'start_date', 'category', 'region', 'location'],
      additionalProperties: false,
      description: 'One real, dated event.',
      properties: {
        title: str(120, 'The event’s real name.'),
        start_date: { $ref: '#/defs/date', description: 'First day, YYYY-MM-DD. Must be a real, upcoming date.' },
        end_date: { $ref: '#/defs/date', description: 'Last day, YYYY-MM-DD. Left out: a one-day event.' },
        category: { enum: ENUMS.event_category, description: `One of: ${ENUMS.event_category.join(', ')}.` },
        region: { enum: ENUMS.event_region, description: `One of: ${ENUMS.event_region.join(', ')} ("uk" is anywhere further afield).` },
        distance_miles: { type: ['integer', 'null'], minimum: 0, maximum: 800, description: 'Rough one-way driving miles from Macclesfield; null for "uk" or if unknown.' },
        location: str(160, 'Venue and town.'),
        price: { type: 'string', maxLength: 80, description: 'As text, e.g. "Free", "£8 adults, kids free". Left out: blank.' },
        url: { type: 'string', pattern: '^https?://', maxLength: 500, hint: 'should be a web address starting https://', description: 'The event’s own page.' },
        description: { type: 'string', maxLength: 300, description: '1–2 plain sentences for a dad deciding whether to bother.' },
        kid_friendly: { type: 'boolean', description: 'true if it suits a young child. Left out: true.' },
      },
    },
  },
  actions: {
    add_place: {
      title: 'Add a place',
      schema: {
        type: 'object',
        required: ['type', 'name', 'desc', 'cat', 'weather', 'region', 'dist', 'price'],
        additionalProperties: false,
        description: 'Add a new place to Activities (a real, specific, currently open place).',
        properties: {
          type: { const: 'add_place' },
          name: str(80, 'The place’s real name.'),
          icon,
          desc: str(300, '1–2 plain sentences: what it is and why Harry would like it.'),
          cat: { enum: ENUMS.place_cat, description: `One of: ${ENUMS.place_cat.join(', ')}.` },
          weather: { enum: ENUMS.weather, description: 'outdoor (needs dry weather), indoor (good on a rainy day) or both.' },
          region: { enum: ENUMS.place_region, description: `One of: ${ENUMS.place_region.join(', ')}.` },
          dist: { type: 'integer', minimum: 0, maximum: 800, description: 'Rough one-way driving miles from Macclesfield.' },
          price: { enum: ENUMS.price, description: 'Per person: 0 free, 1 £, 2 ££, 3 £££.' },
          tags: strings(10, 'Short search words, e.g. ["trains", "café", "pushchair ok"]. Up to 10.'),
        },
      },
      describe: a => `${a.icon ?? '📌'} ${a.name} · ${a.region}, ${a.dist} mi · ${PRICE_LABEL[a.price]}`,
    },
    add_meal: {
      title: 'Add a meal',
      schema: {
        type: 'object',
        required: ['type', 'name', 'desc', 'cat', 'time'],
        additionalProperties: false,
        description: 'Add a new meal to Meals: realistic, kid-friendly home cooking.',
        properties: {
          type: { const: 'add_meal' },
          name: str(80, 'The meal’s name.'),
          icon,
          desc: str(300, '1–2 plain sentences.'),
          cat: { enum: ENUMS.meal_cat, description: 'quick (under ~20 min), proper (a weeknight dinner), weekend (a bigger cook) or baking.' },
          time: { type: 'integer', minimum: 1, maximum: 600, description: 'Total prep and cook time in minutes.' },
          ingredients: strings(30, 'Ingredient names, e.g. ["pasta", "cheddar"].'),
        },
      },
      describe: a => `${a.icon ?? '🍽️'} ${a.name} · ${a.cat}, ${a.time} min`,
    },
    add_craft: {
      title: 'Add a craft',
      schema: {
        type: 'object',
        required: ['type', 'name', 'desc', 'cat', 'time', 'mess'],
        additionalProperties: false,
        description: 'Add a new craft or making activity to Crafts, with cheap household materials.',
        properties: {
          type: { const: 'add_craft' },
          name: str(80, 'The craft’s name.'),
          icon,
          desc: str(300, '1–2 plain sentences.'),
          cat: { enum: ENUMS.craft_cat, description: `One of: ${ENUMS.craft_cat.join(', ')}.` },
          time: { type: 'integer', minimum: 1, maximum: 600, description: 'Rough time in minutes.' },
          mess: { enum: ENUMS.craft_mess, description: '1 tidy, 2 messy, 3 very messy.' },
          materials: strings(30, 'What you need, e.g. ["paper plates", "paint"].'),
        },
      },
      describe: a => `${a.icon ?? '✂️'} ${a.name} · ${a.cat}, ${a.time} min, ${MESS_LABEL[a.mess]}`,
    },
    add_events: {
      title: 'Add events',
      schema: {
        type: 'object',
        required: ['type', 'events'],
        additionalProperties: false,
        description: 'Add real, dated events to the Events tab. The same title and start date as a saved event updates it.',
        properties: {
          type: { const: 'add_events' },
          events: { type: 'array', minItems: 1, maxItems: 30, items: { $ref: '#/defs/event' }, description: 'Up to 30 events.' },
        },
      },
      describe: a => a.events.length === 1
        ? `${a.events[0].title} · ${a.events[0].start_date}`
        : `${a.events.length} events: ${a.events.slice(0, 3).map(e => e.title).join(', ')}${a.events.length > 3 ? '…' : ''}`,
    },
    add_jot: {
      title: 'Jot on the Add new list',
      schema: {
        type: 'object',
        required: ['type', 'kind', 'name'],
        additionalProperties: false,
        description: 'Put something on the Add new list, to look up later with Fill in the details.',
        properties: {
          type: { const: 'add_jot' },
          kind: { enum: ENUMS.jot_kind, description: 'place, meal, craft or event.' },
          name: str(80, 'What it is, as Tom said it.'),
          note: { type: 'string', maxLength: 200, description: 'A hint for the look-up, e.g. "near Glazebury, do the dinosaur trail". Left out: none.' },
        },
      },
      describe: a => `${a.kind}: ${a.name}${a.note ? ` (${a.note})` : ''}`,
    },
    set_flag: {
      title: 'Favourite, wishlist or hide',
      schema: {
        type: 'object',
        required: ['type', 'item', 'flag'],
        additionalProperties: false,
        description: 'Star (favourite), bookmark (wishlist) or hide a place, meal or craft. Built-in or added.',
        properties: {
          type: { const: 'set_flag' },
          kind: { enum: ENUMS.item_kind, description: 'place, meal or craft. Left out: the app looks in all three.' },
          item: str(120, 'The item’s name as Tom or the context says it.'),
          item_id: { type: 'string', minLength: 1, maxLength: 80, description: 'The id from the context, when it gave one. Never made up.' },
          flag: { enum: ENUMS.flag, description: 'favourite (the star), wishlist (the bookmark) or hidden (removed from the lists).' },
          on: { type: 'boolean', description: 'false to take the flag off. Left out: true.' },
        },
      },
      describe: a => `${a.on === false ? 'Remove' : 'Set'} ${a.flag}: ${a.item}${a.kind ? ` (${a.kind})` : ''}`,
    },
  },
};

export const examples = [
  {
    title: 'A rainy-day place and a wishlist bookmark',
    said: 'Add the Crewe Heritage Centre for a rainy day, Harry loves trains. And bookmark Lyme Park for the summer.',
    actions: [
      { type: 'add_place', name: 'Crewe Heritage Centre', icon: '🚂', desc: 'Railway museum by the Crewe tracks with signal boxes to play in, a miniature railway and big locomotives up close.', cat: 'museum', weather: 'both', region: 'local', dist: 25, price: 1, tags: ['trains', 'railway', 'rainy day'] },
      { type: 'set_flag', kind: 'place', item: 'Lyme Park', flag: 'wishlist' },
    ],
  },
  {
    title: 'Tea and a craft for the weekend',
    said: 'Harry loved the sausage pasta bake, save it. And add a salt dough craft for Sunday.',
    actions: [
      { type: 'add_meal', name: 'Sausage pasta bake', icon: '🍝', desc: 'Chopped sausages, tomato sauce and pasta baked under cheese. Freezes well.', cat: 'proper', time: 45, ingredients: ['sausages', 'pasta', 'chopped tomatoes', 'cheddar'] },
      { type: 'add_craft', name: 'Salt dough handprints', icon: '🖐️', desc: 'Mix flour, salt and water, press a handprint, bake low and paint it the next day.', cat: 'messy', time: 40, mess: 2, materials: ['flour', 'salt', 'water', 'paint'] },
    ],
  },
  {
    title: 'Two December events',
    said: 'Put the Santa Special and the Christmas market on Events.',
    actions: [
      { type: 'add_events', events: [
        { title: 'Santa Special at the Churnet Valley Railway', start_date: '2026-12-05', end_date: '2026-12-24', category: 'seasonal', region: 'peaks', distance_miles: 20, location: 'Cheddleton Station, Leek', price: 'From £18', url: 'https://www.churnetvalleyrailway.co.uk/', description: 'A steam train ride to meet Santa, with a present for each child.', kid_friendly: true },
        { title: 'Macclesfield Christmas Market', start_date: '2026-12-13', category: 'market', region: 'local', distance_miles: 0, location: 'Macclesfield town centre', price: 'Free' },
      ] },
    ],
  },
  {
    title: 'Jot something to look up, and favourite a meal',
    said: 'Remind me to look up that dinosaur place near Glazebury. And star the fish finger sandwiches.',
    actions: [
      { type: 'add_jot', kind: 'place', name: 'Bents Garden dinosaur trail', note: 'near Glazebury' },
      { type: 'set_flag', kind: 'meal', item: 'Fish finger sandwiches', flag: 'favourite' },
    ],
  },
  {
    title: 'Hide one and un-star another',
    said: 'Hide Laserzone in Stockport, he is too young for it. And take the star off Tatton Park.',
    actions: [
      { type: 'set_flag', kind: 'place', item: 'Laserzone, Stockport', flag: 'hidden' },
      { type: 'set_flag', kind: 'place', item: 'Tatton Park', item_id: 'a07', flag: 'favourite', on: false },
    ],
  },
];
