// Equito SDK: one small class over the Equito API (https://api.equito.pro). No dependencies, works in Node 18+,
// browsers, Deno, Bun and Workers.
//
//   import { Equito } from "equito";
//   const eq = new Equito();
//   const nvda = await eq.stats("NVDA");          // DEX price vs Robinhood's price, pools, supply
//   const q = await eq.quote({ symbol: "NVDA", side: "buy", amount: "100" });
//
// 50 calls a day per IP are free. After that a call answers 402 (x402 v2, USDG on Robinhood Chain). Pass `pay` and
// the SDK signs and retries once for you: `pay` gets the payment terms and returns the base64 PAYMENT-SIGNATURE,
// signed by your own wallet (any x402 client library can build it). Equito never sees or holds your keys.

export const DEFAULT_BASE_URL = "https://api.equito.pro";

export type PaymentRequirements = {
  scheme: "exact";
  network: string; // eip155:4663
  amount: string; // base units of USDG (6 decimals): 10000 = $0.01
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: { name: string; version: string };
};
export type PaymentRequired = { x402Version: number; error?: string; resource?: unknown; accepts: PaymentRequirements[] };

export type EquitoOptions = {
  baseUrl?: string;
  /** Signs the x402 payment for `requirements` with your wallet and returns the base64 PAYMENT-SIGNATURE payload. */
  pay?: (requirements: PaymentRequirements, paymentRequired: PaymentRequired) => Promise<string>;
  /** Your address, for the holder price once $EQUITO is live. Payments must then come from this address. */
  holder?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export class EquitoError extends Error {
  status: number;
  code: string;
  /** Present on a 402 that was not paid (no `pay` given, or the payment was refused). */
  paymentRequired?: PaymentRequired;
  constructor(status: number, code: string, message: string, paymentRequired?: PaymentRequired) {
    super(message);
    this.name = "EquitoError";
    this.status = status;
    this.code = code;
    this.paymentRequired = paymentRequired;
  }
}

export type CallInfo = {
  /** Free calls left today for this IP (null once you are paying). */
  freeCallsLeft: number | null;
  /** base64 PAYMENT-RESPONSE (transaction, payer) when this call was paid. */
  paymentResponse: string | null;
};

// ---- Response shapes (the fields most callers use; the API may add more) ----
export type Asset = {
  symbol: string; name: string; address: string | null; chainId: number; multiplier: number;
  pendingMultiplier: number | null; pendingMultiplierAt: string | null; status: string | null; tradingCapabilities: unknown;
};
export type Price = {
  symbol: string; name: string; address: string | null; multiplier: number; tokenPrice: number;
  token: { bid: number; ask: number };
  stock: { bid: number; ask: number; mid: number; dailyHigh: number | null; dailyLow: number | null; dailyVolume: number | null };
  mintBurnUsdVolume: number | null; isTradingHalt: boolean; generatedAt: string | null;
};
export type Pool = { address: string; fee: number; feePct: number; dexPrice: number | null; tokenBalance: number; usdgBalance: number; liquidityUsd: number | null; activeLiquidity: string };
export type Stats = {
  symbol: string; name: string | null; address: string | null; supply: number | null; marketCapUsd?: number | null;
  tokenPrice: number | null; dexPrice: number | null; premiumPct: number | null; liquidityUsd: number | null;
  pools?: Pool[]; live?: boolean; updatedAt?: string;
};
export type StatsList = { count: number; updatedAt: string | null; tokens: Stats[] };
export type Candle = { t: string; open: number; high: number; low: number; close: number; dexClose: number | null; liquidityUsd: number | null; points: number };
export type History = { symbol: string; interval: string; days: number; count: number; candles: Candle[] };
export type Quote = {
  symbol: string; side: "buy" | "sell"; amountIn: string; amountOut: string; tokenIn: string; tokenOut: string;
  price: number; pool: string; feePct: number; priceImpactPct: number | null; vsTokenPricePct: number | null; tokenPrice: number | null;
};
export type UnsignedTx = { to: string; data: string; value: "0"; description: string };
export type TradeBuild = { quote: Quote; recipient: string; slippageBps: number; amountOutMinimum: string; deadline: number; chainId: number; transactions: UnsignedTx[] };
export type Holding = { symbol: string; name: string; address: string; balance: number; price: number | null; valueUsd: number | null };
export type Portfolio = { address: string; holdings: Holding[]; usdg: number; totalUsd: number; tokensChecked: number };
export type CorporateAction = { id: string | null; symbol: string; type: string | null; status: string | null; processDate: string | null; address: string | null; details: unknown };
export type Figure = { value: number; periodEnd: string; form: string | null; fiscalYear: number | null } | null;
export type Figures = Record<"revenue" | "netIncome" | "epsDiluted" | "totalAssets" | "totalLiabilities" | "cash" | "operatingCashFlow", Figure>;
export type Research = {
  symbol: string; cik: string; name: string; industry: string | null; exchanges: string[]; fiscalYearEnd: string | null;
  sharesOutstanding: { value: number; asOf: string } | null; annual: Figures; quarter: Figures;
  filings: { form: string; filed: string | null; reportDate: string | null; description: string | null; url: string | null }[];
};
export type Launch = { token: string; symbol: string | null; name: string | null; pool: string; creator: string; createdAt: string; block: number; sameTickerInWindow: number | null; creatorLaunchesInWindow: number };
export type Markets = { hours: number; total: number; updatedAt: string | null; launches: Launch[] };
export type AlertMetric = "token_price" | "dex_price" | "premium_pct" | "liquidity_usd";
export type Alert = {
  id: string; symbol: string; metric: AlertMetric; op: "above" | "below"; value: number; webhookHost: string; createdAt: string; expiresAt: string;
  met: boolean | null; lastValue: number | null; lastChecked: string | null; fired: number; lastFired: string | null; lastStatus: number | null;
};
export type Pricing = {
  freeCallsPerDay: number; priceUsd: number; tradeBuildPriceUsd: number; amount: string; asset: string; network: string;
  payTo: string | null; facilitator: string; holder: { token: string; minBalance: string; discountPct: number; header: string } | null;
};

const SYMBOL = /^[A-Za-z][A-Za-z0-9.\-]{0,11}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function fromBase64Json(text: string): unknown {
  try {
    const bin = atob(text.trim());
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
  } catch {
    return undefined;
  }
}

export class Equito {
  readonly baseUrl: string;
  /** Free calls left and the payment receipt of the most recent call. */
  last: CallInfo = { freeCallsLeft: null, paymentResponse: null };
  private opts: EquitoOptions;
  private f: typeof fetch;

  constructor(opts: EquitoOptions = {}) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.f = opts.fetch ?? ((input, init) => fetch(input, init));
    if (opts.holder !== undefined && !ADDRESS.test(opts.holder)) throw new TypeError("holder must be an address: 0x + 40 hex");
  }

  private async request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: "application/json", ...this.opts.headers };
    if (this.opts.holder) headers["x-holder"] = this.opts.holder;
    if (body !== undefined) headers["content-type"] = "application/json";
    const send = (extra: Record<string, string> = {}) =>
      this.f(this.baseUrl + path, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });

    let res = await send();
    if (res.status === 402) {
      const terms = ((await res.clone().json().catch(() => undefined)) ?? fromBase64Json(res.headers.get("payment-required") ?? "")) as PaymentRequired | undefined;
      const req = terms?.accepts?.[0];
      if (!this.opts.pay || !req) throw new EquitoError(402, "payment_required", terms?.error ?? "Payment required.", terms);
      res = await send({ "payment-signature": await this.opts.pay(req, terms!) });
    }
    const left = res.headers.get("x-free-calls-left");
    this.last = { freeCallsLeft: left === null ? null : Number(left), paymentResponse: res.headers.get("payment-response") };
    const data = (await res.json().catch(() => undefined)) as any;
    if (!res.ok) {
      const e = data?.error;
      if (res.status === 402) throw new EquitoError(402, "payment_refused", typeof data?.error === "string" ? data.error : "The payment was not accepted.", data);
      throw new EquitoError(res.status, typeof e?.code === "string" ? e.code : `http_${res.status}`, typeof e?.message === "string" ? e.message : `Equito answered ${res.status}.`);
    }
    return data as T;
  }

  private sym(symbol: string): string {
    if (!SYMBOL.test(symbol)) throw new TypeError(`Not a ticker: ${symbol}`);
    return encodeURIComponent(symbol.toUpperCase());
  }

  /** Every stock token on Robinhood Chain. */
  async assets(): Promise<Asset[]> {
    return (await this.request<{ assets: Asset[] }>("GET", "/v1/assets")).assets;
  }
  asset(symbol: string): Promise<Asset> {
    return this.request("GET", `/v1/assets/${this.sym(symbol)}`);
  }
  /** Robinhood's token bid/ask and the real stock's quote. */
  price(symbol: string): Promise<Price> {
    return this.request("GET", `/v1/prices/${this.sym(symbol)}`);
  }
  /** One token live (DEX price, premium, pools), or every token from the last collector run when no symbol is given. */
  stats(symbol: string): Promise<Stats>;
  stats(opts?: { sort?: "liquidity" | "premium" | "symbol" }): Promise<StatsList>;
  stats(arg?: string | { sort?: "liquidity" | "premium" | "symbol" }): Promise<Stats | StatsList> {
    if (typeof arg === "string") return this.request("GET", `/v1/stats/${this.sym(arg)}`);
    return this.request("GET", `/v1/stats${arg?.sort ? `?sort=${arg.sort}` : ""}`);
  }
  history(symbol: string, opts: { interval?: "1h" | "4h" | "1d"; days?: number } = {}): Promise<History> {
    const q = new URLSearchParams();
    if (opts.interval) q.set("interval", opts.interval);
    if (opts.days !== undefined) q.set("days", String(opts.days));
    return this.request("GET", `/v1/history/${this.sym(symbol)}${[...q].length ? "?" + q : ""}`);
  }
  /** A real Uniswap v3 quote. amount: USDG to spend (buy) or tokens to sell (sell). */
  quote(o: { symbol: string; side: "buy" | "sell"; amount: string | number }): Promise<Quote> {
    const q = new URLSearchParams({ symbol: o.symbol.toUpperCase(), side: o.side, amount: String(o.amount) });
    return this.request("GET", `/v1/quote?${q}`);
  }
  /** Unsigned approve + swap to send from your own wallet. Costs 2 calls. */
  buildTrade(o: { symbol: string; side: "buy" | "sell"; amount: string | number; recipient: string; slippageBps?: number }): Promise<TradeBuild> {
    if (!ADDRESS.test(o.recipient)) throw new TypeError("recipient must be an address: 0x + 40 hex");
    return this.request("POST", "/v1/trade/build", { ...o, symbol: o.symbol.toUpperCase(), amount: String(o.amount) });
  }
  portfolio(address: string): Promise<Portfolio> {
    if (!ADDRESS.test(address)) throw new TypeError("address must be 0x + 40 hex");
    return this.request("GET", `/v1/portfolio/${address}`);
  }
  async corporateActions(symbol?: string): Promise<CorporateAction[]> {
    return (await this.request<{ actions: CorporateAction[] }>("GET", `/v1/corporate-actions${symbol ? `?symbol=${this.sym(symbol)}` : ""}`)).actions;
  }
  research(symbol: string, opts: { filings?: number } = {}): Promise<Research> {
    return this.request("GET", `/v1/research/${this.sym(symbol)}${opts.filings ? `?filings=${opts.filings}` : ""}`);
  }
  /** Newest Pons launches, each with how many launches in the window reuse its ticker. */
  markets(opts: { hours?: number; limit?: number } = {}): Promise<Markets> {
    const q = new URLSearchParams();
    if (opts.hours !== undefined) q.set("hours", String(opts.hours));
    if (opts.limit !== undefined) q.set("limit", String(opts.limit));
    return this.request("GET", `/v1/markets${[...q].length ? "?" + q : ""}`);
  }
  /** A 7-day webhook alert. Keep the returned id and webhookSecret: they are shown only once. */
  createAlert(o: { symbol: string; metric: AlertMetric; op: "above" | "below"; value: number; webhookUrl: string }): Promise<{ alert: Alert; webhookSecret: string }> {
    return this.request("POST", "/v1/alerts", { ...o, symbol: o.symbol.toUpperCase() });
  }
  async alert(id: string): Promise<Alert> {
    return (await this.request<{ alert: Alert }>("GET", `/v1/alerts/${encodeURIComponent(id)}`)).alert;
  }
  async deleteAlert(id: string): Promise<void> {
    await this.request("DELETE", `/v1/alerts/${encodeURIComponent(id)}`);
  }
  pricing(): Promise<Pricing> {
    return this.request("GET", "/v1/pricing");
  }
}

/** Checks an alert webhook: header equito-signature "t=<unix>,v1=<hex>" over "<t>.<raw body>" with your webhookSecret. */
export async function verifyWebhook(rawBody: string, signatureHeader: string, secret: string, maxAgeSeconds = 300, nowMs = Date.now()): Promise<boolean> {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader.trim());
  if (!m) return false;
  const t = Number(m[1]);
  if (Math.abs(nowMs / 1000 - t) > maxAgeSeconds) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${t}.${rawBody}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= hex.charCodeAt(i) ^ m[2].charCodeAt(i);
  return diff === 0;
}
