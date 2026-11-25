// DEMO numbers for the design only. Replace with GET https://api.equito.pro/v1/stats once the API is live.
// The site labels them "Demo data" until then, so nobody reads them as real prices.
export const DEMO = true

export type Row = {
  ticker: string
  name: string
  price: number
  changePct: number
  premiumPct: number
  spark: number[]
}

export const MARKETS: Row[] = [
  { ticker: 'NVDA', name: 'NVIDIA', price: 144.73, changePct: 2.41, premiumPct: 0.18, spark: [40, 42, 41, 44, 47, 46, 49, 52, 51, 55] },
  { ticker: 'AAPL', name: 'Apple', price: 349.77, changePct: 0.84, premiumPct: -0.06, spark: [50, 49, 51, 52, 51, 53, 52, 54, 55, 55] },
  { ticker: 'TSLA', name: 'Tesla', price: 364.73, changePct: -1.92, premiumPct: 0.31, spark: [60, 58, 59, 56, 55, 57, 53, 52, 54, 51] },
  { ticker: 'MSFT', name: 'Microsoft', price: 485.2, changePct: 0.37, premiumPct: 0.04, spark: [48, 49, 48, 50, 49, 51, 50, 51, 52, 52] },
  { ticker: 'SPY', name: 'SPDR S&P 500 ETF', price: 703.52, changePct: 0.52, premiumPct: 0.02, spark: [45, 46, 46, 47, 48, 47, 49, 49, 50, 51] },
  { ticker: 'QQQ', name: 'Invesco QQQ', price: 613.32, changePct: 0.96, premiumPct: 0.05, spark: [44, 45, 47, 46, 48, 49, 48, 50, 52, 53] },
  { ticker: 'COIN', name: 'Coinbase', price: 96.71, changePct: -3.12, premiumPct: 0.44, spark: [62, 60, 61, 57, 58, 54, 55, 52, 50, 49] },
  { ticker: 'AMZN', name: 'Amazon', price: 241.05, changePct: 1.18, premiumPct: 0.09, spark: [42, 43, 45, 44, 46, 47, 46, 48, 49, 50] },
]
