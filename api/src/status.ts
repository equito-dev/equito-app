// GET /status: is Equito wired up and its data fresh? Each check is { ok, detail, critical }; overall ok = every
// critical check ok (HTTP 503 otherwise). Checks run in parallel, each cut off after 3 s. Nothing secret is printed:
// RPC nodes and the facilitator only as "reachable", keys and addresses only as "set", and error text never.
import { json } from "./http.ts";
import { DEFAULT_FACILITATOR } from "./x402.ts";
import type { Chain } from "./chain.ts";
import type { Robinhood } from "./robinhood.ts";
import type { D1Like } from "./store.ts";

export const STATUS_TIMEOUT_MS = 3000;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const FRESH_MS = 3 * 3600_000; // the collector runs about hourly; GitHub can start it late

export type StatusEnv = { DB?: D1Like; FREE?: unknown; X402_PAY_TO?: string; PRIORS_API_KEY?: string; FACILITATOR_URL?: string; CONTACT_EMAIL?: string; HOLDER_TOKEN?: string };
export type Check = { ok: boolean; detail: string; critical: boolean };

async function guarded(critical: boolean, ms: number, run: () => Promise<{ ok: boolean; detail: string }>): Promise<Check> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const slow = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    });
    return { ...(await Promise.race([run(), slow])), critical };
  } catch (err) {
    return { ok: false, critical, detail: err instanceof Error && err.message === "timeout" ? `no answer within ${ms / 1000} s` : "check failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function statusReport(env: StatusEnv, deps: { chain: Chain; rh: Robinhood; fetch: typeof fetch; now: () => number; timeoutMs?: number }) {
  const ms = deps.timeoutMs ?? STATUS_TIMEOUT_MS;
  const now = deps.now();

  const database = guarded(true, ms, async () => {
    if (!env.DB) return { ok: false, detail: "not bound" };
    const row = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    return row?.ok === 1 ? { ok: true, detail: "reachable" } : { ok: false, detail: "unexpected answer" };
  });
  const chain = guarded(true, ms, async () => {
    const [head] = await deps.chain.rpc([{ method: "eth_blockNumber", params: [] }]);
    return typeof head === "string" && /^0x[0-9a-fA-F]+$/.test(head) ? { ok: true, detail: `reachable, block ${Number.parseInt(head, 16)}` } : { ok: false, detail: "no node answered" };
  });
  const robinhood = guarded(true, ms, async () => {
    const assets = await deps.rh.assets();
    return { ok: assets.length > 0, detail: `${assets.length} stock tokens listed` };
  });
  const collector = guarded(false, ms, async () => {
    if (!env.DB) return { ok: false, detail: "no database" };
    const row = await env.DB.prepare("SELECT MAX(updated_at) AS t, COUNT(*) AS n FROM token_stats").first<{ t: number | null; n: number }>();
    if (!row?.t) return { ok: false, detail: "no snapshot yet" };
    const age = Math.round((now - row.t) / 60_000);
    return { ok: now - row.t < FRESH_MS, detail: `last run ${age} min ago, ${row.n} tokens` };
  });
  const payments = guarded(false, ms, async () => {
    const problems: string[] = [];
    if (!ADDRESS.test(env.X402_PAY_TO ?? "")) problems.push("payout address not set");
    if (!env.PRIORS_API_KEY) problems.push("facilitator key not set");
    let up = false;
    try {
      up = (await deps.fetch((env.FACILITATOR_URL || DEFAULT_FACILITATOR).replace(/\/+$/, "") + "/health", { signal: AbortSignal.timeout(ms) })).ok;
    } catch {
      up = false;
    }
    if (!up) problems.push("facilitator not reachable");
    return problems.length ? { ok: false, detail: problems.join(", ") } : { ok: true, detail: "payout address set, facilitator key set, facilitator reachable" };
  });
  const freeTier = guarded(false, ms, async () => (env.FREE ? { ok: true, detail: "bound" } : { ok: false, detail: "not bound (calls are not metered)" }));
  const research = guarded(false, ms, async () => (env.CONTACT_EMAIL ? { ok: true, detail: "contact set" } : { ok: false, detail: "contact email not set (/v1/research is off)" }));
  const holderPrice = guarded(false, ms, async () => (ADDRESS.test(env.HOLDER_TOKEN ?? "") ? { ok: true, detail: "on" } : { ok: false, detail: "off until the $EQUITO launch" }));

  const names = ["database", "chainRpc", "robinhood", "collector", "payments", "freeTier", "research", "holderPrice"];
  const results = await Promise.all([database, chain, robinhood, collector, payments, freeTier, research, holderPrice]);
  return { ok: results.every((c) => c.ok || !c.critical), checkedAt: new Date(now).toISOString(), checks: Object.fromEntries(names.map((n, i) => [n, results[i]])) };
}

export async function getStatus(env: StatusEnv, deps: Parameters<typeof statusReport>[1]): Promise<Response> {
  const report = await statusReport(env, deps);
  return json(report.ok ? 200 : 503, report, { "cache-control": "no-store" });
}
