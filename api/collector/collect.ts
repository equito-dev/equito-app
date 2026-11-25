// One collector run: every stock token's Robinhood price and Uniswap v3 pools, sent to the API in chunks.
// Runs on GitHub Actions (.github/workflows/collector.yml), where the public Robinhood Chain node does not rate-limit
// the way it does Cloudflare's shared addresses; RPC_URLS (Chainstack, Alchemy) are tried first anyway.
// It reuses the API's own code (src/), so /v1/stats live and the stored numbers are computed the same way.
import { Chain } from "../src/chain.ts";
import { statsFor } from "../src/onchain.ts";
import { Robinhood, type Asset } from "../src/robinhood.ts";
import type { StatsRow } from "../src/store.ts";

export type CollectDeps = {
  fetch: typeof fetch;
  rpcUrls: string[];
  apiBase: string;
  ingestKey: string;
  now: () => number;
  concurrency?: number;
  chunk?: number;
  log?: (line: Record<string, unknown>) => void;
};

async function pool<T, R>(items: T[], size: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await work(items[i]);
      }
    }),
  );
  return out;
}

export async function collect(d: CollectDeps): Promise<{ tokens: number; rows: number; failed: string[]; sent: number }> {
  const log = d.log ?? ((line) => console.log(JSON.stringify(line)));
  const ts = d.now();
  const rh = new Robinhood(d.fetch, d.now);
  const chain = new Chain(d.rpcUrls, d.fetch);
  const assets = (await rh.assets()).filter((a): a is Asset & { address: string } => a.address !== null);
  const failed: string[] = [];
  const rows = (
    await pool(assets, d.concurrency ?? 4, async (asset): Promise<StatsRow | null> => {
      try {
        const s = await statsFor(rh, chain, asset);
        return {
          symbol: s.symbol, address: s.address, name: s.name, decimals: s.decimals, supply: s.supply,
          tokenPrice: s.tokenPrice, dexPrice: s.dexPrice, premiumPct: s.premiumPct, liquidityUsd: s.liquidityUsd, pools: s.pools,
        };
      } catch (err) {
        failed.push(asset.symbol);
        log({ event: "token_failed", symbol: asset.symbol, error: err instanceof Error ? err.message.slice(0, 160) : "unknown" });
        return null;
      }
    })
  ).filter((r): r is StatsRow => r !== null);

  const size = d.chunk ?? 60;
  let sent = 0;
  for (let i = 0; i < rows.length; i += size) {
    const part = rows.slice(i, i + size);
    const res = await d.fetch(d.apiBase.replace(/\/+$/, "") + "/internal/snapshot", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${d.ingestKey}` },
      body: JSON.stringify({ ts, rows: part }),
    });
    if (!res.ok) throw new Error(`snapshot chunk ${i / size + 1} refused: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    sent += part.length;
  }
  log({ event: "run_done", tokens: assets.length, rows: rows.length, failed: failed.length, sent });
  return { tokens: assets.length, rows: rows.length, failed, sent };
}
