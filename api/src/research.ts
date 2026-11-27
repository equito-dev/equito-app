// GET /v1/research/{symbol}: the company behind a stock token, from SEC EDGAR (free, no key).
// SEC asks every client for a User-Agent with a contact email and at most 10 requests a second
// (https://www.sec.gov/os/accessing-edgar-data). The email is the product's own, set as CONTACT_EMAIL; without it this
// endpoint answers 503 and never calls SEC. Cached per isolate: the ticker list 24 h, a company 6 h.
import { ApiError, json } from "./http.ts";

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const SUBMISSIONS = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;
const FACTS = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
const TICKERS_TTL = 24 * 3600_000;
const COMPANY_TTL = 6 * 3600_000;
const FORMS = new Set(["10-K", "10-Q", "8-K", "20-F", "40-F", "6-K", "S-1", "DEF 14A", "10-K/A", "10-Q/A"]);

// us-gaap concepts, in order of preference (companies report revenue under different names).
const CONCEPTS: Record<string, { tags: string[]; unit: string }> = {
  revenue: { tags: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"], unit: "USD" },
  netIncome: { tags: ["NetIncomeLoss"], unit: "USD" },
  epsDiluted: { tags: ["EarningsPerShareDiluted"], unit: "USD/shares" },
  totalAssets: { tags: ["Assets"], unit: "USD" },
  totalLiabilities: { tags: ["Liabilities"], unit: "USD" },
  cash: { tags: ["CashAndCashEquivalentsAtCarryingValue"], unit: "USD" },
  operatingCashFlow: { tags: ["NetCashProvidedByUsedInOperatingActivities"], unit: "USD" },
};

type Fact = { val: number; end: string; fy?: number; fp?: string; form?: string; filed?: string; start?: string };
type Cached<T> = { at: number; value: T };

const pad = (cik: number) => String(cik).padStart(10, "0");

export class Edgar {
  private f: typeof fetch;
  private now: () => number;
  private tickers: Cached<Map<string, { cik: string; title: string }>> | null = null;
  private companies = new Map<string, Cached<unknown>>();
  constructor(f: typeof fetch, now: () => number = Date.now) {
    this.f = f;
    this.now = now;
  }

  private async get(url: string, contact: string): Promise<unknown> {
    let res: Response;
    try {
      res = await this.f(url, { headers: { "user-agent": `Equito ${contact}`, accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ApiError(502, "upstream_unavailable", "SEC EDGAR could not be reached. Try again shortly.");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiError(502, "upstream_unavailable", `SEC EDGAR answered ${res.status}. Try again shortly.`);
    return res.json();
  }

  async cikOf(ticker: string, contact: string): Promise<{ cik: string; title: string } | null> {
    if (!this.tickers || this.now() - this.tickers.at > TICKERS_TTL) {
      const body = (await this.get(TICKERS_URL, contact)) as Record<string, { cik_str: number; ticker: string; title: string }> | null;
      const map = new Map<string, { cik: string; title: string }>();
      for (const row of Object.values(body ?? {})) {
        if (row && typeof row.ticker === "string" && Number.isInteger(row.cik_str)) map.set(row.ticker.toUpperCase(), { cik: pad(row.cik_str), title: row.title });
      }
      if (map.size === 0) throw new ApiError(502, "upstream_unavailable", "SEC's ticker list came back empty.");
      this.tickers = { at: this.now(), value: map };
    }
    // SEC writes class shares with a dash (BRK-B); Robinhood may use a dot.
    return this.tickers.value.get(ticker) ?? this.tickers.value.get(ticker.replace(".", "-")) ?? null;
  }

  async company(cik: string, contact: string): Promise<{ submissions: any; facts: any }> {
    const c = this.companies.get(cik);
    if (c && this.now() - c.at < COMPANY_TTL) return c.value as { submissions: any; facts: any };
    const [submissions, facts] = await Promise.all([this.get(SUBMISSIONS(cik), contact), this.get(FACTS(cik), contact)]);
    const value = { submissions, facts };
    this.companies.set(cik, { at: this.now(), value });
    return value;
  }
}

// The newest value of a concept for a period kind: annual (10-K / 20-F full year) or quarterly (10-Q).
export function latest(facts: any, key: keyof typeof CONCEPTS, kind: "annual" | "quarter"): { value: number; periodEnd: string; form: string | null; fiscalYear: number | null } | null {
  const { tags, unit } = CONCEPTS[key];
  for (const tag of tags) {
    const list: Fact[] | undefined = facts?.facts?.["us-gaap"]?.[tag]?.units?.[unit];
    if (!Array.isArray(list)) continue;
    const fits = list.filter((x) => {
      if (typeof x?.val !== "number" || typeof x.end !== "string") return false;
      const annual = x.form === "10-K" || x.form === "20-F" || x.form === "40-F";
      if (kind === "annual") return annual && (x.fp === "FY" || x.fp === undefined);
      // A quarter's flow (revenue, income) spans about 90 days; a balance (assets) has no start.
      const days = x.start ? (Date.parse(x.end) - Date.parse(x.start)) / 86_400_000 : 0;
      return x.form === "10-Q" && (!x.start || (days > 70 && days < 110));
    });
    if (fits.length === 0) continue;
    fits.sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : (b.filed ?? "").localeCompare(a.filed ?? "")));
    const top = fits[0];
    return { value: top.val, periodEnd: top.end, form: top.form ?? null, fiscalYear: top.fy ?? null };
  }
  return null;
}

export async function getResearch(edgar: Edgar, symbol: string, contact: string | undefined, url: URL): Promise<Response> {
  if (!contact || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) throw new ApiError(503, "research_off", "Company research is not switched on yet on this server.");
  const filingsLimit = Number(url.searchParams.get("filings") ?? "10");
  if (!Number.isInteger(filingsLimit) || filingsLimit < 1 || filingsLimit > 40) throw new ApiError(400, "invalid_filings", "filings must be a whole number from 1 to 40.");
  const hit = await edgar.cikOf(symbol, contact);
  if (!hit) throw new ApiError(404, "no_sec_company", `${symbol} has no SEC filer (an ETF or a foreign listing may not file with the SEC).`);
  const { submissions, facts } = await edgar.company(hit.cik, contact);
  const recent = submissions?.filings?.recent ?? {};
  const forms: string[] = Array.isArray(recent.form) ? recent.form : [];
  const filings = forms
    .map((form, i) => ({ form, i }))
    .filter(({ form }) => FORMS.has(form))
    .slice(0, filingsLimit)
    .map(({ form, i }) => {
      const accession = String(recent.accessionNumber?.[i] ?? "");
      const doc = String(recent.primaryDocument?.[i] ?? "");
      return {
        form,
        filed: recent.filingDate?.[i] ?? null,
        reportDate: recent.reportDate?.[i] || null,
        description: recent.primaryDocDescription?.[i] || null,
        url: accession && doc ? `https://www.sec.gov/Archives/edgar/data/${Number(hit.cik)}/${accession.replace(/-/g, "")}/${doc}` : null,
      };
    });
  const pick = (kind: "annual" | "quarter") => Object.fromEntries(Object.keys(CONCEPTS).map((k) => [k, latest(facts, k as keyof typeof CONCEPTS, kind)]));
  const shares = facts?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares as Fact[] | undefined;
  const sharesLatest = Array.isArray(shares) && shares.length ? [...shares].sort((a, b) => (a.end < b.end ? 1 : -1))[0] : null;
  return json(200, {
    symbol,
    cik: hit.cik,
    name: submissions?.name ?? hit.title,
    industry: submissions?.sicDescription ?? null,
    exchanges: Array.isArray(submissions?.exchanges) ? submissions.exchanges : [],
    fiscalYearEnd: submissions?.fiscalYearEnd ?? null,
    sharesOutstanding: sharesLatest ? { value: sharesLatest.val, asOf: sharesLatest.end } : null,
    annual: pick("annual"),
    quarter: pick("quarter"),
    filings,
    source: { name: "SEC EDGAR", submissions: SUBMISSIONS(hit.cik), facts: FACTS(hit.cik) },
    note: "Reported figures from the company's own SEC filings, in USD. Not investment advice.",
  });
}
