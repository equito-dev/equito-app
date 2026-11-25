-- Market data written by the collector (GitHub Actions -> POST /internal/snapshot) and read by /v1/stats and /v1/history.

-- The latest numbers per token, one row each, replaced on every run.
CREATE TABLE IF NOT EXISTS token_stats (
  symbol         TEXT PRIMARY KEY,
  address        TEXT,
  name           TEXT,
  decimals       INTEGER,
  supply         REAL,
  token_price    REAL,   -- Robinhood's price for one token (tokenBid/tokenAsk mid)
  dex_price      REAL,   -- the deepest Uniswap v3 USDG pool
  premium_pct    REAL,   -- dex_price vs token_price, in percent
  liquidity_usd  REAL,   -- every USDG pool, both sides
  pools_json     TEXT,   -- the pools as JSON
  updated_at     INTEGER NOT NULL  -- unix ms of the run
);

-- One point per token per run: the source for candles (/v1/history).
CREATE TABLE IF NOT EXISTS price_points (
  symbol         TEXT NOT NULL,
  ts             INTEGER NOT NULL, -- unix ms of the run
  token_price    REAL,
  dex_price      REAL,
  liquidity_usd  REAL,
  PRIMARY KEY (symbol, ts)
);
CREATE INDEX IF NOT EXISTS price_points_ts ON price_points (ts);
