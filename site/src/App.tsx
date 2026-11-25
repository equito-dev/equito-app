import { useState } from 'react'
import { ArrowRight, Bot, Check, Coins, Copy, FileText, Gauge, KeyRound, LineChart, Repeat, Zap } from 'lucide-react'
import { TOKEN_ADDRESS } from './data/token'
import { DEMO, MARKETS, type Row } from './data/markets'

const API = 'https://api.equito.pro'
const DOCS = 'https://docs.equito.pro'
const REPO = 'https://github.com/equito-dev/equito-app'

export default function App() {
  return (
    <div className="min-h-screen bg-paper">
      <Nav />
      <TickerTape />
      <Hero />
      <Markets />
      <CodeSection />
      <Products />
      <Pricing />
      {TOKEN_ADDRESS && <Token address={TOKEN_ADDRESS} />}
      <Closing />
      <Footer />
    </div>
  )
}

function Nav() {
  return (
    <header className="sticky top-0 z-20 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-8">
        <a href="/" className="font-mono text-[15px] font-medium tracking-[0.22em]">EQUITO</a>
        <nav className="hidden items-center gap-8 text-sm text-muted md:flex">
          <a href="#api" className="hover:text-ink">API</a>
          <a href="#products" className="hover:text-ink">Products</a>
          <a href="#pricing" className="hover:text-ink">Pricing</a>
          <a href={DOCS} className="hover:text-ink">Docs</a>
          <a href="/stats" className="hover:text-ink">Stats</a>
        </nav>
        <a href={DOCS} className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-black">
          Get started <ArrowRight size={15} />
        </a>
      </div>
    </header>
  )
}

const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}%`
const tone = (n: number) => (n > 0 ? 'text-up' : n < 0 ? 'text-down' : 'text-muted')
const usd = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function TickerTape() {
  const items = [...MARKETS, ...MARKETS]
  return (
    <div className="overflow-hidden bg-ink text-white">
      <div className="ticker flex w-max gap-10 py-2.5 font-mono text-xs">
        {items.map((m, i) => (
          <span key={i} className="num flex items-center gap-2 whitespace-nowrap">
            <span className="font-medium tracking-wider">{m.ticker}</span>
            <span className="text-zinc-300">{usd(m.price)}</span>
            <span className={m.changePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{pct(m.changePct)}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function Spark({ data, up }: { data: number[]; up: boolean }) {
  const min = Math.min(...data)
  const max = Math.max(...data)
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 24 - 2}`).join(' ')
  return (
    <svg viewBox="0 0 100 28" className="h-7 w-24" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? 'var(--color-up)' : 'var(--color-down)'} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Markets() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// Markets</p>
          <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
            The token price, the real stock, and the gap between them.
          </h2>
        </div>
        {DEMO && <span className="rounded-full border border-line px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted">Demo data</span>}
      </div>
      <div className="mt-12 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="num w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line bg-[#fafafa] text-left font-mono text-[11px] uppercase tracking-[0.12em] text-muted">
              <th className="px-6 py-4 font-normal">Token</th>
              <th className="px-6 py-4 text-right font-normal">Price</th>
              <th className="px-6 py-4 text-right font-normal">24h</th>
              <th className="px-6 py-4 text-right font-normal">Premium vs stock</th>
              <th className="px-6 py-4 text-right font-normal">7d</th>
            </tr>
          </thead>
          <tbody>
            {MARKETS.map((m: Row) => (
              <tr key={m.ticker} className="border-b border-line/70 last:border-0 hover:bg-[#fafafa]">
                <td className="px-6 py-4">
                  <span className="font-semibold">{m.ticker}</span>
                  <span className="ml-3 text-muted">{m.name}</span>
                </td>
                <td className="px-6 py-4 text-right font-medium">{usd(m.price)}</td>
                <td className={`px-6 py-4 text-right ${tone(m.changePct)}`}>{pct(m.changePct)}</td>
                <td className="px-6 py-4 text-right text-muted">{pct(m.premiumPct)}</td>
                <td className="px-6 py-4">
                  <div className="flex justify-end">
                    <Spark data={m.spark} up={m.changePct >= 0} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const FADE = 'linear-gradient(to right, transparent, black 28%, black 90%, transparent), linear-gradient(to bottom, transparent, black 8%, black 92%, transparent)'
// White on the left (headline), easing into the Flow image's own gray (#f3f3f3) on the right.
const HERO_BG = 'linear-gradient(90deg, #ffffff 0%, #ffffff 25%, #f3f3f3 62%, #f3f3f3 100%)'

function Hero() {
  return (
    <section className="relative overflow-hidden" style={{ background: HERO_BG }}>
      <img
        src="/media/hero-candles.webp"
        alt=""
        style={{ maskImage: FADE, WebkitMaskImage: FADE, maskComposite: 'intersect', WebkitMaskComposite: 'source-in' }}
        className="pointer-events-none absolute right-0 top-[5%] h-[90%] w-auto max-w-none opacity-20 lg:right-[2%] lg:opacity-100 2xl:right-[6%]"
      />
      {/* Hero melts into the white page below. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" />
      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-20 sm:px-8 md:pb-24 md:pt-28">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
          Stock token data for AI agents · Robinhood Chain
        </p>
        <h1 className="mt-6 max-w-3xl text-5xl font-semibold leading-[0.98] tracking-[-0.045em] sm:text-7xl xl:text-[80px]">
          Every stock token.
          <br className="hidden sm:block" /> One API call.
        </h1>
        <p className="mt-6 max-w-xl text-lg leading-relaxed text-muted">
          Live prices, the DEX premium over the real stock, SEC filings and ready-to-sign trades for every stock token on
          Robinhood Chain. <span className="text-ink">$0.01 a call over x402. No key, no signup.</span>
        </p>
        <div className="mt-9 flex flex-wrap gap-3">
          <a href="#api" className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-medium text-white hover:bg-black">
            Try a free call <ArrowRight size={15} />
          </a>
          <a href={DOCS} className="rounded-lg border border-line bg-white px-5 py-3 text-sm font-medium hover:border-ink/30">
            Read the docs
          </a>
        </div>
        <div className="mt-14 grid max-w-2xl gap-6 sm:grid-cols-3">
          <Feature icon={<Zap size={16} />} title="50 free calls a day" sub="Then $0.01 per call" />
          <Feature icon={<Bot size={16} />} title="Agent ready" sub="x402 and MCP built in" />
          <Feature icon={<KeyRound size={16} />} title="No keys, ever" sub="You sign every trade" />
        </div>
      </div>
    </section>
  )
}

function Feature({ icon, title, sub }: { icon: React.ReactNode; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-white">{icon}</span>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="text-sm text-muted">{sub}</p>
      </div>
    </div>
  )
}

const SAMPLES: Record<string, string> = {
  cURL: `# Free: 50 calls a day per IP, no key
curl ${API}/v1/stats/NVDA

# Executable quote: buy $100 of NVDA with USDG
curl "${API}/v1/quote?ticker=NVDA&amountUsd=100"

# Unsigned approve + swap. You sign it, we never do.
curl -X POST ${API}/v1/trade/build \\
  -d '{"ticker":"NVDA","amountUsd":100,"recipient":"0x..."}'`,
  'x402 agent': `// Past the free calls the API answers 402 with the price.
// Any x402 client pays $0.01 in USDG on Robinhood Chain and retries.
const res = await fetchWithPayment("${API}/v1/stats/NVDA")
const stats = await res.json()

stats.price        // token price on the DEX
stats.equityPrice  // the real stock, times the multiplier
stats.premiumPct   // how far the token trades from the stock`,
  MCP: `{
  "mcpServers": {
    "equito": { "url": "${API}/mcp" }
  }
}
// Tools: assets, prices, history, stats, research,
// portfolio, corporate_actions, markets, quote, trade_build`,
}

function CodeSection() {
  const tabs = Object.keys(SAMPLES)
  const [tab, setTab] = useState(tabs[0])
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(SAMPLES[tab]).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <section id="api" className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-8 lg:grid-cols-[1fr_1.25fr] lg:items-center">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// One API</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Price it. Research it.
          <br />
          Trade it.
        </h2>
        <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
          Eleven endpoints cover the whole job, from the token list to a swap your wallet only has to sign. Same answers
          for a developer with cURL and an agent paying per call.
        </p>
        <ul className="mt-8 space-y-3 text-sm">
          {['Token registry straight from Robinhood', 'Prices from the Uniswap v3 pools on chain', 'Filings and fundamentals from SEC EDGAR'].map((t) => (
            <li key={t} className="flex items-center gap-3">
              <Check size={16} className="text-ink" /> {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="overflow-hidden rounded-2xl border border-line bg-[#0c0c0e] text-[13px] text-zinc-200 shadow-[0_30px_80px_-40px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-white/10 px-4">
          <div className="flex">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`border-b-2 px-3 py-3 font-mono text-xs ${t === tab ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={copy} className="flex items-center gap-1.5 font-mono text-xs text-zinc-400 hover:text-white">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="overflow-x-auto p-5 font-mono leading-relaxed">
          <code>{SAMPLES[tab]}</code>
        </pre>
      </div>
    </section>
  )
}

const PRODUCTS = [
  { icon: <LineChart size={18} />, name: 'Market data', body: 'Every stock token with its contract, multiplier and status. Live prices, candles and 24h change.', paths: 'assets · prices · history' },
  { icon: <Gauge size={18} />, name: 'Stats', body: 'Supply, pool liquidity and the premium of each token over the real stock, in one answer.', paths: 'stats · markets' },
  { icon: <FileText size={18} />, name: 'Research', body: 'SEC filings and fundamentals, plus splits and dividends that change the token multiplier.', paths: 'research · corporate-actions' },
  { icon: <Repeat size={18} />, name: 'Trade', body: 'A real Uniswap quote, then an unsigned approve and swap. We never hold keys or send anything.', paths: 'quote · trade/build' },
  { icon: <Coins size={18} />, name: 'Portfolio', body: 'Every stock token a wallet holds, valued at the live price.', paths: 'portfolio/:address' },
  { icon: <Bot size={18} />, name: 'Alerts', body: 'A webhook when a price, premium or multiplier crosses the line you set.', paths: 'alerts' },
]

function Products() {
  return (
    <section id="products" className="bg-paper">
      <div className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// Products</p>
        <h2 className="mt-4 max-w-2xl text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">
          Everything an app or an agent needs to work with stock tokens.
        </h2>
        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCTS.map((p) => (
            <div key={p.name} className="rounded-2xl border border-line bg-white p-7 transition hover:border-ink/25">
              <span className="grid h-10 w-10 place-items-center rounded-lg border border-line">{p.icon}</span>
              <h3 className="mt-6 text-lg font-semibold">{p.name}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{p.body}</p>
              <p className="mt-6 font-mono text-xs text-muted">{p.paths}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function Pricing() {
  const rows = [
    ['Free', '50 calls a day per IP', 'No key, no wallet'],
    ['Per call', '$0.01', 'Paid in USDG over x402'],
    ['trade/build', '$0.02', 'Unsigned approve + swap'],
  ]
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-4 py-24 sm:px-8">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// Pricing</p>
      <h2 className="mt-4 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">Pay per call. Nothing else.</h2>
      <div className="mt-12 grid gap-4 md:grid-cols-3">
        {rows.map(([name, price, note]) => (
          <div key={name} className="rounded-2xl border border-line bg-white p-7">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">{name}</p>
            <p className="num mt-4 text-4xl font-semibold tracking-tight">{price}</p>
            <p className="mt-2 text-sm text-muted">{note}</p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted">Holders of 2,000,000 $EQUITO or more pay half on every paid call.</p>
    </section>
  )
}

function Token({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <section className="bg-paper">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-16 sm:px-8 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// $EQUITO</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight">Hold 2,000,000 and every paid call costs half.</p>
        </div>
        <button
          onClick={() => navigator.clipboard.writeText(address).then(() => setCopied(true))}
          className="flex items-center gap-3 rounded-xl border border-line bg-white px-4 py-3 font-mono text-sm"
        >
          <span className="rounded-md bg-ink px-2 py-1 text-xs text-white">CA</span>
          {address.slice(0, 6)}…{address.slice(-4)}
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </section>
  )
}

function Closing() {
  return (
    <section>
      <div className="mx-auto max-w-7xl px-4 py-24 text-center sm:px-8">
        <h2 className="mx-auto max-w-3xl text-4xl font-semibold tracking-[-0.03em] sm:text-6xl">
          Stock tokens, readable by any agent.
        </h2>
        <div className="mt-9 flex justify-center gap-3">
          <a href={DOCS} className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-medium text-white hover:bg-black">
            Start building <ArrowRight size={15} />
          </a>
          <a href={REPO} className="rounded-lg border border-line px-5 py-3 text-sm font-medium hover:border-ink/30">
            GitHub
          </a>
        </div>
      </div>
    </section>
  )
}

function Footer() {
  return (
    <footer>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:px-8 md:flex-row md:justify-between">
        <span className="font-mono tracking-[0.18em] text-ink">EQUITO</span>
        <span>Data on Robinhood Chain. Not investment advice. We never hold keys or execute trades.</span>
      </div>
    </footer>
  )
}
