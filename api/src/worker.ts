// Equito API Worker (api.equito.pro). Free: /, /health, /v1/pricing. Metered (50 free a day per IP, then UNIT_USD a call
// over x402, twice that for trade/build): everything else under /v1.
import { ApiError, CORS, fail, json } from "./http.ts";
import { Chain, rpcUrls } from "./chain.ts";
import { holderCheck, holderConfig } from "./holder.ts";
import { getAsset, getCorporateActions, getPrice, listAssets } from "./market.ts";
import { FreeTier, callerKey, meter, pricing, type MeterEnv } from "./metering.ts";
import { getPortfolio, getQuote, getStats, postTradeBuild } from "./onchain.ts";
import { Robinhood } from "./robinhood.ts";
import { checkSymbol } from "./market.ts";
import { getBoard, getHistory, getMarkets, getOverview, listStats, postLaunches, postSnapshot, type D1Like } from "./store.ts";
import { checkAlerts, createAlert, deleteAlert, getAlert } from "./alerts.ts";
import { PAID_PREFIX, discovery } from "./discovery.ts";
import { handleMcp } from "./mcp.ts";
import { Edgar, getResearch } from "./research.ts";
import { getStatus } from "./status.ts";
import { HOLDER_DISCOUNT_PCT, holderBalance } from "./holder.ts";

export { FreeTier };

// RPC_URLS: comma list of private nodes (Chainstack, Alchemy), tried in turn; the public node is always the last resort.
// DB: collector snapshots (D1). INGEST_KEY: the key the GitHub Actions collector sends to POST /internal/snapshot.
// CONTACT_EMAIL: the product contact SEC EDGAR requires in the User-Agent; /v1/research is off without it.
export type Env = MeterEnv & { RPC_URLS?: string; RPC_URL?: string; DB?: D1Like; INGEST_KEY?: string; CONTACT_EMAIL?: string };

type Ctx = { rh: Robinhood; chain: Chain; req: Request; url: URL; now: () => number; db?: D1Like; edgar: Edgar; contact?: string };
type Route = { units: number; run: (c: Ctx) => Promise<Response> };

export const ENDPOINTS = [
  "GET /v1/assets",
  "GET /v1/assets/{symbol}",
  "GET /v1/prices/{symbol}",
  "GET /v1/stats?sort=liquidity|premium|symbol",
  "GET /v1/stats/{symbol}",
  "GET /v1/history/{symbol}?interval=1h|4h|1d&days=",
  "GET /v1/quote?symbol=&side=buy|sell&amount=",
  "POST /v1/trade/build",
  "GET /v1/portfolio/{address}",
  "GET /v1/corporate-actions?symbol=",
  "GET /v1/pricing",
];

function match(method: string, path: string): Route | null {
  if (method === "POST") {
    if (path === "/v1/trade/build") return { units: 2, run: (c) => postTradeBuild(c.rh, c.chain, c.req, c.now) };
    if (path === "/v1/alerts") return { units: 1, run: (c) => createAlert(c.db, c.req, callerKey(c.req), c.now, async (s) => (await c.rh.asset(s)) !== null) };
    return null;
  }
  if (method !== "GET") return null;
  if (path === "/v1/assets") return { units: 1, run: (c) => listAssets(c.rh) };
  if (path === "/v1/quote") return { units: 1, run: (c) => getQuote(c.rh, c.chain, c.url) };
  if (path === "/v1/corporate-actions") return { units: 1, run: (c) => getCorporateActions(c.rh, c.url) };
  if (path === "/v1/stats") return { units: 1, run: (c) => listStats(c.db, c.url) };
  if (path === "/v1/markets") return { units: 1, run: (c) => getMarkets(c.db, c.url, c.now) };
  const one = (prefix: string) => path.match(new RegExp(`^/v1/${prefix}/([^/]+)$`))?.[1] ?? null;
  let p: string | null;
  if ((p = one("assets"))) { const v = p; return { units: 1, run: (c) => getAsset(c.rh, v) }; }
  if ((p = one("prices"))) { const v = p; return { units: 1, run: (c) => getPrice(c.rh, v) }; }
  if ((p = one("stats"))) { const v = p; return { units: 1, run: (c) => getStats(c.rh, c.chain, v, c.db) }; }
  if ((p = one("history"))) { const v = p; return { units: 1, run: (c) => getHistory(c.db, checkSymbol(v), c.url, c.now) }; }
  if ((p = one("portfolio"))) { const v = p; return { units: 1, run: (c) => getPortfolio(c.rh, c.chain, v) }; }
  if ((p = one("research"))) {
    const v = p;
    return {
      units: 1,
      run: async (c) => {
        const symbol = checkSymbol(v);
        if (!(await c.rh.asset(symbol))) throw new ApiError(404, "unknown_symbol", `${symbol} is not a stock token on Robinhood Chain. GET /v1/assets lists them all.`);
        return getResearch(c.edgar, symbol, c.contact, c.url);
      },
    };
  }
  return null;
}

// Turns ApiError into its JSON answer; anything else is a plain 500 with no detail.
async function safe(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof ApiError) return fail(err.status, err.code, err.message);
    console.error("unhandled", err instanceof Error ? err.message : "unknown");
    return fail(500, "internal", "Something went wrong on our side.");
  }
}


// GET /v1/holder?address=0x...: free. One live balanceOf on $EQUITO; 404 holder_price_off until the token launches.
async function holderLookup(env: Env, url: URL, f: typeof fetch): Promise<Response> {
  const cfg = holderConfig(env);
  if (!cfg) throw new ApiError(404, "holder_price_off", "The holder price starts when $EQUITO launches.");
  const address = (url.searchParams.get("address") ?? "").trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ApiError(400, "invalid_address", "Send ?address=0x... with 40 hex characters.");
  const balance = await holderBalance(rpcUrls(env.RPC_URLS, env.RPC_URL)[0], cfg, f)(address);
  if (balance === null) throw new ApiError(502, "chain_unavailable", "The token balance could not be read just now. Try again.");
  return json(200, {
    token: cfg.token, network: "eip155:4663", discountPct: HOLDER_DISCOUNT_PCT, minBalance: String(cfg.minBalance),
    address: address.toLowerCase(), balance: String(balance), holder: balance >= cfg.minBalance,
  });
}

export function createApp(deps: { fetch: typeof fetch; now?: () => number }) {
  const now = deps.now ?? Date.now;
  // One registry client per isolate, so its cache is shared by every request this isolate serves.
  const rh = new Robinhood(deps.fetch, now);
  const edgar = new Edgar(deps.fetch, now);
  return async function handle(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // GET /, /llms.txt, /openapi.json, /.well-known/x402
    const doc = discovery(req, env);
    if (doc) return doc;
    // Remote MCP: each tool calls this same handler, so metering and payment work exactly as over REST.
    if (path === "/mcp") return handleMcp(req, (r) => handle(r, env));
    if (req.method === "GET" && path === "/health") return json(200, { ok: true });
    if (req.method === "GET" && path === "/v1/pricing") return pricing(env);
    // The website's own summary: free and cached, so visitors never spend their free calls.
    if (req.method === "GET" && path === "/status") {
      return safe(() => getStatus(env, { chain: new Chain(rpcUrls(env.RPC_URLS, env.RPC_URL), deps.fetch), rh, fetch: deps.fetch, now }));
    }
    if (req.method === "GET" && path === "/v1/holder") return safe(() => holderLookup(env, url, deps.fetch));
    if (req.method === "GET" && path === "/public/board") return safe(() => getBoard(env.DB, now));
    if (req.method === "GET" && path === "/public/overview") return safe(() => getOverview(env.DB, now));
    // The collector's own door: not metered, guarded by INGEST_KEY.
    if (req.method === "POST" && path === "/internal/snapshot") {
      return safe(async () => {
        const res = await postSnapshot(env.DB, env.INGEST_KEY, req, now);
        // New numbers in: check every alert on them (webhooks go out here).
        if (res.ok && env.DB) {
          const r = await checkAlerts(env.DB, deps.fetch, now).catch((e) => (console.error("alerts", e instanceof Error ? e.message : "unknown"), null));
          if (r) return json(200, { ...((await res.json()) as object), alerts: r });
        }
        return res;
      });
    }
    if (req.method === "POST" && path === "/internal/launches") return safe(() => postLaunches(env.DB, env.INGEST_KEY, req, now));
    // Reading or deleting an alert is free: the id is the key.
    const alertId = path.match(/^\/v1\/alerts\/([^/]+)$/)?.[1];
    if (alertId && req.method === "GET") return safe(() => getAlert(env.DB, alertId));
    if (alertId && req.method === "DELETE") return safe(() => deleteAlert(env.DB, alertId));

    // /v1/paid/... is the same API with no free tier (402 until paid): the URLs x402 directories list.
    const paidOnly = path.startsWith(PAID_PREFIX + "/");
    const route = match(req.method, paidOnly ? "/v1" + path.slice(PAID_PREFIX.length) : path);
    if (!route) return fail(404, "not_found", "No such endpoint. GET / lists them.");

    const urls = rpcUrls(env.RPC_URLS, env.RPC_URL);
    const chain = new Chain(urls, deps.fetch);
    const cfg = holderConfig(env);
    const isHolder = cfg ? holderCheck(urls[0], cfg, deps.fetch) : undefined;
    const ctx: Ctx = { rh, chain, req, url, now, db: env.DB, edgar, contact: env.CONTACT_EMAIL };
    return safe(() => meter(req, env, route.units, () => safe(() => route.run(ctx)), { fetch: deps.fetch, isHolder }, paidOnly));
  };
}

const app = createApp({ fetch: (input, init) => fetch(input, init) });

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return app(req, env);
  },
};
