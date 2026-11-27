// /stats: the on-chain stock token market at a glance, from GET /public/overview (free, cached 5 minutes).
import { useEffect, useState } from 'react'
import { API_BASE } from '../data/board'
import { ago, pct, timeUtc, tone, usd, usdShort } from '../lib/format'

type Brief = { symbol: string; name: string | null; tokenPrice: number | null; dexPrice: number | null; premiumPct: number | null; liquidityUsd: number | null }
type Overview = {
  updatedAt: string | null
  totals: { tokens: number; tokensWithPool: number; liquidityUsd: number; medianPremiumPct: number | null; launches24h: number }
  deepest: Brief[]
  premiums: Brief[]
  discounts: Brief[]
  newestLaunches: { token: string; symbol: string | null; name: string | null; createdAt: string }[]
  note: string
}

function useOverview() {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; data: Overview | null }>({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true
    fetch(API_BASE + '/public/overview')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: Overview) => alive && setState({ status: 'ready', data }))
      .catch(() => alive && setState({ status: 'error', data: null }))
    return () => {
      alive = false
    }
  }, [])
  return state
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="num mt-3 text-3xl font-semibold tracking-tight">{value}</p>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  )
}

function Table({ title, rows, show }: { title: string; rows: Brief[]; show: 'premium' | 'depth' }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-white">
      <p className="border-b border-line bg-[#fafafa] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.14em] text-muted">{title}</p>
      <table className="num w-full text-sm">
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-b border-line/70 last:border-0">
              <td className="px-5 py-3">
                <span className="font-semibold">{r.symbol}</span>
                <span className="ml-2 inline-block max-w-[160px] truncate align-bottom text-muted">{r.name}</span>
              </td>
              <td className="px-5 py-3 text-right">{r.tokenPrice === null ? '—' : usd(r.tokenPrice)}</td>
              <td className={`px-5 py-3 text-right ${show === 'premium' && r.premiumPct !== null ? tone(r.premiumPct) : 'text-muted'}`}>
                {show === 'premium' ? (r.premiumPct === null ? '—' : pct(r.premiumPct)) : r.liquidityUsd === null ? '—' : usdShort(r.liquidityUsd)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function StatsPage() {
  const { status, data } = useOverview()
  return (
    <main className="mx-auto max-w-7xl px-4 py-20 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// Stats</p>
          <h1 className="mt-4 max-w-3xl text-5xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl">The stock token market on Robinhood Chain.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Every stock token, its Uniswap pools and how far the on-chain price sits from Robinhood's. Read about every hour.</p>
        </div>
        {data?.updatedAt && (
          <span className="flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-up" /> Updated {timeUtc(data.updatedAt)}
          </span>
        )}
      </div>

      {status !== 'ready' || !data ? (
        <p className="mt-16 rounded-2xl border border-line bg-white px-6 py-10 text-center text-muted">
          {status === 'loading' ? 'Loading the market…' : 'The market numbers could not be loaded right now.'}
        </p>
      ) : (
        <>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Stock tokens" value={String(data.totals.tokens)} sub={`${data.totals.tokensWithPool} with a live Uniswap pool`} />
            <Kpi label="On-chain liquidity" value={usdShort(data.totals.liquidityUsd)} sub="every USDG pool, both sides" />
            <Kpi label="Median premium" value={data.totals.medianPremiumPct === null ? '—' : pct(data.totals.medianPremiumPct)} sub="pools with $10K+ depth" />
            <Kpi label="Pons launches" value={String(data.totals.launches24h)} sub="in the last 24 hours" />
          </div>

          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            <Table title="Deepest pools" rows={data.deepest} show="depth" />
            <Table title="Highest premium" rows={data.premiums} show="premium" />
            <Table title="Biggest discount" rows={data.discounts} show="premium" />
          </div>
          <p className="mt-4 text-xs text-muted">{data.note} Premium: the deepest pool's price against Robinhood's price for one token. Data, not investment advice.</p>

          {data.newestLaunches.length > 0 && (
            <div className="mt-14">
              <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// Newest Pons launches</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {data.newestLaunches.map((l) => (
                  <a key={l.token} href={`https://robinhoodchain.blockscout.com/token/${l.token}`} className="rounded-2xl border border-line bg-white p-5 hover:border-ink/25">
                    <p className="font-semibold">{l.symbol ?? 'Unnamed'}</p>
                    <p className="truncate text-sm text-muted">{l.name ?? l.token}</p>
                    <p className="mt-3 font-mono text-xs text-muted">{ago(l.createdAt)}</p>
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </main>
  )
}
