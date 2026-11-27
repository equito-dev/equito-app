// The SDK against the real API code in this repo (api/src), with fake upstreams: no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createApp, FreeTier, type Env } from "../../api/src/worker.ts";
import { Equito, EquitoError, verifyWebhook } from "../src/index.ts";

const PAY_TO = "0x759Cf0e19d45c1dCA28977703b69Fd93a3f6a136";
const PAYER = "0x1111111111111111111111111111111111111111";
const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";

const upstream = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/rhj/assets")) return Response.json({ assets: [{ tokenSymbol: "NVDA", tokenName: "NVIDIA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: 1 }] });
  if (url.endsWith("/rhj/prices/NVDA")) return Response.json({ quotes: [{ tokenSymbol: "NVDA", bid: "150", ask: "152", tokenBid: "150", tokenAsk: "152" }] });
  if (url.endsWith("/verify")) return Response.json({ isValid: true, payer: PAYER });
  if (url.endsWith("/settle")) return Response.json({ success: true, transaction: "0xfeed", network: "eip155:4663", payer: PAYER });
  return new Response("nf", { status: 404 });
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

function client(opts: ConstructorParameters<typeof Equito>[0] = {}) {
  const env: Env = { FREE: freeNamespace(), X402_PAY_TO: PAY_TO, PRIORS_API_KEY: "k", FACILITATOR_URL: "https://facilitator.test" };
  const app = createApp({ fetch: upstream });
  const viaApp = ((input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    req.headers.set("cf-connecting-ip", "203.0.113.50");
    return app(req, env);
  }) as typeof fetch;
  return new Equito({ baseUrl: "https://api.equito.pro", fetch: viaApp, ...opts });
}

test("reads assets and prices and tracks the free calls left", async () => {
  const eq = client();
  const assets = await eq.assets();
  assert.equal(assets[0].symbol, "NVDA");
  assert.equal(eq.last.freeCallsLeft, 49);
  const p = await eq.price("nvda");
  assert.equal(p.tokenPrice, 151);
  assert.equal(eq.last.freeCallsLeft, 48);
});

test("API errors become EquitoError with the API's code", async () => {
  const eq = client();
  await assert.rejects(eq.asset("ZZZZ"), (e: unknown) => e instanceof EquitoError && e.status === 404 && e.code === "unknown_symbol");
  assert.throws(() => eq.price("<bad>"), TypeError);
});

test("past the free calls: EquitoError 402 with the terms when no pay function is given", async () => {
  const eq = client();
  for (let i = 0; i < 50; i++) await eq.assets();
  await assert.rejects(eq.assets(), (e: unknown) => e instanceof EquitoError && e.status === 402 && e.paymentRequired?.accepts[0].amount === "20000");
});

test("with pay, the SDK signs through your function and retries once; the answer carries the payment receipt", async () => {
  const seen: string[] = [];
  const eq = client({
    pay: async (req) => {
      seen.push(req.amount);
      // what an x402 client would build after signing with the wallet: the accepted terms plus the signed authorization
      return btoa(JSON.stringify({ x402Version: 2, accepted: req, payload: { authorization: { from: PAYER } } }));
    },
  });
  for (let i = 0; i < 50; i++) await eq.assets();
  const assets = await eq.assets();
  assert.equal(assets.length, 1);
  assert.deepEqual(seen, ["20000"]);
  assert.ok(eq.last.paymentResponse);
  assert.equal(JSON.parse(atob(eq.last.paymentResponse!)).transaction, "0xfeed");
});

test("verifyWebhook accepts Equito's signature and rejects a changed body or an old timestamp", async () => {
  const secret = "s".repeat(64);
  const body = JSON.stringify({ type: "equito.alert", value: 1.5 });
  const t = 1_800_000_000;
  const sig = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  assert.equal(await verifyWebhook(body, sig, secret, 300, t * 1000), true);
  assert.equal(await verifyWebhook(body + " ", sig, secret, 300, t * 1000), false);
  assert.equal(await verifyWebhook(body, sig, secret, 300, (t + 3600) * 1000), false);
});
