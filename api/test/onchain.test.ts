import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeFunctionData, encodeFunctionResult, type Abi } from "viem";
import { createApp, type Env } from "../src/worker.ts";
import { ERC20, FACTORY, FACTORY_ABI, POOL_ABI, QUOTER, QUOTER_ABI, ROUTER, ROUTER_ABI, USDG, priceFromSqrt } from "../src/uniswap.ts";

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const POOL = "0x00000000000000000000000000000000000000a5";
const EMPTY_POOL = "0x00000000000000000000000000000000000000e7"; // exists, never funded: extreme price, no liquidity
const WALLET = "0x1111111111111111111111111111111111111111";
const ZERO = "0x0000000000000000000000000000000000000000";
const E18 = 10n ** 18n;
const DEX_PRICE = 152; // USDG per NVDA in the fake pool; Robinhood says 151.5 (tokenBid 151, tokenAsk 152)

// USDG (0x5f...) sorts before NVDA (0xd0...), so USDG is token0 and the pool price is NVDA per USDG.
const ratio = 1e12 / DEX_PRICE; // token1 (NVDA raw) per token0 (USDG raw)
const SQRT = BigInt(Math.round(Math.sqrt(ratio) * 2 ** 96));

const ABIS: { abi: Abi; match: (to: string) => boolean }[] = [
  { abi: FACTORY_ABI as Abi, match: (to) => to === FACTORY.toLowerCase() },
  { abi: POOL_ABI as Abi, match: (to) => to === POOL.toLowerCase() || to === EMPTY_POOL.toLowerCase() },
  { abi: QUOTER_ABI as Abi, match: (to) => to === QUOTER.toLowerCase() },
  { abi: ERC20 as Abi, match: () => true },
];

function answer(to: string, data: `0x${string}`): `0x${string}` | null {
  const { abi } = ABIS.find((a) => a.match(to))!;
  const call = decodeFunctionData({ abi, data });
  const fn = call.functionName as string;
  const args = (call.args ?? []) as any[];
  const enc = (result: unknown) => encodeFunctionResult({ abi, functionName: fn, result } as any);
  if (fn === "getPool") return enc(args[2] === 500 ? POOL : args[2] === 3000 ? EMPTY_POOL : ZERO);
  if (fn === "slot0") return enc([to === EMPTY_POOL.toLowerCase() ? 4295128740n : SQRT, 0, 0, 0, 0, 0, true]);
  if (fn === "token0") return enc(USDG);
  if (fn === "liquidity") return enc(to === EMPTY_POOL.toLowerCase() ? 0n : 123456789n);
  if (fn === "quoteExactInputSingle") {
    const p = args[0];
    if (p.fee !== 500) return null; // no such pool: QuoterV2 reverts
    const out = p.tokenIn.toLowerCase() === USDG.toLowerCase()
      ? (p.amountIn * 10n ** 12n * 1000n) / 152_500n // buying: a bit worse than the pool price
      : (p.amountIn * 151_500n) / 1000n / 10n ** 12n; // selling
    return enc([out, SQRT, 1, 100000n]);
  }
  if (fn === "decimals") return enc(to === USDG.toLowerCase() ? 6 : 18);
  if (fn === "totalSupply") return enc(1000n * E18);
  if (fn === "balanceOf") {
    const who = (args[0] as string).toLowerCase();
    if (who === POOL.toLowerCase()) return enc(to === USDG.toLowerCase() ? 15_000n * 10n ** 6n : 100n * E18);
    if (who === WALLET.toLowerCase()) return enc(to === USDG.toLowerCase() ? 25n * 10n ** 6n : to === NVDA.toLowerCase() ? 2n * E18 : 0n);
    return enc(0n);
  }
  throw new Error("unexpected call " + fn);
}

const TIGHT = { tokenSymbol: "NVDA", bid: "151", ask: "152", tokenBid: "151", tokenAsk: "152" };

function fakeFetch(nvdaQuote: Record<string, string> = TIGHT) {
  const rpcBatches: number[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("https://api.robinhood.com/rhj")) {
      if (url.endsWith("/assets")) {
        return Response.json({ assets: [
          { tokenSymbol: "NVDA", tokenName: "NVIDIA • Robinhood Token", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: "1" },
          { tokenSymbol: "TSLA", tokenName: "Tesla", deployments: [{ contractAddress: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", chainId: 4663 }], currentMultiplier: 1 },
        ] });
      }
      if (url.endsWith("/prices/NVDA")) return Response.json({ quotes: [nvdaQuote] });
      if (url.endsWith("/corporate-actions")) return Response.json({ corpActions: [{ id: "0x01", tokenSymbol: "NVDA", type: "CORPORATE_ACTION_TYPE_STOCK_SPLIT", status: "CORPORATE_ACTION_STATUS_IN_PROGRESS", processDate: { year: 2026, month: 12, day: 1 }, deployments: [{ contractAddress: NVDA, chainId: 4663 }] }, { id: "0x02", tokenSymbol: "AAPL", type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND" }] });
      return new Response("nf", { status: 404 });
    }
    if (url === "https://rpc.test") {
      const batch = JSON.parse(String(init!.body)) as { id: number; params: [{ to: string; data: `0x${string}` }] }[];
      rpcBatches.push(batch.length);
      return Response.json(batch.map((c) => {
        const r = answer(c.params[0].to.toLowerCase(), c.params[0].data);
        return r === null ? { jsonrpc: "2.0", id: c.id, error: { code: 3, message: "execution reverted" } } : { jsonrpc: "2.0", id: c.id, result: r };
      }));
    }
    throw new Error("unexpected fetch " + url);
  }) as typeof fetch;
  return { f, rpcBatches };
}

const env: Env = { RPC_URL: "https://rpc.test" }; // no FREE binding: every call is free in tests
const get = (path: string) => new Request("https://api.equito.pro" + path);
const app = (f: typeof fetch) => createApp({ fetch: f, now: () => 1_800_000_000_000 });

test("priceFromSqrt reads both token orders", () => {
  assert.ok(Math.abs(priceFromSqrt(SQRT, false, 18) - DEX_PRICE) < 1e-6);
  const r2 = DEX_PRICE * 1e-12; // token as token0: USDG raw per token raw
  assert.ok(Math.abs(priceFromSqrt(BigInt(Math.round(Math.sqrt(r2) * 2 ** 96)), true, 18) - DEX_PRICE) < 1e-6);
});

test("GET /v1/stats gives the DEX price, the premium over Robinhood's price, pool depth and supply", async () => {
  const { f, rpcBatches } = fakeFetch();
  const res = await app(f)(get("/v1/stats/NVDA"), env);
  assert.equal(res.status, 200);
  const b = (await res.json()) as any;
  assert.equal(b.tokenPrice, 151.5);
  assert.equal(b.dexPrice, 152);
  assert.equal(b.premiumPct, 0.33); // 152 / 151.5 - 1
  assert.equal(b.supply, 1000);
  assert.equal(b.marketCapUsd, 151500);
  assert.equal(b.pools.length, 2);
  assert.equal(b.pools[0].fee, 500);
  // The never-funded pool keeps no price (its tick would say something absurd) and adds nothing to depth.
  assert.equal(b.pools[1].fee, 3000);
  assert.equal(b.pools[1].dexPrice, null);
  assert.equal(b.liquidityUsd, 30150); // 15,000 USDG + 100 NVDA at Robinhood's 151.5
  assert.deepEqual(rpcBatches, [6, 10]); // two round trips
});

// Outside market hours (real GLD on 2026-11-28: 331.50 / 500): no Robinhood price, so no premium and no market cap,
// and the pool is valued at its own price instead of the made-up midpoint.
test("a wide Robinhood spread gives stats and quotes no token price, no premium, and depth at the DEX price", async () => {
  const { f } = fakeFetch({ tokenSymbol: "NVDA", bid: "120", ask: "190", tokenBid: "120", tokenAsk: "190" });
  const s = (await (await app(f)(get("/v1/stats/NVDA"), env)).json()) as any;
  assert.equal(s.tokenPrice, null);
  assert.equal(s.premiumPct, null);
  assert.equal(s.marketCapUsd, null);
  assert.equal(s.dexPrice, 152);
  assert.equal(s.spreadPct, 58.33);
  assert.match(s.priceNote, /spread/);
  assert.equal(s.liquidityUsd, 30200); // 15,000 USDG + 100 NVDA at the pool's 152, not at the 155 midpoint
  const q = (await (await app(f)(get("/v1/quote?symbol=NVDA&side=buy&amount=100"), env)).json()) as any;
  assert.equal(q.price, 152.5); // the real quote still works
  assert.equal(q.vsTokenPricePct, null);
  assert.equal(q.tokenPrice, null);
  const tight = (await (await app(fakeFetch().f)(get("/v1/stats/NVDA"), env)).json()) as any;
  assert.equal(tight.priceNote, undefined);
  assert.equal(tight.spreadPct, 0.66);
});

test("GET /v1/quote buys and sells through the best pool and reports impact and premium", async () => {
  const { f } = fakeFetch();
  const buy = (await (await app(f)(get("/v1/quote?symbol=NVDA&side=buy&amount=100"), env)).json()) as any;
  assert.equal(buy.tokenIn, "USDG");
  assert.equal(buy.tokenOut, "NVDA");
  assert.equal(buy.price, 152.5);
  assert.equal(buy.feePct, 0.05);
  assert.ok(buy.priceImpactPct > 0);
  const sell = (await (await app(f)(get("/v1/quote?symbol=NVDA&side=sell&amount=1"), env)).json()) as any;
  assert.equal(sell.amountOut, "151.5");
});

test("quote and trade/build refuse bad input before reading the chain", async () => {
  const { f, rpcBatches } = fakeFetch();
  const a = app(f);
  assert.equal((await a(get("/v1/quote?symbol=NVDA&side=hold&amount=1"), env)).status, 400);
  assert.equal((await a(get("/v1/quote?symbol=NVDA&side=buy&amount=-5"), env)).status, 400);
  const bad = await a(new Request("https://api.equito.pro/v1/trade/build", { method: "POST", body: JSON.stringify({ symbol: "NVDA", side: "buy", amount: "10", recipient: "nope" }) }), env);
  assert.equal(((await bad.json()) as any).error.code, "invalid_recipient");
  assert.equal(rpcBatches.length, 0);
});

test("POST /v1/trade/build returns an unsigned approve and a deadline-bound swap with slippage applied", async () => {
  const { f } = fakeFetch();
  const res = await app(f)(new Request("https://api.equito.pro/v1/trade/build", {
    method: "POST",
    body: JSON.stringify({ symbol: "NVDA", side: "buy", amount: "100", recipient: WALLET, slippageBps: 100 }),
  }), env);
  assert.equal(res.status, 200);
  const b = (await res.json()) as any;
  assert.equal(b.transactions.length, 2);
  assert.equal(b.transactions[0].to.toLowerCase(), USDG.toLowerCase());
  assert.equal(b.transactions[1].to, ROUTER);
  assert.equal(b.deadline, 1_800_000_600);
  const multicall = decodeFunctionData({ abi: ROUTER_ABI as Abi, data: b.transactions[1].data });
  assert.equal(multicall.functionName, "multicall");
  const [deadline, inner] = multicall.args as [bigint, `0x${string}`[]];
  assert.equal(deadline, 1_800_000_600n);
  const swap = decodeFunctionData({ abi: ROUTER_ABI as Abi, data: inner[0] });
  const p = (swap.args as any[])[0];
  assert.equal(p.recipient.toLowerCase(), WALLET);
  assert.equal(p.fee, 500);
  assert.equal(p.amountIn, 100_000_000n);
  // 1% below the quote
  const quoted = (100_000_000n * 10n ** 12n * 1000n) / 152_500n;
  assert.equal(p.amountOutMinimum, (quoted * 9900n) / 10_000n);
});

test("GET /v1/portfolio values every stock token a wallet holds, plus its USDG", async () => {
  const { f } = fakeFetch();
  const b = (await (await app(f)(get("/v1/portfolio/" + WALLET), env)).json()) as any;
  assert.equal(b.holdings.length, 1);
  assert.equal(b.holdings[0].symbol, "NVDA");
  assert.equal(b.holdings[0].name, "NVIDIA");
  assert.equal(b.holdings[0].valueUsd, 303);
  assert.equal(b.usdg, 25);
  assert.equal(b.totalUsd, 328);
  assert.equal(b.tokensChecked, 2);
});

test("GET /v1/corporate-actions lists Robinhood's events and filters by symbol", async () => {
  const { f } = fakeFetch();
  const all = (await (await app(f)(get("/v1/corporate-actions"), env)).json()) as any;
  assert.equal(all.count, 2);
  const nvda = (await (await app(f)(get("/v1/corporate-actions?symbol=nvda"), env)).json()) as any;
  assert.equal(nvda.count, 1);
  assert.equal(nvda.actions[0].type, "stock_split");
  assert.equal(nvda.actions[0].status, "in_progress");
  assert.equal(nvda.actions[0].processDate, "2026-12-01");
  assert.equal(nvda.actions[0].address, NVDA);
});

test("a node that answers 429 is skipped: the same batch goes to the next node in RPC_URLS", async () => {
  const { f } = fakeFetch();
  let busyHits = 0;
  const withBusy = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "https://rpc.busy") {
      busyHits++;
      return Response.json({ jsonrpc: "2.0", error: { code: 429, message: "Too Many Requests" } });
    }
    return f(input, init);
  }) as typeof fetch;
  const res = await app(withBusy)(get("/v1/stats/NVDA"), { RPC_URLS: "https://rpc.busy, https://rpc.test" });
  assert.equal(res.status, 200);
  assert.equal(((await res.json()) as any).dexPrice, 152);
  assert.ok(busyHits >= 1);
});

test("a batch where some calls hit a rate limit is retried elsewhere, never read as 'no pool'", async () => {
  const { f } = fakeFetch();
  let partialHits = 0;
  const partial = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "https://rpc.partial") {
      partialHits++;
      const batch = JSON.parse(String(init!.body)) as { id: number }[];
      // first call fine, the rest refused for capacity (the shape some providers use)
      return Response.json(batch.map((c, i) => i === 0 ? { jsonrpc: "2.0", id: c.id, result: "0x" + "0".repeat(63) + "1" } : { jsonrpc: "2.0", id: c.id, error: { code: -32005, message: "request rate exceeded" } }));
    }
    return f(input, init);
  }) as typeof fetch;
  const b = (await (await app(partial)(get("/v1/stats/NVDA"), { RPC_URLS: "https://rpc.partial,https://rpc.test" })).json()) as any;
  assert.equal(b.dexPrice, 152);
  assert.ok(partialHits >= 1);
});
