// D1 storage for collector snapshots: the latest stats per token and a price point per run for candles.
// Written only through POST /internal/snapshot (the GitHub Actions collector holds INGEST_KEY); read by /v1/stats and
// /v1/history. The interface is the small part of the D1 binding we use, so tests can hand in a fake.
import { ApiError, json } from "./http.ts";

export type D1Statement = {
  bind(...values: unknown[]): D1Statement;
  run(): Promise<unknown>;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
};
export type D1Like = { prepare(sql: string): D1Statement; batch(statements: D1Statement[]): Promise<unknown> };

export type StatsRow = {
  symbol: string;
  address: string | null;
  name: string | null;
  decimals: number | null;
  supply: number | null;
  tokenPrice: number | null;
  dexPrice: number | null;
  premiumPct: number | null;
  liquidityUsd: number | null;
  pools: unknown[];
};

const MAX_ROWS = 300;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const text = (v: unknown, max = 200): string | null => (typeof v === "string" && v.length <= max ? v : null);

export function cleanRow(raw: unknown): StatsRow | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = text(r.symbol, 12);
  if (!symbol || !/^[A-Z][A-Z0-9.\-]{0,11}$/.test(symbol)) return null;
  const address = text(r.address, 42);
  return {
    symbol,
    address: address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null,
    name: text(r.name),
    decimals: num(r.decimals),
    supply: num(r.supply),
    tokenPrice: num(r.tokenPrice),
    dexPrice: num(r.dexPrice),
    premiumPct: num(r.premiumPct),
    liquidityUsd: num(r.liquidityUsd),
    pools: Array.isArray(r.pools) ? r.pools.slice(0, 8) : [],
  };
}

// Constant-time comparison, so the key cannot be guessed one character at a time from response timing.
function sameKey(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 32) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function postSnapshot(db: D1Like | undefined, ingestKey: string | undefined, req: Request, now: () => number): Promise<Response> {
  if (!db || !ingestKey) throw new ApiError(503, "ingest_off", "Snapshots are not set up on this server.");
  const auth = req.headers.get("authorization") ?? "";
  if (!sameKey(auth.replace(/^Bearer\s+/i, ""), ingestKey)) throw new ApiError(401, "unauthorized", "Wrong or missing key.");
  const text = await req.text();
  if (text.length > 1_000_000) throw new ApiError(413, "body_too_large", "Send at most about 1 MB per snapshot chunk.");
  let body: { ts?: unknown; rows?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", "Send JSON: { ts, rows: [...] }.");
  }
  const ts = num(body.ts);
  // The run time must be recent: an old or future time would bend the candles.
  if (ts === null || Math.abs(now() - ts) > 6 * 3600_000) throw new ApiError(400, "invalid_ts", "ts must be the run time in unix ms, within 6 hours of now.");
  const rows = (Array.isArray(body.rows) ? body.rows : []).map(cleanRow).filter((r): r is StatsRow => r !== null);
  if (rows.length === 0 || rows.length > MAX_ROWS) throw new ApiError(400, "invalid_rows", `Send 1 to ${MAX_ROWS} rows.`);

  const upsert = db.prepare(
    `INSERT INTO token_stats (symbol, address, name, decimals, supply, token_price, dex_price, premium_pct, liquidity_usd, pools_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET address = excluded.address, name = excluded.name, decimals = excluded.decimals,
       supply = excluded.supply, token_price = excluded.token_price, dex_price = excluded.dex_price,
       premium_pct = excluded.premium_pct, liquidity_usd = excluded.liquidity_usd, pools_json = excluded.pools_json,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at >= token_stats.updated_at`,
  );
  const point = db.prepare(
    `INSERT OR REPLACE INTO price_points (symbol, ts, token_price, dex_price, liquidity_usd) VALUES (?, ?, ?, ?, ?)`,
  );
  const statements = rows.flatMap((r) => [
    upsert.bind(r.symbol, r.address, r.name, r.decimals, r.supply, r.tokenPrice, r.dexPrice, r.premiumPct, r.liquidityUsd, JSON.stringify(r.pools), ts),
    point.bind(r.symbol, ts, r.tokenPrice, r.dexPrice, r.liquidityUsd),
  ]);
  await db.batch(statements);
  return json(200, { ok: true, rows: rows.length, ts });
}

type StatsDb = {
  symbol: string; address: string | null; name: string | null; decimals: number | null; supply: number | null;
  token_price: number | null; dex_price: number | null; premium_pct: number | null; liquidity_usd: number | null;
  pools_json: string | null; updated_at: number;
};

const toApi = (r: StatsDb, withPools: boolean) => ({
  symbol: r.symbol,
  name: r.name,
  address: r.address,
  supply: r.supply,
  tokenPrice: r.token_price,
  dexPrice: r.dex_price,
  premiumPct: r.premium_pct,
  liquidityUsd: r.liquidity_usd,
  ...(withPools ? { pools: r.pools_json ? JSON.parse(r.pools_json) : [] } : {}),
  updatedAt: new Date(r.updated_at).toISOString(),
});

export async function storedStats(db: D1Like, symbol: string) {
  const r = await db.prepare("SELECT * FROM token_stats WHERE symbol = ?").bind(symbol).first<StatsDb>();
  return r ? { ...toApi(r, true), updatedAtMs: r.updated_at } : null;
}

// GET /v1/stats: every token at the last collector run, sorted by sort= (liquidity, premium, symbol).
export async function listStats(db: D1Like | undefined, url: URL): Promise<Response> {
  if (!db) throw new ApiError(503, "data_off", "Market data is not set up on this server.");
  const sort = url.searchParams.get("sort") ?? "liquidity";
  const order = sort === "premium" ? "ABS(premium_pct) DESC" : sort === "symbol" ? "symbol ASC" : "liquidity_usd DESC";
  const { results } = await db.prepare(`SELECT * FROM token_stats ORDER BY ${order} NULLS LAST, symbol ASC`).all<StatsDb>();
  const updated = results.reduce((m, r) => Math.max(m, r.updated_at), 0);
  return json(200, {
    count: results.length,
    updatedAt: updated ? new Date(updated).toISOString() : null,
    tokens: results.map((r) => toApi(r, false)),
  });
}

const INTERVALS: Record<string, number> = { "1h": 3600_000, "4h": 4 * 3600_000, "1d": 86_400_000 };

// GET /v1/history/{symbol}?interval=1h|4h|1d&days=1..90: candles of Robinhood's token price from the collector's points,
// with the DEX close and liquidity at the end of each bucket. A run lands about once an hour, so 1h is the finest.
export async function getHistory(db: D1Like | undefined, symbol: string, url: URL, now: () => number): Promise<Response> {
  if (!db) throw new ApiError(503, "data_off", "Market data is not set up on this server.");
  const interval = url.searchParams.get("interval") ?? "1h";
  const step = INTERVALS[interval];
  if (!step) throw new ApiError(400, "invalid_interval", "interval must be 1h, 4h or 1d.");
  const days = Number(url.searchParams.get("days") ?? "7");
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new ApiError(400, "invalid_days", "days must be a whole number from 1 to 90.");
  const from = now() - days * 86_400_000;
  const { results } = await db
    .prepare("SELECT ts, token_price, dex_price, liquidity_usd FROM price_points WHERE symbol = ? AND ts >= ? ORDER BY ts ASC")
    .bind(symbol, from)
    .all<{ ts: number; token_price: number | null; dex_price: number | null; liquidity_usd: number | null }>();
  const candles: { t: string; open: number; high: number; low: number; close: number; dexClose: number | null; liquidityUsd: number | null; points: number }[] = [];
  let cur: (typeof candles)[number] | null = null;
  let curStart = -1;
  for (const p of results) {
    if (p.token_price === null) continue;
    const start = Math.floor(p.ts / step) * step;
    if (start !== curStart) {
      if (cur) candles.push(cur);
      curStart = start;
      cur = { t: new Date(start).toISOString(), open: p.token_price, high: p.token_price, low: p.token_price, close: p.token_price, dexClose: p.dex_price, liquidityUsd: p.liquidity_usd, points: 1 };
    } else if (cur) {
      cur.high = Math.max(cur.high, p.token_price);
      cur.low = Math.min(cur.low, p.token_price);
      cur.close = p.token_price;
      cur.dexClose = p.dex_price ?? cur.dexClose;
      cur.liquidityUsd = p.liquidity_usd ?? cur.liquidityUsd;
      cur.points++;
    }
  }
  if (cur) candles.push(cur);
  return json(200, { symbol, interval, days, count: candles.length, candles, source: "equito collector (Robinhood price, Uniswap v3 pools)" });
}
