---
name: equito
description: Live data and ready-to-sign trades for every stock token (tokenized stocks such as NVDA, AAPL, TSLA) on Robinhood Chain, through the Equito API or its MCP server. Use when the user asks about a stock token's price, its premium or discount to the real stock, Uniswap pool depth, candles, a wallet's stock-token holdings, dividends and splits, SEC fundamentals, new token launches, price alerts, a swap quote, or wants to buy or sell a stock token on Robinhood Chain.
metadata:
  homepage: https://equito.pages.dev
  docs: https://equito.pages.dev/docs
---

# Equito

Equito answers questions about stock tokens on Robinhood Chain (chain id 4663): the Robinhood-issued tokens that track real shares. Base URL: `https://equito.pages.dev`. Every answer is JSON; errors look like `{"error": {"code", "message"}}`.

## Pick a way in

1. **MCP tools** (best when your client has them): the server is `https://equito.pages.dev/mcp` (streamable HTTP). One tool per endpoint below, plus `get_pricing`.
2. **HTTP**: `GET https://equito.pages.dev/v1/...` with any HTTP client. No key, no signup.
3. **Machine-readable lists**: `https://equito.pages.dev/llms.txt` and `https://equito.pages.dev/openapi.json`.

## Cost

- 50 calls a day per IP are free. The header `x-free-calls-left` counts down.
- After that a call answers **402** with x402 payment terms: $0.02 per call in USDG on Robinhood Chain ($0.04 for `trade/build`). An x402 client signs and retries; over MCP, call the tool again with `payment_signature`.
- Never pay without the user's say-so. Tell them the price first.

## Endpoints (all under /v1)

| Ask | Call | MCP tool |
|---|---|---|
| Every stock token | `GET /v1/assets` | `list_assets` |
| One token's registry entry | `GET /v1/assets/{symbol}` | `get_asset` |
| Robinhood's token price and the real stock's quote | `GET /v1/prices/{symbol}` | `get_price` |
| DEX price, premium vs the stock, pool depth, supply | `GET /v1/stats/{symbol}` | `get_stats` |
| Every token ranked (liquidity, premium or symbol) | `GET /v1/stats?sort=liquidity` | `list_stats` |
| Candles | `GET /v1/history/{symbol}?interval=1h&days=7` | `get_history` |
| Uniswap quote | `GET /v1/quote?symbol=NVDA&side=buy&amount=100` | `get_quote` |
| Unsigned approve + swap | `POST /v1/trade/build` | `build_trade` |
| A wallet's stock tokens | `GET /v1/portfolio/{address}` | `get_portfolio` |
| Dividends and splits | `GET /v1/corporate-actions` | `corporate_actions` |
| SEC fundamentals and filings | `GET /v1/research/{symbol}` | `get_research` |
| New launches on Robinhood Chain | `GET /v1/markets?hours=24` | `list_launches` |
| Webhook alert (7 days) | `POST /v1/alerts` | `create_alert` |
| An alert's state / stop it | `GET` or `DELETE /v1/alerts/{id}` (free) | `get_alert`, `delete_alert` |

`side` is `buy` (spend `amount` USDG) or `sell` (spend `amount` tokens). `trade/build` takes JSON `{"symbol", "side", "amount", "recipient", "slippageBps"?}`.

## Reading the numbers

- `tokenPrice`: Robinhood's price for one token (already times the multiplier).
- `dexPrice`: the deepest Uniswap v3 USDG pool.
- `premiumPct`: `dexPrice` against `tokenPrice` in percent. Positive means the token costs more on chain. Outside US market hours the two drift apart.
- `liquidityUsd`: every USDG pool of the token, both sides.
- Lists, candles and launches come from a collector that reads the chain about once an hour; each answer says when.

## Rules for trades

- `trade/build` returns **unsigned** transactions (approve, then swap). Equito never holds keys, never signs, never sends.
- Show the user the quote, the price impact and every transaction before they sign. Never sign or send on their behalf unless they explicitly ask and their wallet tooling asks them to confirm.
- Equito is data, not investment advice. Say so when the user asks what to buy.

## Example

```bash
curl https://equito.pages.dev/v1/stats/NVDA
curl "https://equito.pages.dev/v1/quote?symbol=NVDA&side=buy&amount=100"
```
