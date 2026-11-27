// Metering for every data endpoint: FREE_CALLS_PER_DAY free calls per caller IP per UTC day (one FreeTier Durable
// Object per IP), then x402 v2 pay-per-call in USDG. A call costs `units` x UNIT_USD (trade/build is 2 units).
// A free slot is taken first and given back unless the handler answered 2xx, so a typo or an upstream outage costs
// nothing. On the paid path nothing is settled unless the handler answered 2xx.
import { fail, json, withHeaders } from "./http.ts";
import { HOLDER_DISCOUNT_PCT, HOLDER_HEADER, claimedHolder, holderAmount, holderConfig, payerOf } from "./holder.ts";
import {
  DEFAULT_FACILITATOR, FREE_CALLS_PER_DAY, FacilitatorUnavailable, NETWORK, UNIT_AMOUNT, UNIT_USD, USDG,
  amountFor, checkPayload, createFacilitator, fromBase64, paymentRequired, requirementsFor, toBase64, type Requirements,
} from "./x402.ts";

type Stub = { fetch(req: Request): Promise<Response> };
export type FreeNamespace = { idFromName(name: string): unknown; get(id: unknown): Stub };
export type MeterEnv = {
  FREE?: FreeNamespace;
  X402_PAY_TO?: string;
  PRIORS_API_KEY?: string;
  FACILITATOR_URL?: string;
  HOLDER_TOKEN?: string;
  HOLDER_MIN?: string;
};
export type MeterDeps = {
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  isHolder?: (address: string) => Promise<boolean>; // absent, or HOLDER_TOKEN unset: no holder price
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const PENDING_WAITS = [1000, 2000, 2000]; // ms between /settle retries
const DESCRIPTION = "Equito: stock token data on Robinhood Chain, one call";

// Who a free-tier counter belongs to. IPv4: the address. IPv6: its /64, because one home or server is usually given a
// whole /64 and could otherwise take a fresh address, and a fresh free tier, for every request.
export function callerKey(req: Request): string {
  const raw = (req.headers.get("cf-connecting-ip") ?? "").trim().toLowerCase();
  if (!raw.includes(":")) return raw || "unknown";
  let groups = raw.split(":");
  if (raw.includes("::")) {
    const [head, tail] = raw.split("::");
    const left = head ? head.split(":") : [];
    const right = tail ? tail.split(":") : [];
    groups = [...left, ...Array(Math.max(8 - left.length - right.length, 0)).fill("0"), ...right];
  }
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const payOk = (env: MeterEnv): boolean => !!env.PRIORS_API_KEY && ADDRESS.test(env.X402_PAY_TO ?? "");

export function pricing(env: MeterEnv): Response {
  const cfg = holderConfig(env);
  return json(200, {
    freeCallsPerDay: FREE_CALLS_PER_DAY,
    priceUsd: UNIT_USD,
    tradeBuildPriceUsd: UNIT_USD * 2,
    amount: UNIT_AMOUNT,
    asset: USDG,
    network: NETWORK,
    payTo: ADDRESS.test(env.X402_PAY_TO ?? "") ? env.X402_PAY_TO : null,
    facilitator: env.FACILITATOR_URL || DEFAULT_FACILITATOR,
    holder: cfg ? { token: cfg.token, minBalance: String(cfg.minBalance), discountPct: HOLDER_DISCOUNT_PCT, header: HOLDER_HEADER } : null,
  });
}

function payment402(url: string, requirements: Requirements, error: string): Response {
  const body = paymentRequired(url, requirements, error, DESCRIPTION);
  return withHeaders(json(402, body), { "payment-required": toBase64(body) });
}

// `paidOnly` (the /v1/paid/... paths, listed for x402 directories): no free tier, 402 until paid.
export async function meter(req: Request, env: MeterEnv, units: number, handler: () => Promise<Response>, deps: MeterDeps, paidOnly = false): Promise<Response> {
  const free = !paidOnly && env.FREE ? env.FREE.get(env.FREE.idFromName(callerKey(req))) : undefined;
  if (paidOnly) {
    // straight to payment
  } else if (free) {
    // Take the slots first (race-safe: parallel calls cannot overshoot), give them back unless the handler answered 2xx.
    const taken = (await (await free.fetch(new Request(`https://free/take?n=${units}`, { method: "POST" }))).json()) as { ok: boolean; left: number };
    if (taken.ok) {
      const res = await handler();
      if (res.ok) return withHeaders(res, { "x-free-calls-left": String(taken.left) });
      await free.fetch(new Request(`https://free/refund?n=${units}`, { method: "POST" }));
      return withHeaders(res, { "x-free-calls-left": String(taken.left + units) });
    }
  } else {
    return handler(); // no free tier bound (local dev): everything is free
  }

  if (!payOk(env)) return fail(503, "payment_not_configured", paidOnly ? "Paid calls are not set up on this server yet." : "The free calls for today are used, and paid calls are not set up on this server yet.");
  const full = amountFor(units);
  const claimed = claimedHolder(req);
  const holder = claimed && holderConfig(env) && deps.isHolder ? ((await deps.isHolder(claimed)) ? claimed : null) : null;
  const requirements = requirementsFor(env.X402_PAY_TO!, holder ? holderAmount(full) : full);
  const header = req.headers.get("payment-signature");
  if (!header) return payment402(req.url, requirements, paidOnly ? "Payment required." : `The ${FREE_CALLS_PER_DAY} free calls for today are used. Payment required.`);

  const payload = fromBase64(header);
  const problem = checkPayload(payload, requirements);
  if (problem) return payment402(req.url, requirements, problem);

  const facilitator = createFacilitator({ url: env.FACILITATOR_URL || DEFAULT_FACILITATOR, apiKey: env.PRIORS_API_KEY!, fetch: deps.fetch });
  try {
    const verified = await facilitator.verify(payload, requirements);
    if (!verified.isValid) return payment402(req.url, requirements, `Payment not valid: ${String(verified.invalidReason ?? "unknown").slice(0, 100)}`);
    // Checked before the handler runs and before anything settles: half price only from the holder's own wallet.
    if (holder && payerOf(payload, verified.payer) !== holder) {
      return payment402(req.url, requirementsFor(env.X402_PAY_TO!, full), `The holder price is only for payments from ${holder}. Pay the full price, or pay from that wallet.`);
    }

    const res = await handler();
    if (!res.ok) return res; // nothing is settled

    // "settlement_pending" is not a failure: ask again with the SAME payload (never ask the payer to sign twice).
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let settled = await facilitator.settle(payload, requirements);
    for (const wait of PENDING_WAITS) {
      if (settled.success || settled.errorReason !== "settlement_pending") break;
      await sleep(wait);
      settled = await facilitator.settle(payload, requirements);
    }
    if (!settled.success && settled.errorReason === "settlement_pending") {
      return payment402(req.url, requirements, "Payment is still pending on chain. Do not sign again: send the same PAYMENT-SIGNATURE in a moment.");
    }
    if (!settled.success) return payment402(req.url, requirements, `Payment could not be settled: ${String(settled.errorReason ?? "unknown").slice(0, 100)}`);
    return withHeaders(res, {
      "payment-response": toBase64({ success: true, transaction: settled.transaction, network: settled.network ?? NETWORK, payer: settled.payer }),
    });
  } catch (err) {
    if (err instanceof FacilitatorUnavailable) return fail(502, "payment_unavailable", "The payment service could not be reached. Nothing was charged.");
    throw err;
  }
}

// One per caller IP. Storage: { day: "YYYY-MM-DD" (UTC), count }. Requests are queued so parallel calls cannot overshoot.
export class FreeTier {
  private storage: { get(k: string): Promise<any> | any; put(k: string, v: any): Promise<void> | void };
  private tail: Promise<unknown> = Promise.resolve();
  constructor(ctx: { storage: FreeTier["storage"] }) {
    this.storage = ctx.storage;
  }

  fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const refund = url.pathname === "/refund";
    const v = Number(url.searchParams.get("n"));
    const n = Number.isInteger(v) && v >= 1 ? Math.min(v, 100) : 1;
    const step = this.tail.then(async () => {
      const day = new Date(Date.now()).toISOString().slice(0, 10);
      const cur = (await this.storage.get("count")) as { day: string; count: number } | undefined;
      let count = cur && cur.day === day ? cur.count : 0;
      let ok = true;
      if (refund) count = Math.max(0, count - n);
      else if (count + n <= FREE_CALLS_PER_DAY) count += n;
      else ok = false;
      await this.storage.put("count", { day, count });
      return Response.json({ ok, left: Math.max(0, FREE_CALLS_PER_DAY - count) });
    });
    this.tail = step.catch(() => undefined);
    return step;
  }
}
