export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS shares (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  note_id TEXT NOT NULL,
  note_name TEXT NOT NULL,
  note_relative_path TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_real_path TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  source_mtime_ms INTEGER NOT NULL,
  y_state BLOB NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_exported_at INTEGER,
  last_exported_hash TEXT,
  dirty INTEGER NOT NULL DEFAULT 0,
  conflict INTEGER NOT NULL DEFAULT 0,
  conflict_copy_path TEXT,
  last_error TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  share_token TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  joined_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  UNIQUE(share_token, connection_id),
  FOREIGN KEY (share_token) REFERENCES shares(token) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_participants_share_token ON participants(share_token);
CREATE INDEX IF NOT EXISTS idx_shares_expires_at ON shares(expires_at);
CREATE INDEX IF NOT EXISTS idx_shares_revoked_at ON shares(revoked_at);
CREATE INDEX IF NOT EXISTS idx_shares_note_id ON shares(note_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
