// Robinhood Stock Token API (https://api.robinhood.com/rhj/): the registry of stock tokens and the real stock's bid/ask.
// Free, no key, 60 req/s. We cache per Worker isolate: assets 5 min, prices 15 s, so a busy minute stays far below the
// limit. Field names follow Robinhood's docs; the parser is tolerant (array or wrapped list, number or string values)
// because the live shape could not be checked from the owner's network (robinhood.com is blocked there).
import { ApiError } from "./http.ts";

export const RH_BASE = "https://api.robinhood.com/rhj";
export const CHAIN_ID = 4663;
const ASSETS_TTL_MS = 5 * 60_000;
const PRICE_TTL_MS = 15_000;

export type Asset = {
  symbol: string;
  name: string;
  address: string | null; // the token contract on Robinhood Chain
  chainId: number;
  multiplier: number; // token price = stock price x multiplier
  pendingMultiplier: number | null;
  pendingMultiplierAt: string | null;
  status: string | null;
  tradingCapabilities: unknown;
};

export type Quote = {
  symbol: string;
  bid: number; // the real stock
  ask: number;
  mid: number;
  tokenBid: number | null; // the token, already times the multiplier (Robinhood's own numbers)
  tokenAsk: number | null;
  dailyHigh: number | null;
  dailyLow: number | null;
  dailyVolume: number | null; // shares of the real stock
  mintBurnUsdVolume: number | null; // USD minted or redeemed through Robinhood today
  isTradingHalt: boolean;
  generatedAt: string | null;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === "object") {
    for (const k of ["assets", "results", "data", "items"]) {
      const v = (body as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

const onOurChain = (chainId: unknown): boolean => {
  const s = String(chainId ?? "");
  return s === String(CHAIN_ID) || s === `eip155:${CHAIN_ID}`;
};

export function parseAsset(raw: unknown): Asset | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const symbol = str(r.tokenSymbol ?? r.symbol);
  if (!symbol) return null;
  const deployments = Array.isArray(r.deployments) ? (r.deployments as Record<string, unknown>[]) : [];
  const here = deployments.find((d) => d && onOurChain(d.chainId));
  const address = str(here?.contractAddress);
  return {
    symbol: symbol.toUpperCase(),
    // Robinhood names read "Apple • Robinhood Token"; keep the company name.
    name: (str(r.tokenName ?? r.name) ?? symbol).replace(/\s*•\s*Robinhood Token$/i, ""),
    address: address && /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null,
    chainId: CHAIN_ID,
    multiplier: num(r.currentMultiplier) ?? 1,
    // Robinhood sends 0 when no change is scheduled.
    pendingMultiplier: (num(r.pendingMultiplier) ?? 0) > 0 ? num(r.pendingMultiplier) : null,
    pendingMultiplierAt: str(r.pendingMultiplierEffectiveTime),
    status: str(r.status),
    tradingCapabilities: r.tradingCapabilities ?? null,
  };
}

// Live shape (checked 2026-11-25): { quotes: [{ tokenSymbol, bid, ask, tokenBid, tokenAsk, dailyHigh, dailyLow,
// dailyTradingVolume, mintBurnUsdVolume, isTradingHalt, generatedAt, ... }] }, numbers as strings.
export function parseQuote(symbol: string, raw: unknown): Quote | null {
  const s = symbol.toUpperCase();
  const list = listOf(raw).length ? listOf(raw) : listOfQuotes(raw);
  const one = (list.length ? list.find((q) => str((q as Record<string, unknown>)?.tokenSymbol)?.toUpperCase() === s) ?? list[0] : raw) as unknown;
  if (!one || typeof one !== "object") return null;
  const r = one as Record<string, unknown>;
  const bid = num(r.bid ?? r.bidPrice);
  const ask = num(r.ask ?? r.askPrice);
  if (bid === null || ask === null || bid <= 0 || ask <= 0) return null;
  const pos = (v: unknown) => {
    const n = num(v);
    return n !== null && n > 0 ? n : null;
  };
  return {
    symbol: s,
    bid,
    ask,
    mid: (bid + ask) / 2,
    tokenBid: pos(r.tokenBid),
    tokenAsk: pos(r.tokenAsk),
    dailyHigh: pos(r.dailyHigh),
    dailyLow: pos(r.dailyLow),
    dailyVolume: num(r.dailyTradingVolume),
    mintBurnUsdVolume: num(r.mintBurnUsdVolume),
    isTradingHalt: r.isTradingHalt === true,
    generatedAt: str(r.generatedAt),
  };
}

function listOfQuotes(body: unknown): unknown[] {
  const v = body && typeof body === "object" ? (body as Record<string, unknown>).quotes : undefined;
  return Array.isArray(v) ? v : [];
}

// One corporate action, in plain words: type "cash_dividend", status "in_progress", processDate "2026-12-01".
export function parseAction(x: Record<string, unknown>): Record<string, unknown> {
  const plain = (v: unknown, prefix: string) => (typeof v === "string" ? v.replace(prefix, "").toLowerCase() : null);
  const d = x.processDate as { year?: number; month?: number; day?: number } | undefined;
  const processDate = d && d.year && d.month && d.day ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : str(x.processDate);
  const deployments = Array.isArray(x.deployments) ? (x.deployments as Record<string, unknown>[]) : [];
  const here = deployments.find((dep) => dep && onOurChain(dep.chainId));
  return {
    id: str(x.id),
    symbol: (str(x.tokenSymbol ?? x.symbol) ?? "").toUpperCase(),
    type: plain(x.type, "CORPORATE_ACTION_TYPE_"),
    status: plain(x.status, "CORPORATE_ACTION_STATUS_"),
    processDate,
    address: str(here?.contractAddress),
    details: x.details ?? null,
  };
}

type Cached<T> = { at: number; value: T };
const ACTIONS_TTL_MS = 60 * 60_000; // Robinhood's own advice: cache corporate actions for an hour

export class Robinhood {
  private assetsCache: Cached<Asset[]> | null = null;
  private quotes = new Map<string, Cached<Quote>>();
  private f: typeof fetch;
  private now: () => number;
  constructor(f: typeof fetch, now: () => number = Date.now) {
    this.f = f;
    this.now = now;
  }

  private async get(path: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.f(RH_BASE + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "The stock token registry could not be reached. Try again shortly.");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError(502, "upstream_unavailable", "The stock token registry answered with an error. Try again shortly.");
    try {
      return await res.json();
    } catch {
      throw new ApiError(502, "upstream_unavailable", "The stock token registry answered something we could not read.");
    }
  }

  async assets(): Promise<Asset[]> {
    const c = this.assetsCache;
    if (c && this.now() - c.at < ASSETS_TTL_MS) return c.value;
    const list = listOf(await this.get("/assets"))
      .map(parseAsset)
      .filter((a): a is Asset => a !== null)
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (list.length === 0) throw new ApiError(502, "upstream_unavailable", "The stock token registry returned no assets.");
    this.assetsCache = { at: this.now(), value: list };
    return list;
  }

  private actionsCache: Cached<Record<string, unknown>[]> | null = null;

  // Splits, dividends and other events that change a token's multiplier. Passed through as Robinhood sends them,
  // each with a `symbol` added so callers can filter.
  async corporateActions(): Promise<Record<string, unknown>[]> {
    const c = this.actionsCache;
    if (c && this.now() - c.at < ACTIONS_TTL_MS) return c.value;
    const body = await this.get("/corporate-actions");
    // Live shape (checked 2026-11-26): { corpActions: [{ id, type: "CORPORATE_ACTION_TYPE_CASH_DIVIDEND", status:
    // "CORPORATE_ACTION_STATUS_IN_PROGRESS", processDate: { year, month, day }, tokenSymbol, deployments, details }] }.
    let list = listOf(body);
    if (list.length === 0 && body && typeof body === "object") {
      const b = body as Record<string, unknown>;
      const v = b.corpActions ?? b.corporateActions ?? b.actions;
      if (Array.isArray(v)) list = v;
    }
    const value = list.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map(parseAction);
    this.actionsCache = { at: this.now(), value };
    return value;
  }

  async asset(symbol: string): Promise<Asset | null> {
    const s = symbol.toUpperCase();
    return (await this.assets()).find((a) => a.symbol === s) ?? null;
  }

  async quote(symbol: string): Promise<Quote | null> {
    const s = symbol.toUpperCase();
    const c = this.quotes.get(s);
    if (c && this.now() - c.at < PRICE_TTL_MS) return c.value;
    const body = await this.get(`/prices/${encodeURIComponent(s)}`);
    if (body === null) return null;
    const q = parseQuote(s, body);
    // Log the shape (no secrets in a public price) so a format change upstream is visible in `wrangler tail`.
    if (!q) console.error("unparsed price", s, JSON.stringify(body).slice(0, 1500));
    if (!q) throw new ApiError(502, "upstream_unavailable", "The price source answered without a usable bid and ask.");
    this.quotes.set(s, { at: this.now(), value: q });
    return q;
  }
}
