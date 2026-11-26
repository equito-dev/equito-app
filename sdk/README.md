# equito

Stock token data on Robinhood Chain in one small client: every token, live prices, the DEX premium over the real
stock, Uniswap v3 pool depth, candles, wallet portfolios, corporate actions, SEC research, Pons launches, webhook
alerts, real Uniswap quotes and unsigned trades. No dependencies. Node 18+, browsers, Deno, Bun, Workers.

```bash
npm install equito
```

```ts
import { Equito } from "equito";

const eq = new Equito();

const nvda = await eq.stats("NVDA");
// { tokenPrice: 145.44, dexPrice: 145.45, premiumPct: 0.005, liquidityUsd: 2168488, pools: [...] }

const quote = await eq.quote({ symbol: "NVDA", side: "buy", amount: "100" });
// spend 100 USDG: amountOut, effective price, priceImpactPct, vsTokenPricePct

const trade = await eq.buildTrade({ symbol: "NVDA", side: "buy", amount: "100", recipient: "0xYourWallet" });
// trade.transactions: unsigned approve + swap. Sign and send them yourself, in order.
```

## Methods

| Method | What it returns |
|---|---|
| `assets()`, `asset(symbol)` | Every stock token: contract, multiplier, status |
| `price(symbol)` | Robinhood's token bid/ask and the real stock's quote |
| `stats(symbol)` | Live DEX price vs Robinhood's price (premium), pools, supply, market cap |
| `stats({ sort })` | Every token from the last collector run |
| `history(symbol, { interval, days })` | 1h / 4h / 1d candles |
| `quote({ symbol, side, amount })` | A real Uniswap v3 quote on the best pool |
| `buildTrade({ symbol, side, amount, recipient, slippageBps })` | Unsigned approve + deadline-bound swap (2 calls) |
| `portfolio(address)` | Every stock token a wallet holds, valued live |
| `corporateActions(symbol?)` | Dividends and splits |
| `research(symbol)` | SEC EDGAR: revenue, income, EPS, filings |
| `markets({ hours, limit })` | New Pons launches, with reused-ticker counts |
| `createAlert(...)`, `alert(id)`, `deleteAlert(id)` | 7-day webhook alerts |
| `pricing()` | Price, free calls, payment terms |

Errors are `EquitoError` with the API's `status` and `code`. `eq.last.freeCallsLeft` tells how many free calls are
left today.

## Paying

50 calls a day per IP are free. After that each call costs $0.01 in USDG on Robinhood Chain over x402 ($0.02 for
`buildTrade`). Hand the client a `pay` function and it signs and retries once for you:

```ts
const eq = new Equito({
  pay: async (requirements) => {
    // Sign an x402 v2 "exact" payment for `requirements` with your own wallet
    // (any x402 client library does this) and return the base64 PAYMENT-SIGNATURE payload.
    return signWithMyWallet(requirements);
  },
});
```

Without `pay`, a paid call throws `EquitoError` with `status: 402` and the terms in `paymentRequired`.
Equito never sees, holds or asks for your keys.

## Alerts

```ts
const { alert, webhookSecret } = await eq.createAlert({
  symbol: "NVDA", metric: "premium_pct", op: "above", value: 1, webhookUrl: "https://example.com/hooks/equito",
});
```

Each webhook carries `equito-signature: t=<unix>,v1=<hex>`. Check it with the raw body:

```ts
import { verifyWebhook } from "equito";
const ok = await verifyWebhook(rawBody, request.headers.get("equito-signature")!, webhookSecret);
```

## Links

API: https://api.equito.pro · MCP: https://api.equito.pro/mcp · OpenAPI: https://api.equito.pro/openapi.json ·
llms.txt: https://api.equito.pro/llms.txt

Data, not investment advice.
