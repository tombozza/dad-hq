-- Dad HQ schema — events only (the activity list lives in the static page).
-- id is a deterministic hash of title+start_date so refreshes upsert in place
-- and never clobber the favourite / in_plans flags the user has set.
CREATE TABLE IF NOT EXISTS events (
  id             TEXT PRIMARY KEY,
  title          TEXT NOT NULL,
  category       TEXT,                -- festival | car_show | fair | celebration | market | music | food_drink | sport | comedy | seasonal | family | other
  start_date     TEXT,               -- YYYY-MM-DD
  end_date       TEXT,
  region         TEXT,               -- local | manchester | chester | liverpool | peaks | uk
  distance_miles INTEGER,
  location       TEXT,
  price          TEXT,
  url            TEXT,
  description    TEXT,
  kid_friendly   INTEGER DEFAULT 0,
  source         TEXT DEFAULT 'claude',
  favourite      INTEGER DEFAULT 0,
  in_plans       INTEGER DEFAULT 0,
  refreshed_at   TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_events_start    ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_category ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_region   ON events(region);

-- Single-row progress record for the background events refresh.
CREATE TABLE IF NOT EXISTS refresh_status (
  id         INTEGER PRIMARY KEY,
  state      TEXT,
  message    TEXT,
  count      INTEGER,
  updated_at TEXT
);

-- User-added activity places. Unlike custom meals/crafts (which stay in the
-- browser's localStorage), places live here so they sync across every device.
CREATE TABLE IF NOT EXISTS places (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  icon           TEXT,
  description    TEXT,
  cat            TEXT,               -- outdoor | museum | theme_park | farm | sport | softplay
  subcat         TEXT,               -- optional explicit sub-category override
  weather        TEXT,               -- outdoor | indoor | both
  region         TEXT,
  distance_miles INTEGER,
  price          INTEGER,            -- 0..3
  price_label    TEXT,
  tags           TEXT,               -- JSON array of strings
  created_at     TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_places_created ON places(created_at);

-- User-added meals and crafts. The whole item is stored as a JSON blob (the
-- client owns the shape); we only need it to round-trip and sync across devices.
CREATE TABLE IF NOT EXISTS meals (
  id         TEXT PRIMARY KEY,
  data       TEXT,               -- JSON of the meal object
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS crafts (
  id         TEXT PRIMARY KEY,
  data       TEXT,               -- JSON of the craft object
  created_at TEXT DEFAULT (datetime('now'))
);

-- "Add new" drafts: a place/meal/craft/event the user has jotted down but not
-- researched yet. Same JSON-blob shape: { id, kind, name, note }.
CREATE TABLE IF NOT EXISTS drafts (
  id         TEXT PRIMARY KEY,
  data       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Card edits: overrides for a built-in or custom item's icon / name /
-- description, keyed by that item's id. Applied on top when rendering, so the
-- original data (and any events refresh) is never destroyed.
CREATE TABLE IF NOT EXISTS edits (
  id         TEXT PRIMARY KEY,
  data       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Per-item flags (favourites, wishlist and hidden built-ins) for
-- activities/meals/crafts, so all three sync across devices. Events keep their
-- own favourite/in_plans columns (in_plans doubles as their wishlist flag).
CREATE TABLE IF NOT EXISTS flags (
  scope   TEXT,                  -- 'fav' | 'wish' | 'hidden'
  kind    TEXT,                  -- 'act' | 'meal' | 'craft'
  item_id TEXT,
  PRIMARY KEY (scope, kind, item_id)
);

-- Optional password lock (off by default). One row; src/auth.js also creates it on first save.
CREATE TABLE IF NOT EXISTS app_settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  password_enabled INTEGER DEFAULT 0,
  password_hash    TEXT,               -- pbkdf2$iter$salt$hash, never plain text
  updated_at       TEXT DEFAULT (datetime('now'))
);
