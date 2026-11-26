import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type Env } from "../src/worker.ts";
import { CATALOG } from "../src/discovery.ts";

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const TOKEN = "0x2222222222222222222222222222222222222222";
const SECRET_RPC = "https://rpc.secret-node.test/key-abc123";

function fakeFetch(opts: { chainDown?: boolean; balance?: bigint } = {}) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/rhj/assets")) return Response.json({ assets: [{ tokenSymbol: "NVDA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: 1 }] });
    if (url.startsWith(SECRET_RPC) || url.startsWith("https://rpc.mainnet.chain.robinhood.com")) {
      if (opts.chainDown) throw new Error("down");
      const body = JSON.parse(String(init!.body));
      if (Array.isArray(body)) return Response.json(body.map((c: any) => ({ jsonrpc: "2.0", id: c.id, result: "0x10" })));
      return Response.json({ jsonrpc: "2.0", id: 1, result: "0x" + (opts.balance ?? 0n).toString(16) });
    }
    if (url.endsWith("/health")) return new Response("ok");
    throw new Error("unexpected " + url);
  }) as typeof fetch;
}

const get = (path: string) => new Request("https://api.equito.pro" + path);

test("GET /status reports each part without printing node URLs or keys", async () => {
  const env: Env = { RPC_URLS: SECRET_RPC, PRIORS_API_KEY: "test-facilitator-key-do-not-print" };
  const res = await createApp({ fetch: fakeFetch() })(get("/status"), env);
  const text = await res.text();
  assert.ok(!text.includes("secret-node") && !text.includes("key-abc123") && !text.includes("test-facilitator-key"));
  const b = JSON.parse(text);
  assert.equal(b.checks.chainRpc.ok, true);
  assert.equal(b.checks.robinhood.detail, "1 stock tokens listed");
  assert.equal(b.checks.database.ok, false); // no DB bound in this test: a critical failure
  assert.equal(res.status, 503);
  assert.equal(b.checks.research.ok, false);
  assert.equal(b.checks.holderPrice.detail, "off until the $EQUITO launch");
});

test("the A2A agent card lists one skill per paid endpoint and both interfaces", async () => {
  const card = (await (await createApp({ fetch: fakeFetch() })(get("/.well-known/agent.json"), {})).json()) as any;
  assert.equal(card.name, "Equito");
  assert.equal(card.skills.length, CATALOG.filter((e) => e.units > 0).length);
  assert.deepEqual(card.additionalInterfaces.map((i: any) => i.transport), ["HTTP+JSON", "MCP-STREAMABLE-HTTP"]);
});

test("GET /v1/holder is off before launch, then reads the balance live", async () => {
  const off = await createApp({ fetch: fakeFetch() })(get("/v1/holder?address=" + NVDA), {});
  assert.equal(off.status, 404);
  const env: Env = { HOLDER_TOKEN: TOKEN, HOLDER_MIN: "1000", RPC_URLS: SECRET_RPC };
  const yes = (await (await createApp({ fetch: fakeFetch({ balance: 5000n }) })(get("/v1/holder?address=" + NVDA), env)).json()) as any;
  assert.equal(yes.holder, true);
  assert.equal(yes.discountPct, 50);
  const no = (await (await createApp({ fetch: fakeFetch({ balance: 10n }) })(get("/v1/holder?address=" + NVDA), env)).json()) as any;
  assert.equal(no.holder, false);
  assert.equal((await createApp({ fetch: fakeFetch() })(get("/v1/holder?address=nope"), env)).status, 400);
});
