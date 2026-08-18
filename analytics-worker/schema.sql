CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event TEXT NOT NULL,
  path TEXT NOT NULL,
  target TEXT,
  referrer_domain TEXT,
  ip TEXT,
  visitor_hash TEXT NOT NULL,
  country TEXT,
  region TEXT,
  region_code TEXT,
  city TEXT,
  postal_code TEXT,
  latitude REAL,
  longitude REAL,
  timezone TEXT,
  asn INTEGER,
  as_organization TEXT
);

CREATE INDEX IF NOT EXISTS events_occurred_at_idx
ON events (occurred_at);

CREATE INDEX IF NOT EXISTS events_visitor_hash_idx
ON events (visitor_hash);
