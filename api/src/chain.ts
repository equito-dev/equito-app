// Robinhood Chain reads over plain JSON-RPC. Many eth_calls go out as ONE batched request (max 100 per batch, the
// public node's limit), so a whole token's facts cost one round trip. A call that reverts comes back as null, never a
// guess. viem only encodes and decodes; the transport is our own fetch so tests can hand in a fake.
import { decodeFunctionResult, encodeFunctionData, type Abi } from "viem";
import { ApiError } from "./http.ts";

export const PUBLIC_RPC = "https://rpc.mainnet.chain.robinhood.com";
const MAX_BATCH = 100;

export type Call = { to: string; abi: Abi; functionName: string; args?: readonly unknown[] };

// "a, b ,c" -> ["a","b","c"], always ending with the public node as the last resort. URLs can carry API keys, so they
// are never logged or put in an error: a node is named by its position only.
export function rpcUrls(...values: (string | undefined)[]): string[] {
  const list = values.flatMap((v) => (v ?? "").split(",")).map((s) => s.trim()).filter(Boolean);
  return [...new Set([...list, PUBLIC_RPC])];
}

let rotation = 0;

export class Chain {
  private urls: string[];
  private f: typeof fetch;
  private retryWaitMs: number;
  constructor(urls: string | string[], f: typeof fetch, retryWaitMs = 1500) {
    this.urls = Array.isArray(urls) ? (urls.length ? urls : [PUBLIC_RPC]) : [urls];
    this.f = f;
    this.retryWaitMs = retryWaitMs;
  }

  // Each batch starts at the next node in turn; on a 429 or an outage the same batch moves on to the next node.
  private async batch(payload: { jsonrpc: "2.0"; id: number; method: string; params: unknown[] }[]): Promise<Map<number, unknown>> {
    const start = rotation++ % this.urls.length;
    let last: ApiError | null = null;
    // Every node once; if all were busy, one more round after a short pause.
    for (let round = 0; round < 2; round++) {
      if (round > 0) await new Promise<void>((r) => setTimeout(r, this.retryWaitMs));
      for (let i = 0; i < this.urls.length; i++) {
        try {
          return await this.batchOn(this.urls[(start + i) % this.urls.length], payload);
        } catch (err) {
          if (!(err instanceof ApiError)) throw err;
          last = err;
        }
      }
    }
    throw last ?? new ApiError(502, "chain_unavailable", "Robinhood Chain could not be read just now. Try again shortly.");
  }

  private async batchOn(url: string, payload: { jsonrpc: "2.0"; id: number; method: string; params: unknown[] }[]): Promise<Map<number, unknown>> {
    let body: unknown;
    try {
      const res = await this.f(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });
      body = await res.json();
    } catch {
      throw new ApiError(502, "chain_unavailable", "Robinhood Chain could not be read just now. Try again shortly.");
    }
    if (!Array.isArray(body)) {
      // The public node answers a whole batch with one error object when it rate-limits (429).
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      if (code === 429) throw new ApiError(503, "chain_busy", "The Robinhood Chain node is rate-limiting us right now. Try again in a minute.");
      throw new ApiError(502, "chain_unavailable", "The chain node answered something we could not read.");
    }
    // Some nodes answer a busy moment inside the batch: most calls fine, a few with a rate-limit error. Those must not
    // read as "reverted" (that turned real pools into "no pool" on 2026-11-26), so the whole batch counts as busy.
    const limited = (body as { error?: { code?: unknown; message?: unknown } }[]).some((r) => {
      const e = r?.error;
      return !!e && (e.code === 429 || e.code === -32005 || /rate|limit|too many|capacity|exceed|throttl/i.test(String(e.message ?? "")));
    });
    if (limited) throw new ApiError(503, "chain_busy", "The Robinhood Chain node is rate-limiting us right now. Try again in a minute.");
    const out = new Map<number, unknown>();
    for (const r of body as { id?: unknown; result?: unknown; error?: unknown }[]) {
      if (typeof r?.id === "number" && r.error === undefined) out.set(r.id, r.result);
    }
    return out;
  }

  // Each answer decoded, or null when that call reverted or returned nothing.
  async calls(list: Call[]): Promise<(unknown | null)[]> {
    const results: (unknown | null)[] = new Array(list.length).fill(null);
    for (let start = 0; start < list.length; start += MAX_BATCH) {
      const chunk = list.slice(start, start + MAX_BATCH);
      const answers = await this.batch(
        chunk.map((c, i) => ({
          jsonrpc: "2.0" as const,
          id: start + i,
          method: "eth_call",
          params: [{ to: c.to, data: encodeFunctionData({ abi: c.abi, functionName: c.functionName, args: c.args ?? [] } as any) }, "latest"],
        })),
      );
      chunk.forEach((c, i) => {
        const raw = answers.get(start + i);
        if (typeof raw !== "string" || raw === "0x") return;
        try {
          results[start + i] = decodeFunctionResult({ abi: c.abi, functionName: c.functionName, data: raw as `0x${string}` } as any);
        } catch {
          results[start + i] = null;
        }
      });
    }
    return results;
  }

  async call(c: Call): Promise<unknown | null> {
    return (await this.calls([c]))[0];
  }
}
