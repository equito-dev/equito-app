// Uniswap v3 on Robinhood Chain (official deployment addresses): find a stock token's USDG pools, read their price and
// depth, quote a swap with QuoterV2, and build the unsigned approve + swap for SwapRouter02. We never sign or send.
import { encodeFunctionData, parseAbi } from "viem";
import type { Chain } from "./chain.ts";

export const FACTORY = "0x1f7d7550b1b028f7571e69a784071f0205fd2efa";
export const QUOTER = "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7";
export const ROUTER = "0xcaf681a66d020601342297493863e78c959e5cb2";
export const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const USDG_DECIMALS = 6;
export const FEES = [100, 500, 3000, 10000] as const;

export const ERC20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
export const FACTORY_ABI = parseAbi(["function getPool(address, address, uint24) view returns (address)"]);
export const POOL_ABI = parseAbi([
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint8, bool)",
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
]);
export const QUOTER_ABI = parseAbi([
  "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);
export const ROUTER_ABI = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(uint256 deadline, bytes[] data) payable returns (bytes[])",
]);

const ZERO = "0x0000000000000000000000000000000000000000";
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export type Pool = {
  address: string;
  fee: number; // in hundredths of a basis point, as Uniswap counts it (500 = 0.05%)
  feePct: number;
  dexPrice: number | null; // USDG per token at the pool's current price
  tokenBalance: number; // whole tokens held by the pool
  usdgBalance: number; // whole USDG held by the pool
  liquidityUsd: number | null; // both sides at the pool price
  activeLiquidity: string; // the pool's in-range liquidity (raw)
};

export type TokenFacts = { decimals: number; supply: number | null; pools: Pool[] };

const whole = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

// USDG per token from sqrtPriceX96, whichever side the token is on.
export function priceFromSqrt(sqrtPriceX96: bigint, tokenIsToken0: boolean, tokenDecimals: number): number {
  const ratio = (Number(sqrtPriceX96) / 2 ** 96) ** 2; // token1 per token0, in raw units
  if (!Number.isFinite(ratio) || ratio <= 0) return NaN;
  return tokenIsToken0 ? ratio * 10 ** (tokenDecimals - USDG_DECIMALS) : (1 / ratio) * 10 ** (tokenDecimals - USDG_DECIMALS);
}

// Two batched rounds: supply, decimals and every fee tier's pool; then each pool's price and balances.
export async function readTokenFacts(chain: Chain, token: string): Promise<TokenFacts> {
  const first = await chain.calls([
    { to: token, abi: ERC20, functionName: "decimals" },
    { to: token, abi: ERC20, functionName: "totalSupply" },
    ...FEES.map((fee) => ({ to: FACTORY, abi: FACTORY_ABI, functionName: "getPool", args: [token, USDG, fee] })),
  ]);
  const decimals = typeof first[0] === "number" ? first[0] : 18;
  const supply = typeof first[1] === "bigint" ? whole(first[1], decimals) : null;
  const found = FEES.map((fee, i) => ({ fee, address: first[2 + i] as string | null })).filter(
    (p): p is { fee: (typeof FEES)[number]; address: string } => typeof p.address === "string" && !same(p.address, ZERO),
  );
  if (found.length === 0) return { decimals, supply, pools: [] };

  const second = await chain.calls(
    found.flatMap((p) => [
      { to: p.address, abi: POOL_ABI, functionName: "slot0" },
      { to: p.address, abi: POOL_ABI, functionName: "token0" },
      { to: p.address, abi: POOL_ABI, functionName: "liquidity" },
      { to: token, abi: ERC20, functionName: "balanceOf", args: [p.address] },
      { to: USDG, abi: ERC20, functionName: "balanceOf", args: [p.address] },
    ]),
  );
  const pools: Pool[] = found.map((p, i) => {
    const [slot0, token0, liq, tokBal, usdBal] = second.slice(i * 5, i * 5 + 5);
    const sqrt = Array.isArray(slot0) && typeof slot0[0] === "bigint" ? slot0[0] : null;
    const price = sqrt && typeof token0 === "string" ? priceFromSqrt(sqrt, same(token0, token), decimals) : NaN;
    const tokenBalance = typeof tokBal === "bigint" ? whole(tokBal, decimals) : 0;
    const usdgBalance = typeof usdBal === "bigint" ? whole(usdBal, USDG_DECIMALS) : 0;
    const dexPrice = Number.isFinite(price) && price > 0 ? price : null;
    return {
      address: p.address,
      fee: p.fee,
      feePct: p.fee / 10_000,
      dexPrice,
      tokenBalance,
      usdgBalance,
      liquidityUsd: dexPrice !== null ? usdgBalance + tokenBalance * dexPrice : null,
      activeLiquidity: typeof liq === "bigint" ? String(liq) : "0",
    };
  });
  // Deepest pool first: that is the price a real trade meets.
  pools.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  return { decimals, supply, pools };
}

export type Quote = { fee: number; pool: string; amountIn: bigint; amountOut: bigint };

// The best amountOut over every pool that exists (QuoterV2 is called with eth_call; it reverts on an empty pool).
export async function bestQuote(chain: Chain, tokenIn: string, tokenOut: string, amountIn: bigint, pools: Pool[]): Promise<Quote | null> {
  if (pools.length === 0 || amountIn <= 0n) return null;
  const answers = await chain.calls(
    pools.map((p) => ({
      to: QUOTER,
      abi: QUOTER_ABI,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee: p.fee, sqrtPriceLimitX96: 0n }],
    })),
  );
  let best: Quote | null = null;
  answers.forEach((a, i) => {
    const out = Array.isArray(a) && typeof a[0] === "bigint" ? a[0] : null;
    if (out !== null && out > 0n && (!best || out > best.amountOut)) best = { fee: pools[i].fee, pool: pools[i].address, amountIn, amountOut: out };
  });
  return best;
}

export type UnsignedTx = { to: string; data: string; value: "0"; description: string };

// approve(router, amountIn) on the token being sold, then SwapRouter02.multicall(deadline, [exactInputSingle(...)]),
// so the swap fails on chain after `deadline` instead of filling at a stale price.
export function buildSwap(o: {
  tokenIn: string; tokenOut: string; fee: number; recipient: string; amountIn: bigint; amountOutMinimum: bigint; deadline: number;
  inLabel: string; outLabel: string;
}): UnsignedTx[] {
  const approve = encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER, o.amountIn] });
  const swap = encodeFunctionData({
    abi: ROUTER_ABI,
    functionName: "exactInputSingle",
    args: [{ tokenIn: o.tokenIn as `0x${string}`, tokenOut: o.tokenOut as `0x${string}`, fee: o.fee, recipient: o.recipient as `0x${string}`, amountIn: o.amountIn, amountOutMinimum: o.amountOutMinimum, sqrtPriceLimitX96: 0n }],
  });
  const multicall = encodeFunctionData({ abi: ROUTER_ABI, functionName: "multicall", args: [BigInt(o.deadline), [swap]] });
  return [
    { to: o.tokenIn, data: approve, value: "0", description: `Approve the Uniswap router to spend ${o.inLabel}` },
    { to: ROUTER, data: multicall, value: "0", description: `Swap ${o.inLabel} for at least ${o.outLabel}` },
  ];
}
