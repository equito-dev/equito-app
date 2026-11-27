// /docs and /docs/*: a sidebar of grouped pages, one topic per page, "On this page" from the page's own headings,
// previous/next links and a search box (⌘K or /) over page titles and every endpoint. Pages live in
// ../docs/docs-content.tsx.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Menu, Search } from 'lucide-react'
import { CATALOG } from '../../../api/src/discovery.ts'
import { GROUPS, PAGES, docHref, endpointTitle } from '../docs/docs-content'

type Hit = { title: string; sub: string; href: string }

const INDEX: Hit[] = [
  ...PAGES.map((p) => ({ title: p.title, sub: `${p.group} · ${p.lead}`, href: docHref(p.slug) })),
  ...CATALOG.map((e) => {
    const page = PAGES.find((p) => p.endpoints?.includes(e))
    return { title: endpointTitle(e), sub: `${e.tool} · ${e.summary}`, href: `${docHref(page?.slug ?? '')}#${e.tool}` }
  }),
]

function search(q: string): Hit[] {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return INDEX.slice(0, 8)
  return INDEX.filter((h) => words.every((w) => (h.title + ' ' + h.sub).toLowerCase().includes(w))).slice(0, 12)
}

function SearchDialog({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const hits = useMemo(() => search(q), [q])
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])
  const go = (h?: Hit) => { if (h) window.location.href = h.href }
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-ink/20 px-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Search the docs" className="w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={16} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setI(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') { e.preventDefault(); setI((n) => Math.min(n + 1, hits.length - 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI((n) => Math.max(n - 1, 0)) }
              if (e.key === 'Enter') go(hits[i])
            }}
            placeholder="Search pages and endpoints"
            aria-label="Search pages and endpoints"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line px-1.5 font-mono text-[11px] text-muted">esc</kbd>
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-2">
          {hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-muted">Nothing found for “{q}”.</li>}
          {hits.map((h, n) => (
            <li key={h.href + h.title}>
              <a href={h.href} onMouseEnter={() => setI(n)} className={`block rounded-lg px-3 py-2.5 ${n === i ? 'bg-zinc-100' : ''}`}>
                <p className="text-sm font-medium">{h.title}</p>
                <p className="truncate text-xs text-muted">{h.sub}</p>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Sidebar({ slug, onSearch }: { slug: string; onSearch: () => void }) {
  return (
    <nav aria-label="Docs" className="space-y-7 text-sm">
      <button onClick={onSearch} className="flex w-full items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-muted hover:border-ink/30">
        <Search size={14} /> <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-line px-1.5 font-mono text-[11px]">⌘K</kbd>
      </button>
      {GROUPS.map((g) => (
        <div key={g.label}>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">{g.label}</p>
          <ul className="space-y-0.5">
            {g.pages.map((p) => (
              <li key={p.slug}>
                <a
                  href={docHref(p.slug)}
                  aria-current={p.slug === slug ? 'page' : undefined}
                  className={`block rounded-md px-3 py-1.5 ${p.slug === slug ? 'bg-zinc-100 font-medium text-ink' : 'text-muted hover:text-ink'}`}
                >
                  {p.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

// "On this page": the h2 headings the page rendered, with the one in view marked.
function OnThisPage({ slug }: { slug: string }) {
  const [heads, setHeads] = useState<{ id: string; text: string }[]>([])
  const [active, setActive] = useState('')
  useEffect(() => {
    const els = [...document.querySelectorAll<HTMLHeadingElement>('article h2[id]')]
    setHeads(els.map((h) => ({ id: h.id, text: h.textContent ?? '' })))
    const onScroll = () => {
      const above = els.filter((h) => h.getBoundingClientRect().top < 120)
      setActive((above.at(-1) ?? els[0])?.id ?? '')
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [slug])
  if (heads.length < 2) return null
  return (
    <nav aria-label="On this page" className="text-sm">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.16em] text-muted">On this page</p>
      <ul className="space-y-2 border-l border-line">
        {heads.map((h) => (
          <li key={h.id}>
            <a href={`#${h.id}`} className={`-ml-px block border-l pl-3 ${h.id === active ? 'border-ink text-ink' : 'border-transparent text-muted hover:text-ink'}`}>
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

export function DocsPage({ slug }: { slug: string }) {
  const at = PAGES.findIndex((p) => p.slug === slug)
  const page = PAGES[at]
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    document.title = page ? `${page.title} · Equito docs` : 'Not found · Equito docs'
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView()
  }, [page])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault()
        setSearching(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const prev = at > 0 ? PAGES[at - 1] : null
  const next = at >= 0 && at < PAGES.length - 1 ? PAGES[at + 1] : null

  return (
    <div className="mx-auto grid max-w-[1400px] gap-10 px-4 sm:px-8 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_200px]">
      <aside className="hidden lg:block">
        <div className="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10 pr-2">
          <Sidebar slug={slug} onSearch={() => setSearching(true)} />
        </div>
      </aside>

      <article className="min-w-0 max-w-3xl py-10 lg:py-14">
        <details className="mb-8 rounded-xl border border-line lg:hidden">
          <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium"><Menu size={15} /> Docs menu</summary>
          <div className="border-t border-line p-4"><Sidebar slug={slug} onSearch={() => setSearching(true)} /></div>
        </details>

        {page ? (
          <>
            <p className="font-mono text-xs uppercase tracking-[0.16em] text-muted">{page.group}</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.03em] sm:text-5xl">{page.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-muted">{page.lead}</p>
            <div className="mt-2">{page.body()}</div>

            <div className="mt-16 grid gap-3 border-t border-line pt-8 sm:grid-cols-2">
              {prev ? (
                <a href={docHref(prev.slug)} className="rounded-xl border border-line p-4 hover:border-ink/30">
                  <span className="flex items-center gap-1 text-xs text-muted"><ArrowLeft size={13} /> Previous</span>
                  <span className="mt-1 block font-medium">{prev.title}</span>
                </a>
              ) : <span />}
              {next && (
                <a href={docHref(next.slug)} className="rounded-xl border border-line p-4 text-right hover:border-ink/30">
                  <span className="flex items-center justify-end gap-1 text-xs text-muted">Next <ArrowRight size={13} /></span>
                  <span className="mt-1 block font-medium">{next.title}</span>
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <h1 className="text-4xl font-semibold tracking-[-0.03em]">Page not found</h1>
            <p className="mt-4 text-muted">That docs page does not exist. <a href="/docs" className="font-medium text-ink underline underline-offset-4">Start from the introduction</a> or search with ⌘K.</p>
          </>
        )}
        <p className="mt-10 text-xs text-muted">Data on Robinhood Chain. Not investment advice. Equito never holds keys or signs a transaction.</p>
      </article>

      <aside className="hidden xl:block">
        <div className="sticky top-16 py-14">{page && <OnThisPage slug={slug} />}</div>
      </aside>

      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </div>
  )
}
