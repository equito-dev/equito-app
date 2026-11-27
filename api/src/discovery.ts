// Agent discovery: GET /, /llms.txt, /openapi.json (also /v1/openapi.json) and /.well-known/x402.
// Every document is built from CATALOG below and the real constants in x402.ts, so the docs cannot drift from the code.
// Links use the origin the request came in on, so the same build works on api.equito.pro and the temporary host.
import { SITE_URL } from "./hosts.ts";
import { DEFAULT_FACILITATOR, FREE_CALLS_PER_DAY, NETWORK, UNIT_AMOUNT, UNIT_USD, USDG, X402_VERSION, amountFor, requirementsFor, callPrice } from "./x402.ts";
import { json } from "./http.ts";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const VERSION = "0.2.0";
export const DESCRIPTION =
  `Stock token data for AI agents on Robinhood Chain (chain 4663): every token, live prices, the DEX premium over the real stock, pool depth, candles, wallet portfolios, corporate actions, Uniswap quotes and unsigned trades. ${FREE_CALLS_PER_DAY} free calls a day per IP, then ${callPrice()} a call in USDG over x402. Equito never holds keys, signs or sends a transaction.`;

type Param = { name: string; in: "path" | "query"; required: boolean; description: string; example: string; enum?: string[] };
export type Entry = {
  method: "GET" | "POST" | "DELETE";
  path: string; // under /v1
  summary: string;
  units: number; // call units this costs, UNIT_USD each (0 = free)
  params?: Param[];
  body?: Record<string, unknown>; // JSON schema of a POST body
  example: string; // a concrete path (with query) that always works, used for the paid listing
  tool: string; // MCP tool name
};

const symbol: Param = { name: "symbol", in: "path", required: true, description: "Stock token ticker, e.g. NVDA", example: "NVDA" };

export const CATALOG: Entry[] = [
  { method: "GET", path: "/assets", summary: "Every stock token on Robinhood Chain: symbol, name, contract, multiplier, status, trading capabilities.", units: 1, example: "/assets", tool: "list_assets" },
  { method: "GET", path: "/assets/{symbol}", summary: "One stock token's registry entry.", units: 1, params: [symbol], example: "/assets/NVDA", tool: "get_asset" },
  { method: "GET", path: "/prices/{symbol}", summary: "Robinhood's token bid/ask (already times the multiplier), the real stock's bid/ask, daily high/low/volume and trading halt flag.", units: 1, params: [symbol], example: "/prices/NVDA", tool: "get_price" },
  { method: "GET", path: "/stats/{symbol}", summary: "Live: Uniswap v3 price vs Robinhood's price (premiumPct), every USDG pool's depth, supply and market cap. Falls back to the last collector run (live: false) when the chain cannot be read.", units: 1, params: [symbol], example: "/stats/NVDA", tool: "get_stats" },
  {
    method: "GET", path: "/stats", summary: "Every token from the last collector run (about hourly): price, DEX price, premium, liquidity.", units: 1, tool: "list_stats", example: "/stats",
    params: [{ name: "sort", in: "query", required: false, description: "liquidity (default), premium or symbol", example: "liquidity", enum: ["liquidity", "premium", "symbol"] }],
  },
  {
    method: "GET", path: "/history/{symbol}", summary: "Candles of Robinhood's token price with the DEX close and pool depth per bucket, from the collector's points.", units: 1, tool: "get_history", example: "/history/NVDA?interval=1h&days=7",
    params: [symbol, { name: "interval", in: "query", required: false, description: "1h (default), 4h or 1d", example: "1h", enum: ["1h", "4h", "1d"] }, { name: "days", in: "query", required: false, description: "1 to 90, default 7", example: "7" }],
  },
  {
    method: "GET", path: "/quote", summary: "A real Uniswap v3 quote through QuoterV2 on the best USDG pool: amount out, effective price, price impact, gap to Robinhood's price.", units: 1, tool: "get_quote", example: "/quote?symbol=NVDA&side=buy&amount=100",
    params: [
      { name: "symbol", in: "query", required: true, description: "Stock token ticker", example: "NVDA" },
      { name: "side", in: "query", required: true, description: "buy (spend USDG) or sell (spend tokens)", example: "buy", enum: ["buy", "sell"] },
      { name: "amount", in: "query", required: true, description: "USDG to spend when buying, tokens to sell when selling", example: "100" },
    ],
  },
  {
    method: "POST", path: "/trade/build", summary: "Unsigned approve + swap for SwapRouter02 with a slippage floor and a 10 minute deadline. Send them yourself, in order, from the wallet that holds the input. Equito never signs or sends.", units: 2, tool: "build_trade", example: "/trade/build",
    body: {
      type: "object",
      required: ["symbol", "side", "amount", "recipient"],
      properties: {
        symbol: { type: "string", description: "Stock token ticker" },
        side: { type: "string", enum: ["buy", "sell"] },
        amount: { type: "string", description: "USDG to spend (buy) or tokens to sell (sell)" },
        recipient: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$", description: "Wallet that receives the output" },
        slippageBps: { type: "integer", minimum: 1, maximum: 500, description: "Default 50 (0.5%)" },
      },
    },
  },
  {
    method: "GET", path: "/portfolio/{address}", summary: "Every stock token a wallet holds, valued at Robinhood's live price, plus its USDG.", units: 1, tool: "get_portfolio", example: "/portfolio/0x759Cf0e19d45c1dCA28977703b69Fd93a3f6a136",
    params: [{ name: "address", in: "path", required: true, description: "Wallet address, 0x + 40 hex", example: "0x759Cf0e19d45c1dCA28977703b69Fd93a3f6a136" }],
  },
  {
    method: "GET", path: "/corporate-actions", summary: "Dividends, splits and other events that change a token's multiplier, from Robinhood.", units: 1, tool: "corporate_actions", example: "/corporate-actions",
    params: [{ name: "symbol", in: "query", required: false, description: "Only this ticker", example: "NVDA" }],
  },
  {
    method: "GET", path: "/research/{symbol}", summary: "The company behind a stock token, from SEC EDGAR: name, industry, shares outstanding, latest annual and quarterly revenue, net income, EPS, assets, liabilities, cash, operating cash flow, and recent filings with links.", units: 1, tool: "get_research", example: "/research/NVDA",
    params: [symbol, { name: "filings", in: "query", required: false, description: "How many recent filings, 1 to 40, default 10", example: "10" }],
  },
  {
    method: "GET", path: "/markets", summary: "Newest Pons launches on Robinhood Chain (token, ticker, pool, creator, time), each with how many launches in the window reuse its ticker. From the collector, about hourly.", units: 1, tool: "list_launches", example: "/markets?hours=24&limit=50",
    params: [
      { name: "hours", in: "query", required: false, description: "1 to 168, default 24", example: "24" },
      { name: "limit", in: "query", required: false, description: "1 to 200, default 50", example: "50" },
    ],
  },
  {
    method: "POST", path: "/alerts", summary: "A 7-day webhook alert: when a token's metric crosses your value, Equito POSTs a signed JSON message (equito-signature: t=..,v1=HMAC-SHA256). Checked about hourly. Returns the id and the webhook secret once.", units: 1, tool: "create_alert", example: "/alerts",
    body: {
      type: "object",
      required: ["symbol", "metric", "op", "value", "webhookUrl"],
      properties: {
        symbol: { type: "string", description: "Stock token ticker" },
        metric: { type: "string", enum: ["token_price", "dex_price", "premium_pct", "liquidity_usd"] },
        op: { type: "string", enum: ["above", "below"] },
        value: { type: "number", description: "Percent for premium_pct, USD otherwise" },
        webhookUrl: { type: "string", description: "Public https URL that receives the alert" },
      },
    },
  },
  {
    method: "GET", path: "/alerts/{id}", summary: "An alert's state: met or not, last value, times fired, last webhook status. Free.", units: 0, tool: "get_alert", example: "/alerts/{id}",
    params: [{ name: "id", in: "path", required: true, description: "al_ + 32 hex, from create_alert", example: "al_00000000000000000000000000000000" }],
  },
  {
    method: "DELETE", path: "/alerts/{id}", summary: "Stop an alert. Free.", units: 0, tool: "delete_alert", example: "/alerts/{id}",
    params: [{ name: "id", in: "path", required: true, description: "al_ + 32 hex", example: "al_00000000000000000000000000000000" }],
  },
];

export const PAID_PREFIX = "/v1/paid";

const priceText = callPrice;

export function apiIndex(origin: string) {
  return {
    name: "Equito API",
    description: DESCRIPTION,
    version: VERSION,
    endpoints: CATALOG.map((e) => `${e.method} /v1${e.path}`).concat("GET /v1/pricing"),
    llms: origin + "/llms.txt",
    openapi: origin + "/openapi.json",
    x402: origin + "/.well-known/x402",
    agentCard: origin + "/.well-known/agent.json",
    status: origin + "/status",
    mcp: origin + "/mcp",
    docs: SITE_URL + "/docs",
  };
}

export function llmsTxt(origin: string): string {
  const lines = CATALOG.map((e) => `- ${e.method} ${origin}/v1${e.path}: ${e.summary} (${e.units === 1 ? "1 call" : `${e.units} calls`}, ${priceText(e.units)} when paid)`).join("\n");
  return `# Equito

> ${DESCRIPTION}

## Connect
- REST: ${origin}/v1 (CORS open, no API key, no signup)
- Remote MCP (POST, stateless JSON-RPC): ${origin}/mcp
- OpenAPI 3.1: ${origin}/openapi.json
- x402 listing: ${origin}/.well-known/x402
- A2A agent card: ${origin}/.well-known/agent.json
- Status: ${origin}/status

## Quick start
\`\`\`bash
curl ${origin}/v1/stats/NVDA
curl "${origin}/v1/quote?symbol=NVDA&side=buy&amount=100"
\`\`\`

## Endpoints
${lines}
- GET ${origin}/v1/pricing: free. Price, free calls, asset, network, payTo, facilitator, holder price.
- GET ${origin}/v1/holder?address=0x...: free. Does this wallet get the holder price right now (live balance read)? 404 holder_price_off until $EQUITO launches.

## Paying (x402 v${X402_VERSION})
- ${FREE_CALLS_PER_DAY} free calls per caller IP per UTC day (header x-free-calls-left), counted only when the answer is 2xx.
- After that a call answers 402 with the terms in the body and, base64, in the PAYMENT-REQUIRED header: ${UNIT_AMOUNT} base units of USDG (${USDG}, 6 decimals) = ${priceText(1)} per call, scheme exact, network ${NETWORK}, facilitator ${DEFAULT_FACILITATOR}. trade/build costs 2 calls.
- Sign what the 402 asks for and repeat the call with the base64 payload in PAYMENT-SIGNATURE. You are charged only when the answer is 2xx; the answer then carries PAYMENT-RESPONSE with the transaction.
- ${origin}${PAID_PREFIX}/... is the same API with no free tier: it answers 402 until paid (this is what the x402 listing points at).
- Holders of the $EQUITO token pay half once the token is live: send x-holder: <your address> and pay from that address.

## Numbers
- tokenPrice is Robinhood's price for one token (its own token bid/ask, already times the multiplier).
- dexPrice is the deepest Uniswap v3 USDG pool. A pool counts only with in-range liquidity, both tokens inside and a price within 10x of Robinhood's.
- premiumPct = dexPrice / tokenPrice - 1, in percent. Positive means the token costs more on chain.
- /stats and /history come from a collector that runs about once an hour; every answer says when (updatedAt).

## Safety
Equito never holds keys and never signs or sends anything. trade/build returns unsigned transactions; check them before you sign. Data, not investment advice.
`;
}

export function x402Listing(origin: string, env: { X402_PAY_TO?: string }) {
  const payTo = env.X402_PAY_TO ?? "";
  if (!ADDRESS.test(payTo)) return { version: 1, description: DESCRIPTION, resources: [], items: [] };
  const items = CATALOG.filter((e) => e.units > 0).map((e) => {
    const url = origin + PAID_PREFIX + e.example;
    return {
      resource: url,
      type: "http",
      x402Version: X402_VERSION,
      accepts: [requirementsFor(payTo, amountFor(e.units))],
      metadata: { method: e.method, description: e.summary, mimeType: "application/json", ...(e.body ? { input: e.body } : {}) },
    };
  });
  return { version: 1, description: DESCRIPTION, resources: items.map((i) => i.resource), items };
}


// A2A agent card (/.well-known/agent.json): one skill per paid endpoint, plus the REST and MCP interfaces.
export function agentCard(origin: string) {
  const tags: Record<string, string[]> = {
    list_assets: ["registry"], get_asset: ["registry"], get_price: ["prices"], get_stats: ["dex", "premium", "liquidity"],
    list_stats: ["dex", "premium"], get_history: ["candles"], get_quote: ["uniswap", "quote"], build_trade: ["uniswap", "trade"],
    get_portfolio: ["wallet"], corporate_actions: ["dividends", "splits"], get_research: ["sec", "fundamentals"],
    list_launches: ["pons", "launches"], create_alert: ["webhook", "alerts"],
  };
  return {
    protocolVersion: "0.3.0",
    name: "Equito",
    description: DESCRIPTION,
    url: origin + "/v1",
    preferredTransport: "HTTP+JSON",
    additionalInterfaces: [
      { url: origin + "/v1", transport: "HTTP+JSON" },
      { url: origin + "/mcp", transport: "MCP-STREAMABLE-HTTP" },
    ],
    provider: { organization: "Equito", url: SITE_URL },
    version: VERSION,
    documentationUrl: origin + "/llms.txt",
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ["application/json"],
    defaultOutputModes: ["application/json"],
    skills: CATALOG.filter((e) => e.units > 0).map((e) => ({
      id: e.tool,
      name: e.tool.replace(/_/g, " "),
      description: `${e.summary} ${e.method} /v1${e.path}. ${FREE_CALLS_PER_DAY} free calls a day per IP, then ${priceText(e.units)} in USDG over x402.`,
      tags: ["robinhood-chain", "stock-tokens", "x402", ...(tags[e.tool] ?? [])],
      examples: [`${e.method} ${origin}/v1${e.example}`],
      inputModes: ["application/json"],
      outputModes: ["application/json"],
    })),
  };
}

const str = { type: "string" };
export function openApi(origin: string) {
  const errorRef = { $ref: "#/components/schemas/Error" };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of CATALOG) {
    const op = {
      operationId: e.tool,
      summary: e.summary,
      parameters: [
        ...(e.params ?? []).map((p) => ({ name: p.name, in: p.in, required: p.required, description: p.description, schema: { type: "string", ...(p.enum ? { enum: p.enum } : {}) }, example: p.example })),
        { name: "PAYMENT-SIGNATURE", in: "header", required: false, description: "base64 x402 v2 payment payload (after the free calls)", schema: str },
        { name: "x-holder", in: "header", required: false, description: "Your address, for the holder price once $EQUITO is live", schema: str },
      ],
      ...(e.body ? { requestBody: { required: true, content: { "application/json": { schema: e.body } } } } : {}),
      ...(e.units > 0 ? { "x-payment": { protocol: "x402", version: X402_VERSION, scheme: "exact", network: NETWORK, asset: USDG, amount: amountFor(e.units), priceUsd: UNIT_USD * e.units, freeCallsPerDay: FREE_CALLS_PER_DAY } } : {}),
      responses: {
        "200": { description: "OK", content: { "application/json": { schema: { type: "object" } } } },
        "400": { description: "Invalid input", content: { "application/json": { schema: errorRef } } },
        "402": { description: "Payment required (x402 v2). Same JSON base64 in the PAYMENT-REQUIRED header.", headers: { "PAYMENT-REQUIRED": { schema: str } } },
        "404": { description: "Unknown symbol or no pool", content: { "application/json": { schema: errorRef } } },
        "502": { description: "An upstream (Robinhood or the chain) could not be read; nothing charged", content: { "application/json": { schema: errorRef } } },
      },
    };
    paths["/v1" + e.path] = { ...(paths["/v1" + e.path] ?? {}), [e.method.toLowerCase()]: op };
  }
  paths["/v1/pricing"] = { get: { operationId: "get_pricing", summary: "Price, free calls, asset, network, payTo, facilitator, holder price. Free.", responses: { "200": { description: "OK" } } } };
  return {
    openapi: "3.1.0",
    info: { title: "Equito API", version: VERSION, description: DESCRIPTION },
    servers: [{ url: origin }],
    paths,
    components: {
      schemas: {
        Error: { type: "object", properties: { error: { type: "object", properties: { code: str, message: str } } } },
      },
    },
  };
}

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

export function discovery(req: Request, env: { X402_PAY_TO?: string }): Response | null {
  if (req.method !== "GET" && req.method !== "HEAD") return null;
  const url = new URL(req.url);
  const origin = url.origin;
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const text = (body: string, type: string) =>
    new Response(req.method === "HEAD" ? null : body, { status: 200, headers: { "content-type": type, "access-control-allow-origin": "*", "cache-control": "public, max-age=300" } });
  switch (path) {
    case "/":
      return json(200, apiIndex(origin));
    case "/llms.txt":
      return text(llmsTxt(origin), "text/plain; charset=utf-8");
    case "/openapi.json":
    case "/v1/openapi.json":
      return text(pretty(openApi(origin)), "application/json; charset=utf-8");
    case "/.well-known/agent.json":
      return text(pretty(agentCard(origin)), "application/json; charset=utf-8");
    case "/.well-known/x402":
      return text(pretty(x402Listing(origin, env)), "application/json; charset=utf-8");
    default:
      return null;
  }
}
