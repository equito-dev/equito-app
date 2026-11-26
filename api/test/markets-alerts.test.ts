import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { encodeFunctionResult, parseAbi } from "viem";
import { createApp, type Env } from "../src/worker.ts";
import { Chain } from "../src/chain.ts";
import { LAUNCHER, LAUNCH_TOPIC, parseLaunchLog, recentLaunches } from "../src/launches.ts";
import { safeWebhook } from "../src/alerts.ts";
import type { D1Like, D1Statement } from "../src/store.ts";

const KEY = "k".repeat(40);
const NOW = 1_800_000_000_000;
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const word = (addr: string) => "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
const TOKEN = "0x00000000000000000000000000000000000000c1";
const COPY = "0x00000000000000000000000000000000000000c2";
const POOL = "0x00000000000000000000000000000000000000b1";
const CREATOR = "0x00000000000000000000000000000000000000d1";

function fakeD1(): D1Like {
  const db = new DatabaseSync(":memory:");
  for (const m of ["0001_market_data.sql", "0002_launches_alerts.sql"]) db.exec(readFileSync(new URL("../migrations/" + m, import.meta.url), "utf8"));
  const stmt = (sql: string, params: unknown[] = []): D1Statement => ({
    bind: (...v) => stmt(sql, v),
    run: async () => db.prepare(sql).run(...(params as any[])),
    all: async <T>() => ({ results: db.prepare(sql).all(...(params as any[])) as T[] }),
    first: async <T>() => (db.prepare(sql).get(...(params as any[])) as T) ?? null,
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); return []; } };
}

const NAMES = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const log = (token: string, block: number) => ({ address: LAUNCHER, topics: [LAUNCH_TOPIC, word(token), word(POOL), word(CREATOR)], blockNumber: "0x" + block.toString(16) });

test("parseLaunchLog accepts only the launcher's own event", () => {
  assert.deepEqual(parseLaunchLog(log(TOKEN, 10)), { token: TOKEN, pool: POOL, creator: CREATOR, block: 10 });
  assert.equal(parseLaunchLog({ ...log(TOKEN, 10), address: "0x" + "1".repeat(40) }), null); // a fork emitting the same event
  assert.equal(parseLaunchLog({ ...log(TOKEN, 10), topics: [LAUNCH_TOPIC, word(TOKEN)] }), null);
});

test("recentLaunches reads the events, their block times, symbols and names", async () => {
  const f = (async (_: RequestInfo | URL, init?: RequestInit) => {
    const batch = JSON.parse(String(init!.body)) as { id: number; method: string; params: any[] }[];
    return Response.json(batch.map((c) => {
      let result: unknown = null;
      if (c.method === "eth_blockNumber") result = "0x" + (2_000_000).toString(16);
      if (c.method === "eth_getLogs") result = [log(TOKEN, 1_999_000), log(COPY, 1_999_500), { address: "0x" + "9".repeat(40), topics: [] }];
      if (c.method === "eth_getBlockByNumber") result = { timestamp: "0x" + Math.floor(NOW / 1000).toString(16) };
      if (c.method === "eth_call") {
        const isSymbol = c.params[0].data === "0x95d89b41";
        result = encodeFunctionResult({ abi: NAMES, functionName: isSymbol ? "symbol" : "name", result: isSymbol ? "PEPE" : "Pepe Coin" });
      }
      return { jsonrpc: "2.0", id: c.id, result };
    }));
  }) as typeof fetch;
  const launches = await recentLaunches(new Chain("https://rpc.test", f));
  assert.equal(launches.length, 2);
  assert.equal(launches[0].symbol, "PEPE");
  assert.equal(launches[0].name, "Pepe Coin");
  assert.equal(launches[0].createdAt, Math.floor(NOW / 1000) * 1000);
});

test("launches are stored through the API and /v1/markets flags reused tickers", async () => {
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY };
  const app = createApp({ fetch: (async () => { throw new Error("no network"); }) as typeof fetch, now: () => NOW });
  const body = { launches: [
    { token: TOKEN, pool: POOL, creator: CREATOR, block: 1, createdAt: NOW - 3600_000, symbol: "PEPE", name: "Pepe" },
    { token: COPY, pool: POOL, creator: CREATOR, block: 2, createdAt: NOW - 60_000, symbol: "pepe", name: "Pepe 2" },
  ] };
  const send = (key: string) => app(new Request("https://api.equito.pro/internal/launches", { method: "POST", headers: { authorization: `Bearer ${key}` }, body: JSON.stringify(body) }), env);
  assert.equal((await send("x".repeat(40))).status, 401);
  assert.equal((await send(KEY)).status, 200);
  assert.equal((await send(KEY)).status, 200); // a second run stores nothing twice
  const m = (await (await app(new Request("https://api.equito.pro/v1/markets?hours=24"), env)).json()) as any;
  assert.equal(m.total, 2);
  assert.equal(m.launches[0].token, COPY); // newest first
  assert.equal(m.launches[0].sameTickerInWindow, 2);
  assert.equal(m.launches[0].creatorLaunchesInWindow, 2);
  assert.equal((await app(new Request("https://api.equito.pro/v1/markets?hours=999"), env)).status, 400);
});

test("safeWebhook takes public https host names only", () => {
  assert.ok(safeWebhook("https://hooks.example.com/equito"));
  for (const bad of ["http://hooks.example.com", "https://localhost/x", "https://10.0.0.1/x", "https://[::1]/x", "https://intranet/x", "https://user:pw@example.com/x", "nope"]) {
    assert.equal(safeWebhook(bad), null, bad);
  }
});

test("alerts: create, fire once per crossing with a valid signature, read, delete", async () => {
  const sent: { body: string; sig: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/rhj/assets")) return Response.json({ assets: [{ tokenSymbol: "NVDA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: 1 }] });
    if (url === "https://hooks.example.com/eq") {
      sent.push({ body: String(init!.body), sig: (init!.headers as Record<string, string>)["equito-signature"] });
      return new Response("ok");
    }
    throw new Error("unexpected " + url);
  }) as typeof fetch;
  const env: Env = { DB: fakeD1(), INGEST_KEY: KEY };
  let t = NOW;
  const app = createApp({ fetch: f, now: () => t });
  const make = (metric: string) => app(new Request("https://api.equito.pro/v1/alerts", { method: "POST", body: JSON.stringify({ symbol: "nvda", metric, op: "above", value: 1, webhookUrl: "https://hooks.example.com/eq" }) }), env);
  const create = await make("premium_pct");
  assert.equal(create.status, 201);
  const { alert, webhookSecret } = (await create.json()) as any;
  assert.match(alert.id, /^al_[0-9a-f]{32}$/);
  assert.equal((await make("price")).status, 400);

  const snap = async (premium: number) => {
    t += 1000;
    const res = await app(new Request("https://api.equito.pro/internal/snapshot", {
      method: "POST", headers: { authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ ts: t, rows: [{ symbol: "NVDA", tokenPrice: 150, dexPrice: 151, premiumPct: premium, liquidityUsd: 1000, pools: [] }] }),
    }), env);
    return ((await res.json()) as any).alerts.fired as number;
  };
  assert.equal(await snap(0.5), 0); // below: nothing
  assert.equal(await snap(1.5), 1); // crosses above: one webhook
  assert.equal(await snap(2.0), 0); // still above: no repeat
  assert.equal(await snap(0.2), 0); // back below
  assert.equal(await snap(1.2), 1); // crosses again
  assert.equal(sent.length, 2);
  const [, ts, v1] = sent[0].sig.match(/^t=(\d+),v1=([0-9a-f]{64})$/)!;
  assert.equal(v1, createHmac("sha256", webhookSecret).update(`${ts}.${sent[0].body}`).digest("hex"));
  assert.equal(JSON.parse(sent[0].body).value, 1.5);

  const read = (await (await app(new Request(`https://api.equito.pro/v1/alerts/${alert.id}`), env)).json()) as any;
  assert.equal(read.alert.fired, 2);
  assert.equal(read.alert.lastStatus, 200);
  assert.equal(read.alert.met, true);
  assert.equal((await app(new Request(`https://api.equito.pro/v1/alerts/${alert.id}`, { method: "DELETE" }), env)).status, 200);
  assert.equal((await app(new Request(`https://api.equito.pro/v1/alerts/${alert.id}`), env)).status, 404);
});
