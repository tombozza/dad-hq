// Who and where Dad HQ is for (Round 4, 19 Nov 2026): the home town and the child, synced through D1
// (table dh_profile, src/profile.js) so every device has the same. Before this they were written into
// the code (Macclesfield in the prompts and the web search, Harry's age saved per device and stuck at 5).
//
// Pure ES module, no DOM, no fetch: the Worker (src/profile.js, src/index.js, src/ai.js), the page
// (index.html, through window.DHP) and the tests all import it. Today's values are the defaults, so
// nothing changes until Tom edits Settings: with the default profile every prompt reads word for word
// as it did before.

export const DEFAULT_HOME = Object.freeze({ name: 'Macclesfield', area: 'Cheshire, England', lat: 53.2587, lon: -2.1268, radius: 20 });
export const DEFAULT_CHILD = Object.freeze({ name: 'Harry', relation: 'son', birthDate: null });
/** The age used while no birth date is set (and no age was picked on the device): today's default. */
export const DEFAULT_AGE = 5;
export const RELATIONS = ['son', 'daughter', 'child'];
/** "Local means within …" choices, in miles. */
export const RADII = [5, 10, 15, 20, 25, 30, 40, 50];
const MAX_CHILDREN = 6;

const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z'));

function home(h) {
  h = h && typeof h === 'object' ? h : {};
  const name = str(h.name, 60);
  if (!name) return { ...DEFAULT_HOME };
  const lat = num(h.lat, -90, 90), lon = num(h.lon, -180, 180);
  return {
    name,
    area: str(h.area, 80),
    // No coordinates for a new town: distances stay as stored until it's found on the map.
    lat: lat ?? (name === DEFAULT_HOME.name ? DEFAULT_HOME.lat : null),
    lon: lon ?? (name === DEFAULT_HOME.name ? DEFAULT_HOME.lon : null),
    radius: RADII.includes(Number(h.radius)) ? Number(h.radius) : DEFAULT_HOME.radius,
  };
}

function child(c) {
  c = c && typeof c === 'object' ? c : {};
  return {
    name: str(c.name, 40) || DEFAULT_CHILD.name,
    relation: RELATIONS.includes(c.relation) ? c.relation : DEFAULT_CHILD.relation,
    birthDate: isDate(c.birthDate) ? c.birthDate : null,
  };
}

/** Any stored value (or null) → a full profile; anything missing or unreadable is today's default. */
export function normaliseProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  const kids = Array.isArray(p.children) && p.children.length ? p.children.slice(0, MAX_CHILDREN).map(child) : [child(null)];
  return { home: home(p.home), children: kids };
}

/** A PUT body → { profile } or { error } (strict: a bad field is refused, not quietly defaulted). */
export function cleanProfile(b) {
  if (!b || typeof b !== 'object') return { error: 'Send JSON like {"home": {...}, "children": [...]}' };
  const h = b.home || {};
  if (!str(h.name, 60)) return { error: 'Give the home town a name.' };
  if (h.lat != null && num(h.lat, -90, 90) == null) return { error: 'That latitude isn’t right.' };
  if (h.lon != null && num(h.lon, -180, 180) == null) return { error: 'That longitude isn’t right.' };
  if (h.radius != null && !RADII.includes(Number(h.radius))) return { error: `“Local” is one of ${RADII.join(', ')} miles.` };
  const kids = Array.isArray(b.children) ? b.children : [];
  if (!kids.length || kids.length > MAX_CHILDREN) return { error: 'Send one child (up to six).' };
  for (const c of kids) {
    if (!str(c && c.name, 40)) return { error: 'Give the child a name.' };
    if (c.relation != null && !RELATIONS.includes(c.relation)) return { error: `Son, daughter or child.` };
    if (c.birthDate != null && c.birthDate !== '' && !isDate(c.birthDate)) return { error: 'The birthday is a date (YYYY-MM-DD).' };
    if (isDate(c.birthDate) && c.birthDate > new Date().toISOString().slice(0, 10)) return { error: 'The birthday can’t be in the future.' };
  }
  return { profile: normaliseProfile(b) };
}

/** Whole years old on `today` (a Date or YYYY-MM-DD), or null with no birth date. */
export function ageOn(birthDate, today = new Date()) {
  if (!isDate(birthDate)) return null;
  const t = typeof today === 'string' ? today : localISO(today);
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = t.split('-').map(Number);
  let age = ty - by;
  if (tm < bm || (tm === bm && td < bd)) age -= 1;
  return Math.max(0, age);
}
const localISO = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The child shown (Dad HQ keeps a list, and shows the first). */
export const firstChild = p => normaliseProfile(p).children[0];

/** "son" / "daughter" / "child", for the prompts. */
export const kidWord = c => (c && RELATIONS.includes(c.relation) ? c.relation : DEFAULT_CHILD.relation);

/** "Macclesfield, Cheshire, England". */
export const homeBase = p => { const h = normaliseProfile(p).home; return [h.name, h.area].filter(Boolean).join(', '); };

/** True while the home is still Macclesfield with "local" at 20 miles: the prompts then read as before. */
export function isDefaultHome(p) {
  const h = normaliseProfile(p).home;
  return h.name === DEFAULT_HOME.name && h.area === DEFAULT_HOME.area && h.radius === DEFAULT_HOME.radius;
}

/** The events engine's home block for a moved home, or null to keep the engine's own (Macclesfield) one. */
export function locationContext(p) {
  if (isDefaultHome(p)) return null;
  const h = normaliseProfile(p).home;
  return `Home base is ${homeBase(p)}. Use these approximate driving distances when tagging the "region" and "distance_miles" fields:
- "local": within ~${h.radius} miles of ${h.name}
- "manchester": Greater Manchester
- "peaks": Peak District & Derbyshire
- "chester": Chester & Cheshire west / Ellesmere Port
- "liverpool": Liverpool & Merseyside
- "uk": anywhere else in the UK worth travelling for (set distance_miles to null)
"distance_miles" is the rough one-way driving distance from ${h.name}.`;
}

/** The home and region lines of the Get ideas (places) prompt. */
export function placeRegionLines(p) {
  if (isDefaultHome(p)) {
    return `Home base is Macclesfield, central Cheshire, England. Tag each place with a region and rough one-way driving distance in miles:
- "local": within ~20 miles (Knutsford, Wilmslow, Macclesfield, Northwich, Altrincham, Stockport)
- "manchester": Greater Manchester (~20mi)
- "peaks": Peak District & Derbyshire (~20-30mi)
- "chester": Chester & west Cheshire / Ellesmere Port (~33mi)
- "liverpool": Liverpool & Merseyside (~40mi)
- "wales" (North Wales), "lakes" (Lake District), "yorkshire", "midlands", or "uk" for anywhere else worth the trip`;
  }
  const h = normaliseProfile(p).home;
  return `Home base is ${homeBase(p)}. Tag each place with a region and rough one-way driving distance in miles from ${h.name}:
- "local": within ~${h.radius} miles of ${h.name}
- "manchester": Greater Manchester
- "peaks": Peak District & Derbyshire
- "chester": Chester & west Cheshire / Ellesmere Port
- "liverpool": Liverpool & Merseyside
- "wales" (North Wales), "lakes" (Lake District), "yorkshire", "midlands", or "uk" for anywhere else worth the trip`;
}

/** The events search persona's focus line (src/index.js). Default profile → today's words. */
export function eventsFocus(c, age) {
  const who = `${age}-year-old ${kidWord(c)} (${c.name})`;
  return `Days out and events suitable for a dad with a ${who}. Family-friendly festivals and fairs, character meet-and-greets, kids' theatre and storytelling, farm and animal events, soft-play and outdoor play events, school-holiday activities, Santa's grottos and seasonal family days, fun runs and family sports days, and family-friendly food/market events. Crossover events the dad would enjoy too — car shows, transport rallies, air shows, steam-railway days — are welcome (mark kid_friendly true). Mark kid_friendly true for anything genuinely suited to a young child; bias the whole list toward things a ${age}-year-old would love.`;
}
