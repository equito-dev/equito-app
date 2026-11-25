import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createApp, type Env } from "../src/worker.ts";
import { collect } from "../collector/collect.ts";
import type { D1Like, D1Statement } from "../src/store.ts";

const KEY = "k".repeat(40);
const NOW = 1_800_000_000_000;

// The D1 binding's small surface over Node's built-in SQLite, with the real migration applied.
function fakeD1(): D1Like {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_market_data.sql", import.meta.url), "utf8"));
  const stmt = (sql: string, params: unknown[] = []): D1Statement => ({
    bind: (...v) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(params as any[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as any[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(params as any[])) as T) ?? null,
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}

const row = (symbol: string, tokenPrice: number, extra: Record<string, unknown> = {}) => ({
  symbol, address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", name: symbol, decimals: 18, supply: 10,
  tokenPrice, dexPrice: tokenPrice * 1.01, premiumPct: 1, liquidityUsd: 5000, pools: [{ fee: 500 }], ...extra,
});

const snapshot = (body: unknown, key = KEY) =>
  new Request("https://api.equito.pro/internal/snapshot", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body) });

const noFetch = (async () => { throw new Error("no network in this test"); }) as typeof fetch;

test("POST /internal/snapshot needs the key, a recent ts and valid rows", async () => {
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY };
  const app = createApp({ fetch: noFetch, now: () => NOW });
  assert.equal((await app(snapshot({ ts: NOW, rows: [row("NVDA", 150)] }, "x".repeat(40)), env)).status, 401);
  assert.equal((await app(snapshot({ ts: NOW - 7 * 3600_000, rows: [row("NVDA", 150)] }), env)).status, 400);
  assert.equal((await app(snapshot({ ts: NOW, rows: [{ symbol: "<bad>" }] }), env)).status, 400);
  const ok = await app(snapshot({ ts: NOW, rows: [row("NVDA", 150), row("TSLA", 300, { liquidityUsd: 9000 })] }), env);
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as any).rows, 2);
  assert.equal((await app(snapshot({ ts: NOW, rows: [row("NVDA", 1)] }), { DB: env.DB })).status, 503);
});

test("GET /v1/stats lists every token from the last run, deepest first", async () => {
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY };
  const app = createApp({ fetch: noFetch, now: () => NOW });
  await app(snapshot({ ts: NOW, rows: [row("NVDA", 150), row("TSLA", 300, { liquidityUsd: 9000, premiumPct: -3 })] }), env);
  const b = (await (await app(new Request("https://api.equito.pro/v1/stats"), env)).json()) as any;
  assert.equal(b.count, 2);
  assert.deepEqual(b.tokens.map((t: any) => t.symbol), ["TSLA", "NVDA"]);
  assert.equal(b.updatedAt, new Date(NOW).toISOString());
  const byPremium = (await (await app(new Request("https://api.equito.pro/v1/stats?sort=premium"), env)).json()) as any;
  assert.equal(byPremium.tokens[0].symbol, "TSLA");
});

test("GET /v1/history builds hourly candles from the stored points", async () => {
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY };
  const hour = 3600_000;
  const base = Math.floor(NOW / hour) * hour - 2 * hour;
  for (const [t, p] of [[base, 100], [base + 20 * 60_000, 104], [base + 40 * 60_000, 98], [base + hour + 5 * 60_000, 101]] as const) {
    await createApp({ fetch: noFetch, now: () => t })(snapshot({ ts: t, rows: [row("NVDA", p)] }), env);
  }
  const app = createApp({ fetch: noFetch, now: () => NOW });
  const b = (await (await app(new Request("https://api.equito.pro/v1/history/nvda?interval=1h&days=1"), env)).json()) as any;
  assert.equal(b.count, 2);
  assert.deepEqual([b.candles[0].open, b.candles[0].high, b.candles[0].low, b.candles[0].close], [100, 104, 98, 98]);
  assert.equal(b.candles[0].points, 3);
  assert.equal(b.candles[1].close, 101);
  assert.equal((await app(new Request("https://api.equito.pro/v1/history/NVDA?interval=5m"), env)).status, 400);
});

test("the collector reads every token and stores them through the API", async () => {
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY };
  const app = createApp({ fetch: noFetch, now: () => NOW });
  const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
  const ZERO = "0x" + "0".repeat(64);
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/rhj/assets")) return Response.json({ assets: [{ tokenSymbol: "NVDA", tokenName: "NVIDIA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: 1 }] });
    if (url.endsWith("/rhj/prices/NVDA")) return Response.json({ quotes: [{ tokenSymbol: "NVDA", bid: "150", ask: "152", tokenBid: "150", tokenAsk: "152" }] });
    if (url === "https://rpc.test") {
      // decimals 18, supply 1000, and no pool on any fee tier
      const batch = JSON.parse(String(init!.body)) as { id: number }[];
      return Response.json(batch.map((c) => ({ jsonrpc: "2.0", id: c.id, result: c.id === 0 ? "0x" + (18).toString(16).padStart(64, "0") : c.id === 1 ? "0x" + (1000n * 10n ** 18n).toString(16).padStart(64, "0") : ZERO })));
    }
    if (url === "https://api.equito.pro/internal/snapshot") return app(new Request(url, init), env);
    throw new Error("unexpected " + url);
  }) as typeof fetch;
  const r = await collect({ fetch: f, rpcUrls: ["https://rpc.test"], apiBase: "https://api.equito.pro", ingestKey: KEY, now: () => NOW, log: () => {} });
  assert.deepEqual(r, { tokens: 1, rows: 1, failed: [], sent: 1 });
  const stored = (await (await app(new Request("https://api.equito.pro/v1/stats"), env)).json()) as any;
  assert.equal(stored.tokens[0].symbol, "NVDA");
  assert.equal(stored.tokens[0].tokenPrice, 151);
  assert.equal(stored.tokens[0].supply, 1000);
});

test("/v1/stats/{symbol} falls back to the stored numbers when every chain node is busy", async () => {
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY, RPC_URLS: "https://rpc.busy" };
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/rhj/assets")) return Response.json({ assets: [{ tokenSymbol: "NVDA", deployments: [{ contractAddress: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", chainId: 4663 }], currentMultiplier: 1 }] });
    if (url.includes("/rhj/prices/")) return Response.json({ quotes: [{ tokenSymbol: "NVDA", bid: "1", ask: "1" }] });
    return Response.json({ jsonrpc: "2.0", error: { code: 429, message: "Too Many Requests" } }); // every node, the public one too
  }) as typeof fetch;
  const app = createApp({ fetch: f, now: () => NOW });
  await app(snapshot({ ts: NOW, rows: [row("NVDA", 150)] }), env);
  const res = await app(new Request("https://api.equito.pro/v1/stats/NVDA"), env);
  assert.equal(res.status, 200);
  const b = (await res.json()) as any;
  assert.equal(b.live, false);
  assert.equal(b.tokenPrice, 150);
  assert.equal(b.updatedAt, new Date(NOW).toISOString());
});
