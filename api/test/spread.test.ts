// Robinhood's quote outside US market hours: the bid/ask spread opens up (GLD 331.50 / 500 on Saturday
// 2026-11-28) and the midpoint is not a price anyone trades at. Real quotes from that morning, kept in fixtures/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAX_SPREAD_PCT, parseQuote, tokenReference } from "../src/robinhood.ts";
import { createApp, type Env } from "../src/worker.ts";

const QUOTES = JSON.parse(readFileSync(new URL("./fixtures/rh-quotes-2026-11-28.json", import.meta.url), "utf8")) as Record<string, unknown>;
const quote = (s: string) => parseQuote(s, QUOTES[s])!;

test("a wide bid/ask spread gives no reference price; a tight one gives the midpoint", () => {
  for (const s of ["GLD", "HIMS", "LLY", "SLV", "JBL"]) {
    const r = tokenReference(quote(s), 1);
    assert.equal(r.price, null, `${s} spread ${r.spreadPct}% must not give a price`);
    assert.ok(r.spreadPct > MAX_SPREAD_PCT);
  }
  // Robinhood's own token bid/ask (here a hair above the stock's) is the one used.
  const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
  const nvda = tokenReference(quote("NVDA"), 1);
  assert.equal(r3(nvda.price), 149.921);
  assert.ok(nvda.spreadPct < 0.01);
  const sgov = tokenReference(quote("SGOV"), 1);
  assert.equal(r3(sgov.price), 101.684);
  // TSLA at 2.85%: inside the limit, so at most half the spread (1.4%) from any real trade.
  const tsla = tokenReference(quote("TSLA"), 1);
  assert.equal(tsla.price, 404.325);
  assert.equal(Math.round(tsla.spreadPct * 100) / 100, 2.85);
});

test("the multiplier applies to the stock bid/ask when Robinhood gives no token bid/ask", () => {
  const q = { ...quote("NVDA"), tokenBid: null, tokenAsk: null };
  const r = tokenReference(q, 2);
  assert.equal(r.bid, 299.6);
  assert.equal(Math.round(r.price! * 1000) / 1000, 299.61);
});

// The API with GLD's real Saturday quote and a fake GLD pool at 335 USDG.
function gldApp() {
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/assets")) {
      return Response.json({ assets: [{ tokenSymbol: "GLD", tokenName: "SPDR Gold Trust", deployments: [{ contractAddress: "0xC9a981FEE1F9DEc688bb123ccDeCc63D0deBFC4e", chainId: 4663 }], currentMultiplier: "1" }] });
    }
    if (url.endsWith("/prices/GLD")) return Response.json(QUOTES.GLD);
    return new Response("nf", { status: 404 });
  }) as typeof fetch;
  return createApp({ fetch: f, now: () => 1_800_000_000_000 });
}

test("GET /v1/prices for a wide quote: tokenPrice null, the spread and the raw bid/ask still shown", async () => {
  const res = await gldApp()(new Request("https://equito.pages.dev/v1/prices/GLD"), {} as Env);
  assert.equal(res.status, 200);
  const b = (await res.json()) as any;
  assert.equal(b.tokenPrice, null);
  assert.equal(b.token.bid, 331.5);
  assert.equal(b.token.ask, 500);
  assert.equal(b.spreadPct, 50.83);
  assert.match(b.priceNote, /spread/);
});
