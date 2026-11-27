// Live market data for the ticker tape and the markets table: one read of GET /public/board (free, not metered,
// cached 5 minutes by the API), so a visitor never spends their own free calls. No demo numbers: when the read
// fails the table says so instead of showing anything made up.
import { useEffect, useState } from 'react'

// The address lives in api/src/hosts.ts, shared with the API, so domain day is one change.
import { API_URL } from '../../../api/src/hosts.ts'
export const API_BASE: string = API_URL

export type BoardToken = {
  symbol: string
  name: string | null
  tokenPrice: number
  dexPrice: number
  premiumPct: number | null
  liquidityUsd: number | null
  changePct: number | null // over the sparkline window (about the last day)
  spark: number[]
}
export type Board = { status: 'loading' | 'ready' | 'error'; tokens: BoardToken[]; updatedAt: string | null }

export function useBoard(): Board {
  const [board, setBoard] = useState<Board>({ status: 'loading', tokens: [], updatedAt: null })
  useEffect(() => {
    let alive = true
    const load = () =>
      fetch(API_BASE + '/public/board')
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((b: { tokens: BoardToken[]; updatedAt: string | null }) => alive && setBoard({ status: 'ready', tokens: b.tokens ?? [], updatedAt: b.updatedAt }))
        .catch(() => alive && setBoard((prev) => (prev.status === 'ready' ? prev : { status: 'error', tokens: [], updatedAt: null })))
    load()
    const timer = setInterval(load, 5 * 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return board
}
