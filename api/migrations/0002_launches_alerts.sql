-- Pons launches found on chain by the collector (GET /v1/markets).
CREATE TABLE IF NOT EXISTS launches (
  token       TEXT PRIMARY KEY,   -- lowercase 0x address
  pool        TEXT NOT NULL,
  creator     TEXT NOT NULL,
  block       INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,   -- unix ms, the block time
  symbol      TEXT,
  name        TEXT,
  seen_at     INTEGER NOT NULL    -- unix ms of the collector run that stored it
);
CREATE INDEX IF NOT EXISTS launches_created ON launches (created_at);
CREATE INDEX IF NOT EXISTS launches_symbol ON launches (symbol);

-- Webhook alerts on a token's numbers, checked each time the collector stores a snapshot.
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,   -- al_ + 32 hex, the only key to the alert
  symbol      TEXT NOT NULL,
  metric      TEXT NOT NULL,      -- token_price | dex_price | premium_pct | liquidity_usd
  op          TEXT NOT NULL,      -- above | below
  value       REAL NOT NULL,
  webhook     TEXT NOT NULL,
  secret      TEXT NOT NULL,      -- HMAC key for the webhook signature
  owner_key   TEXT NOT NULL,      -- the creator's IP key, for the per-IP cap
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  met         INTEGER,            -- null until first checked, then 0 or 1
  last_value  REAL,
  last_checked INTEGER,
  fired       INTEGER NOT NULL DEFAULT 0,
  last_fired  INTEGER,
  last_status INTEGER             -- HTTP status of the last webhook send (0 = failed to send)
);
CREATE INDEX IF NOT EXISTS alerts_symbol ON alerts (symbol, expires_at);
CREATE INDEX IF NOT EXISTS alerts_owner ON alerts (owner_key, expires_at);
