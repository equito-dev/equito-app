// Equito API Worker (api.equito.pro). Free: /, /health, /v1/pricing. Metered (50 free a day per IP, then $0.01 a call
// over x402, $0.02 for trade/build): everything else under /v1.
import { ApiError, CORS, fail, json } from "./http.ts";
import { Chain, rpcUrls } from "./chain.ts";
import { holderCheck, holderConfig } from "./holder.ts";
import { getAsset, getCorporateActions, getPrice, listAssets } from "./market.ts";
import { FreeTier, meter, pricing, type MeterEnv } from "./metering.ts";
import { getPortfolio, getQuote, getStats, postTradeBuild } from "./onchain.ts";
import { Robinhood } from "./robinhood.ts";
import { checkSymbol } from "./market.ts";
import { getHistory, listStats, postSnapshot, type D1Like } from "./store.ts";

export { FreeTier };

// RPC_URLS: comma list of private nodes (Chainstack, Alchemy), tried in turn; the public node is always the last resort.
// DB: collector snapshots (D1). INGEST_KEY: the key the GitHub Actions collector sends to POST /internal/snapshot.
export type Env = MeterEnv & { RPC_URLS?: string; RPC_URL?: string; DB?: D1Like; INGEST_KEY?: string };

type Ctx = { rh: Robinhood; chain: Chain; req: Request; url: URL; now: () => number; db?: D1Like };
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
  if (method === "POST") return path === "/v1/trade/build" ? { units: 2, run: (c) => postTradeBuild(c.rh, c.chain, c.req, c.now) } : null;
  if (method !== "GET") return null;
  if (path === "/v1/assets") return { units: 1, run: (c) => listAssets(c.rh) };
  if (path === "/v1/quote") return { units: 1, run: (c) => getQuote(c.rh, c.chain, c.url) };
  if (path === "/v1/corporate-actions") return { units: 1, run: (c) => getCorporateActions(c.rh, c.url) };
  if (path === "/v1/stats") return { units: 1, run: (c) => listStats(c.db, c.url) };
  const one = (prefix: string) => path.match(new RegExp(`^/v1/${prefix}/([^/]+)$`))?.[1] ?? null;
  let p: string | null;
  if ((p = one("assets"))) { const v = p; return { units: 1, run: (c) => getAsset(c.rh, v) }; }
  if ((p = one("prices"))) { const v = p; return { units: 1, run: (c) => getPrice(c.rh, v) }; }
  if ((p = one("stats"))) { const v = p; return { units: 1, run: (c) => getStats(c.rh, c.chain, v, c.db) }; }
  if ((p = one("history"))) { const v = p; return { units: 1, run: (c) => getHistory(c.db, checkSymbol(v), c.url, c.now) }; }
  if ((p = one("portfolio"))) { const v = p; return { units: 1, run: (c) => getPortfolio(c.rh, c.chain, v) }; }
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

export function createApp(deps: { fetch: typeof fetch; now?: () => number }) {
  const now = deps.now ?? Date.now;
  // One registry client per isolate, so its cache is shared by every request this isolate serves.
  const rh = new Robinhood(deps.fetch, now);
  return async function handle(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (req.method === "GET" && path === "/") {
      return json(200, {
        name: "Equito API",
        about: "Stock token data on Robinhood Chain. 50 free calls a day per IP, then $0.01 a call in USDG over x402 ($0.02 for trade/build).",
        endpoints: ENDPOINTS,
        docs: "https://docs.equito.pro",
      });
    }
    if (req.method === "GET" && path === "/health") return json(200, { ok: true });
    if (req.method === "GET" && path === "/v1/pricing") return pricing(env);
    // The collector's own door: not metered, guarded by INGEST_KEY.
    if (req.method === "POST" && path === "/internal/snapshot") return safe(() => postSnapshot(env.DB, env.INGEST_KEY, req, now));

    const route = match(req.method, path);
    if (!route) return fail(404, "not_found", "No such endpoint. GET / lists them.");

    const urls = rpcUrls(env.RPC_URLS, env.RPC_URL);
    const chain = new Chain(urls, deps.fetch);
    const cfg = holderConfig(env);
    const isHolder = cfg ? holderCheck(urls[0], cfg, deps.fetch) : undefined;
    const ctx: Ctx = { rh, chain, req, url, now, db: env.DB };
    return safe(() => meter(req, env, route.units, () => safe(() => route.run(ctx)), { fetch: deps.fetch, isHolder }));
  };
}

const app = createApp({ fetch: (input, init) => fetch(input, init) });

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return app(req, env);
  },
};
