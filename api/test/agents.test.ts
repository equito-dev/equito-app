import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, FreeTier, type Env } from "../src/worker.ts";
import { CATALOG } from "../src/discovery.ts";
import { fromBase64 } from "../src/x402.ts";

const PAY_TO = "0x759Cf0e19d45c1dCA28977703b69Fd93a3f6a136";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";

const f = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/rhj/assets")) return Response.json({ assets: [{ tokenSymbol: "NVDA", tokenName: "NVIDIA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: 1 }] });
  if (url.endsWith("/rhj/prices/NVDA")) return Response.json({ quotes: [{ tokenSymbol: "NVDA", bid: "150", ask: "152" }] });
  throw new Error("unexpected " + url);
}) as typeof fetch;

function freeNamespace() {
  const objects = new Map<string, FreeTier>();
  return {
    idFromName: (n: string) => n,
    get: (id: unknown) => {
      const k = String(id);
      if (!objects.has(k)) {
        const store = new Map<string, unknown>();
        objects.set(k, new FreeTier({ storage: { get: (x: string) => store.get(x), put: (x: string, v: unknown) => void store.set(x, v) } }));
      }
      return objects.get(k)!;
    },
  };
}

const env = (): Env => ({ FREE: freeNamespace(), X402_PAY_TO: PAY_TO, PRIORS_API_KEY: "k", FACILITATOR_URL: "https://facilitator.test" });
const app = createApp({ fetch: f });
const get = (path: string) => new Request("https://api.equito.pro" + path, { headers: { "cf-connecting-ip": "198.51.100.9" } });
const rpc = (body: unknown) => new Request("https://api.equito.pro/mcp", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "198.51.100.9" }, body: JSON.stringify(body) });

test("llms.txt, openapi.json and the index describe every endpoint with links on the caller's origin", async () => {
  const llms = await (await app(get("/llms.txt"), env())).text();
  for (const e of CATALOG) assert.ok(llms.includes("/v1" + e.path), e.path);
  assert.ok(llms.includes("https://api.equito.pro/mcp"));
  const spec = (await (await app(get("/openapi.json"), env())).json()) as any;
  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.servers[0].url, "https://api.equito.pro");
  assert.equal(spec.paths["/v1/trade/build"].post["x-payment"].amount, "40000");
  assert.equal(spec.paths["/v1/stats/{symbol}"].get["x-payment"].amount, "20000");
  const index = (await (await app(get("/"), env())).json()) as any;
  assert.equal(index.mcp, "https://api.equito.pro/mcp");
});

test("the x402 listing points at the paid paths, and is empty until a pay-to wallet is set", async () => {
  const listing = (await (await app(get("/.well-known/x402"), env())).json()) as any;
  assert.equal(listing.items.length, CATALOG.filter((e) => e.units > 0).length);
  assert.ok(!listing.resources.some((r: string) => r.includes("{id}")));
  assert.ok(listing.resources.every((r: string) => r.startsWith("https://api.equito.pro/v1/paid/")));
  assert.equal(listing.items.find((i: any) => i.resource.endsWith("/trade/build")).accepts[0].amount, "40000");
  const off = (await (await app(get("/.well-known/x402"), {})).json()) as any;
  assert.deepEqual(off.resources, []);
});

test("/v1/paid/... skips the free tier: 402 on the first call, with the same handler behind it", async () => {
  const e = env();
  const paid = await app(get("/v1/paid/assets"), e);
  assert.equal(paid.status, 402);
  assert.equal((fromBase64(paid.headers.get("payment-required")!) as any).accepts[0].payTo, PAY_TO);
  const free = await app(get("/v1/assets"), e);
  assert.equal(free.status, 200); // the paid call did not use a free slot
  assert.equal(free.headers.get("x-free-calls-left"), "49");
  assert.equal((await app(get("/v1/paid/nope"), e)).status, 404);
});

test("MCP: initialize, tools/list with one tool per endpoint, and tools/call through the metered API", async () => {
  const e = env();
  const init = (await (await app(rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }), e)).json()) as any;
  assert.equal(init.result.serverInfo.name, "equito");
  assert.equal(init.result.protocolVersion, "2025-06-18");
  const list = (await (await app(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }), e)).json()) as any;
  const names = list.result.tools.map((t: any) => t.name);
  for (const c of CATALOG) assert.ok(names.includes(c.tool), c.tool);
  const call = (await (await app(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_price", arguments: { symbol: "NVDA" } } }), e)).json()) as any;
  assert.equal(call.result.isError, undefined);
  assert.equal(call.result.structuredContent.tokenPrice, 151);
  const bad = (await (await app(rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_price", arguments: {} } }), e)).json()) as any;
  assert.equal(bad.error.code, -32602);
  const unknown = (await (await app(rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get_asset", arguments: { symbol: "ZZZZ" } } }), e)).json()) as any;
  assert.equal(unknown.result.isError, true);
  assert.match(unknown.result.content[0].text, /unknown_symbol/);
});

test("MCP: past the free calls a tool answers with payment instructions and the 402 terms", async () => {
  const e = env();
  for (let i = 0; i < 50; i++) await app(get("/v1/assets"), e);
  const r = (await (await app(rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "list_assets", arguments: {} } }), e)).json()) as any;
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /payment_signature/);
  assert.equal(r.result.structuredContent.accepts[0].amount, "20000");
});

test("MCP transport: notifications get 202, GET is 405, bad JSON is a parse error", async () => {
  assert.equal((await app(rpc({ jsonrpc: "2.0", method: "notifications/initialized" }), env())).status, 202);
  assert.equal((await app(get("/mcp"), env())).status, 405);
  const bad = await app(new Request("https://api.equito.pro/mcp", { method: "POST", body: "{nope" }), env());
  assert.equal(bad.status, 400);
  assert.equal(((await bad.json()) as any).error.code, -32700);
});
