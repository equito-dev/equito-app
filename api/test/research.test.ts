import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type Env } from "../src/worker.ts";
import { latest } from "../src/research.ts";

const NVDA = "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC";
const SPY = "0x00000000000000000000000000000000000005b1";

const FACTS = {
  facts: {
    dei: { EntityCommonStockSharesOutstanding: { units: { shares: [{ val: 24_300_000_000, end: "2026-08-20" }, { val: 24_400_000_000, end: "2026-05-20" }] } } },
    "us-gaap": {
      Revenues: {
        units: {
          USD: [
            { val: 130_000, start: "2025-01-27", end: "2026-01-25", fy: 2026, fp: "FY", form: "10-K", filed: "2026-02-26" },
            { val: 60_000, start: "2024-01-29", end: "2025-01-26", fy: 2025, fp: "FY", form: "10-K", filed: "2025-02-26" },
            { val: 46_000, start: "2026-04-27", end: "2026-07-27", fy: 2027, fp: "Q2", form: "10-Q", filed: "2026-08-27" },
            { val: 90_000, start: "2026-01-26", end: "2026-07-27", fy: 2027, fp: "Q2", form: "10-Q", filed: "2026-08-27" }, // six months: not a quarter
          ],
        },
      },
      NetIncomeLoss: { units: { USD: [{ val: 72_000, start: "2025-01-27", end: "2026-01-25", fy: 2026, fp: "FY", form: "10-K", filed: "2026-02-26" }] } },
      Assets: { units: { USD: [{ val: 140_000, end: "2026-07-27", fy: 2027, fp: "Q2", form: "10-Q", filed: "2026-08-27" }] } },
    },
  },
};

function fakeFetch() {
  const secCalls: { url: string; ua: string }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/rhj/assets")) {
      return Response.json({ assets: [
        { tokenSymbol: "NVDA", deployments: [{ contractAddress: NVDA, chainId: 4663 }], currentMultiplier: 1 },
        { tokenSymbol: "SPY", deployments: [{ contractAddress: SPY, chainId: 4663 }], currentMultiplier: 1 },
      ] });
    }
    if (url.includes("sec.gov")) {
      secCalls.push({ url, ua: (init?.headers as Record<string, string>)["user-agent"] });
      if (url.endsWith("company_tickers.json")) return Response.json({ "0": { cik_str: 1045810, ticker: "NVDA", title: "NVIDIA CORP" } });
      if (url.endsWith("/submissions/CIK0001045810.json")) {
        return Response.json({
          name: "NVIDIA CORP", sicDescription: "Semiconductors & Related Devices", exchanges: ["Nasdaq"], fiscalYearEnd: "0126",
          filings: { recent: {
            form: ["4", "10-Q", "8-K", "10-K"],
            filingDate: ["2026-09-01", "2026-08-27", "2026-08-27", "2026-02-26"],
            reportDate: ["", "2026-07-27", "", "2026-01-25"],
            accessionNumber: ["0001-26-1", "0001045810-26-000201", "0001045810-26-000199", "0001045810-26-000023"],
            primaryDocument: ["x.xml", "nvda-20260727.htm", "nvda-8k.htm", "nvda-20260125.htm"],
            primaryDocDescription: ["", "10-Q", "8-K", "10-K"],
          } },
        });
      }
      if (url.endsWith("/companyfacts/CIK0001045810.json")) return Response.json(FACTS);
      return new Response("nf", { status: 404 });
    }
    throw new Error("unexpected " + url);
  }) as typeof fetch;
  return { f, secCalls };
}

const get = (path: string) => new Request("https://api.equito.pro" + path);

test("latest() takes the newest full year from a 10-K and a real quarter from a 10-Q", () => {
  assert.deepEqual(latest(FACTS, "revenue", "annual"), { value: 130_000, periodEnd: "2026-01-25", form: "10-K", fiscalYear: 2026 });
  assert.equal(latest(FACTS, "revenue", "quarter")!.value, 46_000); // not the six-month figure
  assert.equal(latest(FACTS, "totalAssets", "quarter")!.value, 140_000);
  assert.equal(latest(FACTS, "cash", "annual"), null);
});

test("research is off without CONTACT_EMAIL and never calls SEC then", async () => {
  const { f, secCalls } = fakeFetch();
  const res = await createApp({ fetch: f })(get("/v1/research/NVDA"), {});
  assert.equal(res.status, 503);
  assert.equal(((await res.json()) as any).error.code, "research_off");
  assert.equal(secCalls.length, 0);
});

test("GET /v1/research/{symbol} gives the company, its figures and recent filings, asking SEC with the contact", async () => {
  const { f, secCalls } = fakeFetch();
  const env: Env = { CONTACT_EMAIL: "hello@equito.pro" };
  const res = await createApp({ fetch: f })(get("/v1/research/nvda?filings=5"), env);
  assert.equal(res.status, 200);
  const b = (await res.json()) as any;
  assert.equal(b.cik, "0001045810");
  assert.equal(b.name, "NVIDIA CORP");
  assert.equal(b.industry, "Semiconductors & Related Devices");
  assert.deepEqual(b.sharesOutstanding, { value: 24_300_000_000, asOf: "2026-08-20" });
  assert.equal(b.annual.revenue.value, 130_000);
  assert.equal(b.annual.netIncome.value, 72_000);
  assert.equal(b.quarter.revenue.value, 46_000);
  assert.deepEqual(b.filings.map((x: any) => x.form), ["10-Q", "8-K", "10-K"]); // form 4 is left out
  assert.equal(b.filings[0].url, "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000201/nvda-20260727.htm");
  assert.ok(secCalls.every((c) => c.ua === "Equito hello@equito.pro"));
});

test("an ETF with no SEC filer is a 404, and so is a symbol that is not a stock token", async () => {
  const { f } = fakeFetch();
  const app = createApp({ fetch: f });
  const env: Env = { CONTACT_EMAIL: "hello@equito.pro" };
  const etf = await app(get("/v1/research/SPY"), env);
  assert.equal(etf.status, 404);
  assert.equal(((await etf.json()) as any).error.code, "no_sec_company");
  assert.equal(((await (await app(get("/v1/research/ZZZZ"), env)).json()) as any).error.code, "unknown_symbol");
});
