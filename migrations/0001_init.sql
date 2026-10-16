-- Index des PDF partagés (le contenu, chiffré, est dans KV)
CREATE TABLE IF NOT EXISTS shares (
  id         TEXT PRIMARY KEY,
  admin_hash TEXT NOT NULL,
  meta       TEXT NOT NULL,
  size       INTEGER NOT NULL,
  duration   INTEGER NOT NULL,
  layers     INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shares_expires ON shares (expires_at);

CREATE TABLE IF NOT EXISTS layers (
  share_id   TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  kv_key     TEXT NOT NULL,
  size       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (share_id, seq)
);
