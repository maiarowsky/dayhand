-- The Dayhand Cloud waitlist: one row per address, kept apart from every other list.
CREATE TABLE waitlist (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source TEXT NOT NULL
);

-- Attempts per client address in the current time window, so one address cannot flood the list. The address is
-- stored as a SHA-256 hash, and rows from earlier windows are deleted on the next attempt.
CREATE TABLE waitlist_rate (
  ip_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
