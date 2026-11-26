// Pons launches, read from the chain: the launcher contract emits one event per new token.
// Shape checked on real data 2026-11-11 (Reinkeep collector): address = LAUNCHER, topic0 = LAUNCH_TOPIC,
// topic1 = token, topic2 = pool, topic3 = creator. Filter by the launcher address: an unrelated fork emits the same
// event. eth_getLogs is refused from Cloudflare's addresses, so the GitHub Actions collector reads this and the API
// only serves what it stored.
import { decodeFunctionResult, encodeFunctionData, parseAbi } from "viem";
import type { Chain } from "./chain.ts";

export const LAUNCHER = "0xe33e9e479df8802cb0866d5d05258bec4cf62948";
export const LAUNCH_TOPIC = "0xdcacba5e347ae7abd91cb519eb877af8fa7774e347b85dd3ddcd24a2ba8cdf37";
// Robinhood Chain makes about 35,000 blocks an hour; 26 hours overlaps the previous run even when GitHub starts late.
export const LOOKBACK_BLOCKS = 26 * 35_000;

const NAMES = parseAbi(["function symbol() view returns (string)", "function name() view returns (string)"]);
const WORD_ADDRESS = /^0x0{24}([0-9a-fA-F]{40})$/;

export type LaunchLog = { token: string; pool: string; creator: string; block: number };
export type Launch = LaunchLog & { createdAt: number; symbol: string | null; name: string | null };

const hexNum = (v: unknown): number | null => (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v) ? Number.parseInt(v, 16) : null);

// Trusts nothing: anything that is not exactly the launcher's event with three address topics is ignored.
export function parseLaunchLog(log: unknown): LaunchLog | null {
  if (!log || typeof log !== "object") return null;
  const l = log as { address?: unknown; topics?: unknown; blockNumber?: unknown };
  if (typeof l.address !== "string" || l.address.toLowerCase() !== LAUNCHER) return null;
  const t = l.topics;
  if (!Array.isArray(t) || t.length !== 4 || String(t[0]).toLowerCase() !== LAUNCH_TOPIC) return null;
  const [token, pool, creator] = [t[1], t[2], t[3]].map((x) => (typeof x === "string" ? x.match(WORD_ADDRESS)?.[1] : undefined));
  const block = hexNum(l.blockNumber);
  if (!token || !pool || !creator || block === null || block <= 0) return null;
  return { token: "0x" + token.toLowerCase(), pool: "0x" + pool.toLowerCase(), creator: "0x" + creator.toLowerCase(), block };
}

function text(abiName: "symbol" | "name", raw: unknown): string | null {
  if (typeof raw !== "string" || raw === "0x") return null;
  try {
    const v = decodeFunctionResult({ abi: NAMES, functionName: abiName, data: raw as `0x${string}` });
    return typeof v === "string" && v.length > 0 && v.length <= 64 ? v.replace(/[\u0000-\u001f]/g, "") : null;
  } catch {
    return null;
  }
}

// Every launch in the last `lookback` blocks, with its block time, symbol and name.
export async function recentLaunches(chain: Chain, lookback = LOOKBACK_BLOCKS): Promise<Launch[]> {
  const [headRaw] = await chain.rpc([{ method: "eth_blockNumber", params: [] }]);
  const head = hexNum(headRaw);
  if (head === null) throw new Error("could not read the newest block");
  const from = Math.max(1, head - lookback);
  const [logs] = await chain.rpc([{ method: "eth_getLogs", params: [{ address: LAUNCHER, topics: [LAUNCH_TOPIC], fromBlock: "0x" + from.toString(16), toBlock: "0x" + head.toString(16) }] }]);
  if (!Array.isArray(logs)) throw new Error("getLogs failed");
  const found = logs.map(parseLaunchLog).filter((l): l is LaunchLog => l !== null);
  if (found.length === 0) return [];

  const blocks = [...new Set(found.map((l) => l.block))];
  const times = await chain.rpc(blocks.map((b) => ({ method: "eth_getBlockByNumber", params: ["0x" + b.toString(16), false] })));
  const timeOf = new Map(blocks.map((b, i) => [b, hexNum((times[i] as { timestamp?: unknown } | null)?.timestamp)]));
  const names = await chain.rpc(
    found.flatMap((l) => (["symbol", "name"] as const).map((fn) => ({ method: "eth_call", params: [{ to: l.token, data: encodeFunctionData({ abi: NAMES, functionName: fn }) }, "latest"] }))),
  );
  return found
    .map((l, i) => {
      const ts = timeOf.get(l.block);
      return ts ? { ...l, createdAt: ts * 1000, symbol: text("symbol", names[2 * i]), name: text("name", names[2 * i + 1]) } : null;
    })
    .filter((l): l is Launch => l !== null);
}
