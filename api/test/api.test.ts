import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, FreeTier, type Env } from "../src/worker.ts";
import { parseAsset, parseQuote } from "../src/robinhood.ts";
import { FREE_CALLS_PER_DAY, USDG, fromBase64, toBase64 } from "../src/x402.ts";

const PAY_TO = "0x759Cf0e19d45c1dCA28977703b69Fd93a3f6a136";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const HOLDER = "0x1111111111111111111111111111111111111111";
const TOKEN = "0x2222222222222222222222222222222222222222";

const ASSETS = {
  assets: [
    { tokenSymbol: "NVDA", tokenName: "NVIDIA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: "1.5", status: "ACTIVE" },
    { tokenSymbol: "TSLA", tokenName: "Tesla", deployments: [{ contractAddress: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", chainId: "eip155:4663" }], currentMultiplier: 1 },
  ],
};

type Calls = { rh: string[]; facilitator: string[] };

function fakeFetch(opts: { rhDown?: boolean; verify?: unknown; settle?: unknown[]; balance?: bigint } = {}) {
  const calls: Calls = { rh: [], facilitator: [] };
  const settles = [...(opts.settle ?? [{ success: true, transaction: "0xabc", network: "eip155:4663", payer: HOLDER }])];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.robinhood.com/rhj")) {
      calls.rh.push(url);
      if (opts.rhDown) throw new Error("down");
      if (url.endsWith("/assets")) return Response.json(ASSETS);
      if (url.endsWith("/prices/NVDA")) return Response.json({ quotes: [{ tokenSymbol: "NVDA", bid: "100", ask: "102", tokenBid: "150", tokenAsk: "153", dailyHigh: "105", dailyLow: "99", dailyTradingVolume: "1000", isTradingHalt: false, generatedAt: "2026-11-25T10:00:00Z" }] });
      return new Response("not found", { status: 404 });
    }
    if (url.includes("facilitator")) {
      calls.facilitator.push(url);
      if (url.endsWith("/verify")) return Response.json(opts.verify ?? { isValid: true, payer: HOLDER });
      return Response.json(settles.length > 1 ? settles.shift() : settles[0]);
    }
    if (url.includes("rpc")) {
      const hex = "0x" + (opts.balance ?? 0n).toString(16);
      return Response.json({ jsonrpc: "2.0", id: 1, result: hex });
    }
    throw new Error("unexpected fetch " + url + " " + init?.method);
  }) as typeof fetch;
  return { f, calls };
}

// An in-memory stand-in for the FREE Durable Object namespace.
function freeNamespace() {
  const objects = new Map<string, FreeTier>();
  return {
    idFromName: (name: string) => name,
    get: (id: unknown) => {
      const key = String(id);
      if (!objects.has(key)) {
        const store = new Map<string, unknown>();
        objects.set(key, new FreeTier({ storage: { get: (k: string) => store.get(k), put: (k: string, v: unknown) => void store.set(k, v) } }));
      }
      return objects.get(key)!;
    },
  };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request("https://api.equito.pro" + path, { headers: { "cf-connecting-ip": "203.0.113.7", ...headers } });

const paidEnv = (): Env => ({ FREE: freeNamespace(), X402_PAY_TO: PAY_TO, PRIORS_API_KEY: "test-key", FACILITATOR_URL: "https://facilitator.test" });

async function useFreeCalls(app: ReturnType<typeof createApp>, env: Env) {
  for (let i = 0; i < FREE_CALLS_PER_DAY; i++) assert.equal((await app(get("/v1/assets"), env)).status, 200);
}

function paymentFor(offer: any, from = HOLDER) {
  return toBase64({ x402Version: 2, accepted: offer, payload: { authorization: { from } } });
}

test("parseAsset reads Robinhood's fields, numbers as strings, and both chain id forms", () => {
  const a = parseAsset(ASSETS.assets[0])!;
  assert.equal(a.symbol, "NVDA");
  assert.equal(a.address, NVDA);
  assert.equal(a.multiplier, 1.5);
  assert.equal(parseAsset(ASSETS.assets[1])!.address, "0x322F0929c4625eD5bAd873c95208D54E1c003b2d");
  assert.equal(parseAsset({ tokenName: "no symbol" }), null);
});

test("parseQuote needs a positive bid and ask", () => {
  assert.equal(parseQuote("NVDA", { bid: "100", ask: "102" })!.mid, 101);
  assert.equal(parseQuote("NVDA", { bid: 0, ask: 1 }), null);
  assert.equal(parseQuote("NVDA", {}), null);
  const live = parseQuote("NVDA", { quotes: [{ tokenSymbol: "NVDA", bid: "142.05", ask: "142.07", tokenBid: "142.16", tokenAsk: "142.18" }] })!;
  assert.equal(live.tokenAsk, 142.18);
  assert.equal(parseAsset({ tokenSymbol: "AAPL", tokenName: "Apple • Robinhood Token" })!.name, "Apple");
});

test("GET /v1/assets lists every token, sorted, and counts as a free call", async () => {
  const { f } = fakeFetch();
  const res = await createApp({ fetch: f })(get("/v1/assets"), paidEnv());
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.count, 2);
  assert.deepEqual(body.assets.map((a: any) => a.symbol), ["NVDA", "TSLA"]);
  assert.equal(res.headers.get("x-free-calls-left"), String(FREE_CALLS_PER_DAY - 1));
});

test("GET /v1/prices/{symbol} gives the stock mid and the token price (mid x multiplier)", async () => {
  const { f } = fakeFetch();
  const res = await createApp({ fetch: f })(get("/v1/prices/nvda"), paidEnv());
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.equal(body.symbol, "NVDA");
  assert.equal(body.stock.mid, 101);
  assert.equal(body.multiplier, 1.5);
  assert.equal(body.tokenPrice, 151.5); // Robinhood's token bid/ask (150, 153)
  assert.equal(body.token.ask, 153);
  assert.equal(body.stock.dailyHigh, 105);
});

test("the registry is cached: two calls, one upstream fetch of /assets", async () => {
  const { f, calls } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  await app(get("/v1/assets"), env);
  await app(get("/v1/assets/TSLA"), env);
  assert.equal(calls.rh.filter((u) => u.endsWith("/assets")).length, 1);
});

test("unknown and malformed symbols cost nothing", async () => {
  const { f } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  const unknown = await app(get("/v1/prices/ZZZZ"), env);
  assert.equal(unknown.status, 404);
  assert.equal(((await unknown.json()) as any).error.code, "unknown_symbol");
  const bad = await app(get("/v1/assets/" + encodeURIComponent("<script>")), env);
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("x-free-calls-left"), String(FREE_CALLS_PER_DAY));
});

test("an upstream outage is a 502 and gives the free slot back", async () => {
  const { f } = fakeFetch({ rhDown: true });
  const res = await createApp({ fetch: f })(get("/v1/assets"), paidEnv());
  assert.equal(res.status, 502);
  assert.equal(((await res.json()) as any).error.code, "upstream_unavailable");
  assert.equal(res.headers.get("x-free-calls-left"), String(FREE_CALLS_PER_DAY));
});

test("past the free calls: 402 with the x402 offer for $0.02 in USDG on 4663", async () => {
  const { f } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  await useFreeCalls(app, env);
  const res = await app(get("/v1/assets"), env);
  assert.equal(res.status, 402);
  const offer = (fromBase64(res.headers.get("payment-required")!) as any).accepts[0];
  assert.equal(offer.amount, "20000");
  assert.equal(offer.asset, USDG);
  assert.equal(offer.network, "eip155:4663");
  assert.equal(offer.payTo, PAY_TO);
});

test("a paid call verifies, answers, settles, and names the transaction", async () => {
  const { f, calls } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  await useFreeCalls(app, env);
  const offer = (await (await app(get("/v1/assets"), env)).json() as any).accepts[0];
  const res = await app(get("/v1/assets", { "payment-signature": paymentFor(offer) }), env);
  assert.equal(res.status, 200);
  assert.deepEqual(calls.facilitator.map((u) => u.split("/").pop()), ["verify", "settle"]);
  assert.equal((fromBase64(res.headers.get("payment-response")!) as any).transaction, "0xabc");
});

test("a payment for other terms is refused before the facilitator is asked", async () => {
  const { f, calls } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  await useFreeCalls(app, env);
  const offer = (await (await app(get("/v1/assets"), env)).json() as any).accepts[0];
  const res = await app(get("/v1/assets", { "payment-signature": paymentFor({ ...offer, amount: "1" }) }), env);
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as any).error, "wrong amount");
  assert.equal(calls.facilitator.length, 0);
});

test("a paid call that fails (unknown symbol) is never settled", async () => {
  const { f, calls } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  await useFreeCalls(app, env);
  const offer = (await (await app(get("/v1/prices/ZZZZ"), env)).json() as any).accepts[0];
  const res = await app(get("/v1/prices/ZZZZ", { "payment-signature": paymentFor(offer) }), env);
  assert.equal(res.status, 404);
  assert.deepEqual(calls.facilitator.map((u) => u.split("/").pop()), ["verify"]);
});

test("settlement_pending is retried with the same payload", async () => {
  const { f, calls } = fakeFetch({ settle: [{ success: false, errorReason: "settlement_pending" }, { success: true, transaction: "0xdef" }] });
  const app = createApp({ fetch: f });
  const env = paidEnv();
  await useFreeCalls(app, env);
  const offer = (await (await app(get("/v1/assets"), env)).json() as any).accepts[0];
  // The worker's own sleep is real; the waits are short enough for a test (about 1 s).
  const res = await app(get("/v1/assets", { "payment-signature": paymentFor(offer) }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.facilitator.filter((u) => u.endsWith("/settle")).length, 2);
});

test("without a pay-to wallet the free calls work and the 51st is 503 payment_not_configured", async () => {
  const { f } = fakeFetch();
  const app = createApp({ fetch: f });
  const env: Env = { FREE: freeNamespace() };
  await useFreeCalls(app, env);
  const res = await app(get("/v1/assets"), env);
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as any).error.code, "payment_not_configured");
});

test("holders pay half, and only from their own wallet", async () => {
  const { f } = fakeFetch({ balance: 2_000_000n * 10n ** 18n, verify: { isValid: true, payer: "0x3333333333333333333333333333333333333333" } });
  const app = createApp({ fetch: f });
  const env: Env = { ...paidEnv(), HOLDER_TOKEN: TOKEN, HOLDER_MIN: String(2_000_000n * 10n ** 18n), RPC_URL: "https://rpc.test" };
  await useFreeCalls(app, env);
  const quote = await app(get("/v1/assets", { "x-holder": HOLDER }), env);
  const offer = ((await quote.json()) as any).accepts[0];
  assert.equal(offer.amount, "10000");
  // The facilitator says someone else paid: full price again, nothing served.
  const res = await app(get("/v1/assets", { "x-holder": HOLDER, "payment-signature": paymentFor(offer) }), env);
  assert.equal(res.status, 402);
  assert.equal(((await res.json()) as any).accepts[0].amount, "20000");
});

test("pricing, health and the index are free", async () => {
  const { f } = fakeFetch();
  const app = createApp({ fetch: f });
  const env = paidEnv();
  const p = (await (await app(get("/v1/pricing"), env)).json()) as any;
  assert.equal(p.freeCallsPerDay, 50);
  assert.equal(p.tradeBuildPriceUsd, 0.04);
  assert.equal(p.holder, null);
  assert.equal((await app(get("/health"), env)).status, 200);
  assert.equal((await app(get("/nope"), env)).status, 404);
});
