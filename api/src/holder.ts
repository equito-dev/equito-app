// Holder price: wallets holding at least HOLDER_MIN of $EQUITO pay half for paid calls.
// Off until the owner sets HOLDER_TOKEN (the token's address) and HOLDER_MIN (whole base units, as a string): the token
// launches on Pons only after the product is live. The free tier is the same for everyone.
//
// How a caller claims it: send header `x-holder: <your address>`. We read balanceOf(address) live on the 402 quote and
// again on the paid retry, and quote half when it is enough. The payment must then come from that same address (the
// payer the facilitator reports, else the signed authorization's `from`), or anyone could name a whale's wallet and pay
// half. A failed balance read is "not a holder": full price, never a guess.

export const HOLDER_DISCOUNT_PCT = 50;
export const HOLDER_HEADER = "x-holder";
export type HolderConfig = { token: string; minBalance: bigint };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WHOLE = /^[1-9]\d{0,77}$/;
const BALANCE_OF = "0x70a08231"; // balanceOf(address)

export function holderConfig(env: { HOLDER_TOKEN?: string; HOLDER_MIN?: string }): HolderConfig | null {
  const token = env.HOLDER_TOKEN?.trim() ?? "";
  const min = env.HOLDER_MIN?.trim() ?? "";
  if (!ADDRESS.test(token) || !WHOLE.test(min)) return null;
  return { token: token.toLowerCase(), minBalance: BigInt(min) };
}

export const claimedHolder = (req: Request): string | null => {
  const v = req.headers.get(HOLDER_HEADER)?.trim() ?? "";
  return ADDRESS.test(v) ? v.toLowerCase() : null;
};

export const holderAmount = (amount: string): string => String((BigInt(amount) * BigInt(100 - HOLDER_DISCOUNT_PCT)) / 100n);

// The token balance in base units, read live with one eth_call; null when the read failed or made no sense.
export function holderBalance(rpcUrl: string, cfg: HolderConfig, f: typeof fetch): (address: string) => Promise<bigint | null> {
  return async (address) => {
    try {
      const data = BALANCE_OF + address.slice(2).toLowerCase().padStart(64, "0");
      const res = await f(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: cfg.token, data }, "latest"] }),
        signal: AbortSignal.timeout(5_000),
      });
      const body = (await res.json()) as { result?: unknown };
      if (typeof body.result !== "string" || !/^0x[0-9a-fA-F]{1,64}$/.test(body.result)) return null;
      return BigInt(body.result);
    } catch {
      return null;
    }
  };
}

export function holderCheck(rpcUrl: string, cfg: HolderConfig, f: typeof fetch): (address: string) => Promise<boolean> {
  const balance = holderBalance(rpcUrl, cfg, f);
  return async (address) => {
    const b = await balance(address);
    return b !== null && b >= cfg.minBalance;
  };
}

// Who paid: the facilitator's word first, else the `from` of the signed EIP-3009 authorization in the payload.
export function payerOf(payload: unknown, verifiedPayer?: string): string | null {
  if (typeof verifiedPayer === "string" && ADDRESS.test(verifiedPayer)) return verifiedPayer.toLowerCase();
  const from = (payload as { payload?: { authorization?: { from?: unknown } } } | undefined)?.payload?.authorization?.from;
  return typeof from === "string" && ADDRESS.test(from) ? from.toLowerCase() : null;
}
