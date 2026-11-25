// GET /v1/assets, /v1/assets/{symbol}, /v1/prices/{symbol}.
import { ApiError, json } from "./http.ts";
import type { Robinhood } from "./robinhood.ts";

const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/;

export function checkSymbol(raw: string): string {
  const s = decodeURIComponent(raw).trim();
  if (!SYMBOL.test(s)) throw new ApiError(400, "invalid_symbol", "Send a ticker like NVDA: letters, digits, dot or dash, up to 12 characters.");
  return s.toUpperCase();
}

export async function listAssets(rh: Robinhood): Promise<Response> {
  const assets = await rh.assets();
  return json(200, { count: assets.length, assets });
}

export async function getAsset(rh: Robinhood, rawSymbol: string): Promise<Response> {
  const symbol = checkSymbol(rawSymbol);
  const asset = await rh.asset(symbol);
  if (!asset) throw new ApiError(404, "unknown_symbol", `${symbol} is not a stock token on Robinhood Chain. GET /v1/assets lists them all.`);
  return json(200, asset);
}

export async function getCorporateActions(rh: Robinhood, url: URL): Promise<Response> {
  const raw = url.searchParams.get("symbol");
  const symbol = raw ? checkSymbol(raw) : null;
  const all = await rh.corporateActions();
  const actions = symbol ? all.filter((a) => a.symbol === symbol) : all;
  return json(200, { count: actions.length, symbol, actions, source: "robinhood" });
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

export async function getPrice(rh: Robinhood, rawSymbol: string): Promise<Response> {
  const symbol = checkSymbol(rawSymbol);
  const asset = await rh.asset(symbol);
  if (!asset) throw new ApiError(404, "unknown_symbol", `${symbol} is not a stock token on Robinhood Chain. GET /v1/assets lists them all.`);
  const q = await rh.quote(symbol);
  if (!q) throw new ApiError(404, "no_price", `No price for ${symbol} right now.`);
  // Robinhood's own token bid/ask when given; else the stock's, times the multiplier.
  const tokenBid = q.tokenBid ?? q.bid * asset.multiplier;
  const tokenAsk = q.tokenAsk ?? q.ask * asset.multiplier;
  return json(200, {
    symbol,
    name: asset.name,
    address: asset.address,
    multiplier: asset.multiplier,
    tokenPrice: round((tokenBid + tokenAsk) / 2, 6),
    token: { bid: round(tokenBid, 6), ask: round(tokenAsk, 6) },
    stock: { bid: q.bid, ask: q.ask, mid: round(q.mid, 6), dailyHigh: q.dailyHigh, dailyLow: q.dailyLow, dailyVolume: q.dailyVolume },
    mintBurnUsdVolume: q.mintBurnUsdVolume,
    isTradingHalt: q.isTradingHalt,
    generatedAt: q.generatedAt,
    source: "robinhood",
  });
}
