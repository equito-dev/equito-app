// GET /v1/stats/{symbol}, GET /v1/quote, POST /v1/trade/build, GET /v1/portfolio/{address}.
// Reads Robinhood Chain directly (Uniswap v3 pools, balances) and sets it next to Robinhood's own token price.
import { formatUnits, parseUnits } from "viem";
import { ERC20, USDG, USDG_DECIMALS, bestQuote, buildSwap, readTokenFacts } from "./uniswap.ts";
import { ApiError, json } from "./http.ts";
import { checkSymbol } from "./market.ts";
import type { Chain } from "./chain.ts";
import type { Asset, Robinhood } from "./robinhood.ts";
import { storedStats, type D1Like } from "./store.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const pct = (a: number, b: number) => round((a / b - 1) * 100, 4);

export async function tokenOf(rh: Robinhood, rawSymbol: string): Promise<Asset & { address: string }> {
  const symbol = checkSymbol(rawSymbol);
  const asset = await rh.asset(symbol);
  if (!asset) throw new ApiError(404, "unknown_symbol", `${symbol} is not a stock token on Robinhood Chain. GET /v1/assets lists them all.`);
  if (!asset.address) throw new ApiError(404, "no_contract", `${symbol} has no contract on Robinhood Chain yet.`);
  return asset as Asset & { address: string };
}

// Robinhood's token mid (bid/ask already times the multiplier), or null when no quote is available right now.
async function tokenMid(rh: Robinhood, asset: Asset): Promise<number | null> {
  const q = await rh.quote(asset.symbol).catch(() => null);
  if (!q) return null;
  const bid = q.tokenBid ?? q.bid * asset.multiplier;
  const ask = q.tokenAsk ?? q.ask * asset.multiplier;
  return (bid + ask) / 2;
}

// Live stats; when the chain cannot be read, the collector's last numbers from D1 (marked stale) instead of an error.
export async function getStats(rh: Robinhood, chain: Chain, rawSymbol: string, db?: D1Like): Promise<Response> {
  const asset = await tokenOf(rh, rawSymbol);
  try {
    return json(200, { ...(await statsFor(rh, chain, asset)), live: true });
  } catch (err) {
    const chainDown = err instanceof ApiError && (err.code === "chain_busy" || err.code === "chain_unavailable");
    const stored = chainDown && db ? await storedStats(db, asset.symbol).catch(() => null) : null;
    if (!stored) throw err;
    const { updatedAtMs: _, ...rest } = stored;
    return json(200, { ...rest, multiplier: asset.multiplier, live: false });
  }
}

// The numbers behind /v1/stats/{symbol}; the collector stores the same shape for every token.
export async function statsFor(rh: Robinhood, chain: Chain, asset: Asset & { address: string }) {
  // Robinhood first: its price checks every pool price and values pool depth.
  const mid = await tokenMid(rh, asset);
  const facts = await readTokenFacts(chain, asset.address, mid);
  const main = facts.pools.find((p) => p.dexPrice !== null) ?? null;
  return {
    symbol: asset.symbol,
    name: asset.name,
    address: asset.address,
    decimals: facts.decimals,
    supply: facts.supply,
    marketCapUsd: facts.supply !== null && mid !== null ? round(facts.supply * mid, 2) : null,
    tokenPrice: mid !== null ? round(mid, 6) : null, // Robinhood's price for one token
    dexPrice: main ? round(main.dexPrice!, 6) : null, // the deepest Uniswap pool's price
    // How far the DEX trades from Robinhood's price: positive means the token costs more on chain.
    premiumPct: main && mid !== null ? pct(main.dexPrice!, mid) : null,
    liquidityUsd: round(facts.pools.reduce((s, p) => s + (p.liquidityUsd ?? 0), 0), 2),
    pools: facts.pools.map((p) => ({ ...p, dexPrice: p.dexPrice !== null ? round(p.dexPrice, 6) : null, liquidityUsd: p.liquidityUsd !== null ? round(p.liquidityUsd, 2) : null })),
    multiplier: asset.multiplier,
    source: { price: "robinhood", dex: "uniswap-v3" },
  };
}

type Side = "buy" | "sell";

function parseTrade(input: { symbol?: unknown; side?: unknown; amount?: unknown }) {
  const side = String(input.side ?? "").toLowerCase();
  if (side !== "buy" && side !== "sell") throw new ApiError(400, "invalid_side", "side must be buy (spend USDG) or sell (spend tokens).");
  const amount = String(input.amount ?? "").trim();
  if (!/^\d{1,15}(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0) {
    throw new ApiError(400, "invalid_amount", "amount must be a positive number: USDG to spend when buying, tokens to sell when selling.");
  }
  return { symbol: String(input.symbol ?? ""), side: side as Side, amount };
}

async function quoteFor(rh: Robinhood, chain: Chain, input: { symbol?: unknown; side?: unknown; amount?: unknown }) {
  const t = parseTrade(input);
  const asset = await tokenOf(rh, t.symbol);
  // Robinhood first: its price checks every pool price and values pool depth.
  const mid = await tokenMid(rh, asset);
  const facts = await readTokenFacts(chain, asset.address, mid);
  const live = facts.pools.filter((p) => p.dexPrice !== null);
  if (live.length === 0) throw new ApiError(404, "no_pool", `${asset.symbol} has no Uniswap pool with USDG yet.`);
  const buying = t.side === "buy";
  const [inDec, outDec] = buying ? [USDG_DECIMALS, facts.decimals] : [facts.decimals, USDG_DECIMALS];
  let amountIn: bigint;
  try {
    amountIn = parseUnits(t.amount, inDec);
  } catch {
    throw new ApiError(400, "invalid_amount", "amount has more decimals than the token allows.");
  }
  const [tokenIn, tokenOut] = buying ? [USDG, asset.address] : [asset.address, USDG];
  const q = await bestQuote(chain, tokenIn, tokenOut, amountIn, live);
  if (!q) throw new ApiError(422, "no_route", "No pool can fill this trade right now (too large, or no liquidity).");
  const inWhole = Number(formatUnits(q.amountIn, inDec));
  const outWhole = Number(formatUnits(q.amountOut, outDec));
  const price = buying ? inWhole / outWhole : outWhole / inWhole; // USDG per token, what this trade really pays
  const pool = live.find((p) => p.address === q.pool)!;
  return {
    asset, facts, q, buying, inDec, outDec, tokenIn, tokenOut,
    body: {
      symbol: asset.symbol,
      side: t.side,
      amountIn: formatUnits(q.amountIn, inDec),
      amountOut: formatUnits(q.amountOut, outDec),
      tokenIn: buying ? "USDG" : asset.symbol,
      tokenOut: buying ? asset.symbol : "USDG",
      price: round(price, 6),
      pool: q.pool,
      feePct: q.fee / 10_000,
      // Against the pool's own price (the cost of size) and against Robinhood's price (the on-chain premium).
      priceImpactPct: pool.dexPrice ? round(Math.abs(pct(price, pool.dexPrice)), 4) : null,
      vsTokenPricePct: mid !== null ? pct(price, mid) : null,
      tokenPrice: mid !== null ? round(mid, 6) : null,
    },
  };
}

export async function getQuote(rh: Robinhood, chain: Chain, url: URL): Promise<Response> {
  const p = url.searchParams;
  const r = await quoteFor(rh, chain, { symbol: p.get("symbol") ?? p.get("ticker"), side: p.get("side"), amount: p.get("amount") });
  return json(200, r.body);
}

const MAX_BODY = 4_096;

export async function postTradeBuild(rh: Robinhood, chain: Chain, req: Request, now: () => number): Promise<Response> {
  const text = await req.text();
  if (text.length > MAX_BODY) throw new ApiError(413, "body_too_large", "Send a small JSON body.");
  let input: Record<string, unknown>;
  try {
    input = JSON.parse(text);
  } catch {
    throw new ApiError(400, "invalid_json", 'Send JSON: { "symbol", "side", "amount", "recipient", "slippageBps"? }.');
  }
  const recipient = String(input.recipient ?? "");
  if (!ADDRESS.test(recipient)) throw new ApiError(400, "invalid_recipient", "recipient must be the wallet address (0x + 40 hex) that receives the output.");
  const slippageBps = input.slippageBps === undefined ? 50 : Number(input.slippageBps);
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 500) throw new ApiError(400, "invalid_slippage", "slippageBps must be a whole number from 1 to 500 (0.01% to 5%).");

  const r = await quoteFor(rh, chain, input);
  const amountOutMinimum = (r.q.amountOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = Math.floor(now() / 1000) + 600;
  const transactions = buildSwap({
    tokenIn: r.tokenIn, tokenOut: r.tokenOut, fee: r.q.fee, recipient, amountIn: r.q.amountIn, amountOutMinimum, deadline,
    inLabel: `${r.body.amountIn} ${r.body.tokenIn}`, outLabel: `${formatUnits(amountOutMinimum, r.outDec)} ${r.body.tokenOut}`,
  });
  return json(200, {
    quote: r.body,
    recipient,
    slippageBps,
    amountOutMinimum: formatUnits(amountOutMinimum, r.outDec),
    deadline,
    chainId: 4663,
    // Send in order from the wallet that holds tokenIn. Equito never holds keys, signs or sends anything.
    transactions,
  });
}

export async function getPortfolio(rh: Robinhood, chain: Chain, rawAddress: string): Promise<Response> {
  const address = decodeURIComponent(rawAddress).trim();
  if (!ADDRESS.test(address)) throw new ApiError(400, "invalid_address", "Send a wallet address: 0x + 40 hex characters.");
  const assets = (await rh.assets()).filter((a): a is Asset & { address: string } => a.address !== null);
  const balances = await chain.calls([
    { to: USDG, abi: ERC20, functionName: "balanceOf", args: [address] },
    ...assets.map((a) => ({ to: a.address, abi: ERC20, functionName: "balanceOf", args: [address] })),
  ]);
  const usdg = typeof balances[0] === "bigint" ? Number(formatUnits(balances[0], USDG_DECIMALS)) : 0;
  // Stock tokens use 18 decimals (ERC-20 default on Robinhood Chain).
  const held = assets
    .map((a, i) => ({ asset: a, raw: balances[i + 1] }))
    .filter((h): h is { asset: Asset & { address: string }; raw: bigint } => typeof h.raw === "bigint" && h.raw > 0n);
  const holdings = await Promise.all(
    held.map(async ({ asset, raw }) => {
      const balance = Number(formatUnits(raw, 18));
      const price = await tokenMid(rh, asset);
      return {
        symbol: asset.symbol,
        name: asset.name,
        address: asset.address,
        balance,
        price: price !== null ? round(price, 6) : null,
        valueUsd: price !== null ? round(balance * price, 2) : null,
      };
    }),
  );
  holdings.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const stocksUsd = holdings.reduce((s, h) => s + (h.valueUsd ?? 0), 0);
  return json(200, {
    address: address.toLowerCase(),
    holdings,
    usdg: round(usdg, 6),
    totalUsd: round(stocksUsd + usdg, 2),
    tokensChecked: assets.length,
  });
}
