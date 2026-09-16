-- Additive upgrade: keep every existing event. Run after schema.sql on a new database.
ALTER TABLE events ADD COLUMN event_id TEXT;
ALTER TABLE events ADD COLUMN session_id TEXT;
ALTER TABLE events ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX events_event_id_idx ON events (event_id);
