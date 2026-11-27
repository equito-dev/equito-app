import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { API_URL as API, SITE_URL as SITE } from '../api/src/hosts.ts'
import { FREE_CALLS_PER_DAY, callPrice } from '../api/src/x402.ts'
import { PAGES, docHref, docTitle } from './src/docs/docs-content.tsx'

// Facts in plain HTML for crawlers, research sites (HEY Research) and agents that do not run JavaScript: the API
// description links in <head>, and a <noscript> block next to the root div with the code, the API, the docs, the MCP
// server, the SDK and, once the token exists, its contract address. The CA comes from src/data/token.ts, the same
// single setting the pages use, so launch day stays one change. Visitors with JavaScript never see the block.
const REPO = 'https://github.com/equito-dev/equito-app'
const EXPLORER = 'https://robinhoodchain.blockscout.com/token/'
const ROOT = '<div id="root"></div>'
const HEAD_END = '</head>'

export function tokenAddress(): string {
  const src = readFileSync(path.resolve(import.meta.dirname, 'src/data/token.ts'), 'utf8')
  const m = src.match(/^export const TOKEN_ADDRESS: string = '([^']*)'/m)
  if (!m) throw new Error('src/data/token.ts: TOKEN_ADDRESS line not found, static facts would miss the CA')
  return m[1]
}

export function apiLinks(): string {
  return [
    `<link rel="service-desc" type="application/json" href="${API}/openapi.json" />`,
    `<link rel="service-doc" href="${API}/llms.txt" />`,
  ].join('\n    ')
}

export function projectFacts(ca: string): string {
  const token = /^0x[0-9a-fA-F]{40}$/.test(ca)
    ? `<p>Token: $EQUITO on Robinhood Chain (chain id 4663), contract <a href="${EXPLORER}${ca}">${ca}</a>. This is the only Equito token. Holders of 2,000,000 $EQUITO pay half for paid API calls.</p>`
    : ''
  return [
    '<noscript>',
    `<p>Equito: stock token data for AI agents and developers on Robinhood Chain (chain id 4663). Every stock token, live prices, the DEX premium over the real stock, Uniswap pool depth, candles, wallet portfolios, corporate actions, SEC research, Pons launches, webhook alerts, Uniswap quotes and unsigned trades. ${FREE_CALLS_PER_DAY} free calls a day per IP, then ${callPrice()} a call in USDG over x402. Equito never holds keys, signs or sends a transaction.</p>`,
    `<p>Code: <a href="${REPO}">${REPO}</a>. API: <a href="${API}">${API}</a>, <a href="${API}/openapi.json">OpenAPI</a>, <a href="${API}/llms.txt">llms.txt</a>, <a href="${API}/.well-known/x402">x402 listing</a>. MCP server: ${API}/mcp. Agent skill: npx skills add equito-dev/equito-app. TypeScript SDK: ${REPO}/tree/main/sdk. Docs: <a href="${SITE}/docs">${SITE}/docs</a>. Market stats: <a href="${SITE}/stats">${SITE}/stats</a>.</p>`,
    token,
    '</noscript>',
  ]
    .filter(Boolean)
    .join('\n    ')
}

// Search and share metadata. The site is one React app, so without this every address would carry the home page's
// title and description. index.html holds a <!--page-meta--> slot; the home page fills it here, and after the build
// seoPages() writes one HTML file per route (dist/stats.html, dist/docs/mcp.html, ...) with that route's own block.
// Cloudflare Pages serves dist/docs/mcp.html at /docs/mcp. Docs titles and leads come from the docs pages themselves.
type Route = { path: string; title: string; description: string }
const META_SLOT = '<!--page-meta-->'
const META_END = '<!--/page-meta-->'
const OG_IMAGE = `${SITE}/og.jpg`

export function routes(): Route[] {
  return [
    {
      path: '/',
      title: 'Equito · Stock token data for AI agents',
      description: `Give your AI agent every stock token on Robinhood Chain: live prices, the DEX premium, SEC filings and ready-to-sign trades, over MCP, an agent skill or plain HTTP. ${callPrice()} a call over x402.`,
    },
    {
      path: '/stats',
      title: 'Stock token market stats · Equito',
      description: 'The stock token market on Robinhood Chain: the deepest pools, the highest premium and the biggest discount against the real stock.',
    },
    ...PAGES.map((p) => ({ path: docHref(p.slug), title: docTitle(p), description: p.lead })),
  ]
}

const attr = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')

export function pageMeta(r: Route): string {
  const url = r.path === '/' ? `${SITE}/` : SITE + r.path
  const tags = [
    `<title>${attr(r.title)}</title>`,
    `<meta name="description" content="${attr(r.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Equito" />`,
    `<meta property="og:title" content="${attr(r.title)}" />`,
    `<meta property="og:description" content="${attr(r.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="Equito: every stock token, one API call" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${attr(r.title)}" />`,
    `<meta name="twitter:description" content="${attr(r.description)}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
  ]
  if (r.path === '/') {
    const schema = {
      '@context': 'https://schema.org',
      '@type': 'WebAPI',
      name: 'Equito',
      description: r.description,
      url,
      documentation: `${SITE}/docs`,
      provider: { '@type': 'Organization', name: 'Equito', url, logo: `${SITE}/icon-512.png`, sameAs: [REPO] },
    }
    tags.push(`<script type="application/ld+json">${JSON.stringify(schema)}</script>`)
  }
  return [META_SLOT, ...tags, META_END].join('\n    ')
}

export function sitemap(all: Route[]): string {
  const urls = all.map((r) => `  <url><loc>${r.path === '/' ? `${SITE}/` : SITE + r.path}</loc></url>`)
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">', ...urls, '</urlset>', ''].join('\n')
}

export const robots = (): string => `User-agent: *\nAllow: /\nDisallow: /internal/\n\nSitemap: ${SITE}/sitemap.xml\n`

function staticFacts(): Plugin {
  return {
    name: 'equito-static-facts',
    transformIndexHtml: (html) => {
      if (!html.includes(ROOT)) throw new Error('index.html lost the root div')
      if (!html.includes(HEAD_END)) throw new Error('index.html lost </head>')
      if (!html.includes(META_SLOT)) throw new Error('index.html lost the <!--page-meta--> slot')
      return html
        .replace(META_SLOT, pageMeta(routes()[0]))
        .replace(HEAD_END, '  ' + apiLinks() + '\n  ' + HEAD_END)
        .replace(ROOT, ROOT + '\n    ' + projectFacts(tokenAddress()))
    },
  }
}

function seoPages(): Plugin {
  let outDir = ''
  return {
    name: 'equito-seo-pages',
    apply: 'build',
    configResolved: (c) => { outDir = path.resolve(c.root, c.build.outDir) },
    closeBundle() {
      const home = readFileSync(path.join(outDir, 'index.html'), 'utf8')
      const block = new RegExp(`${META_SLOT}[\\s\\S]*?${META_END}`)
      if (!block.test(home)) throw new Error('built index.html has no page-meta block')
      const all = routes()
      for (const r of all.slice(1)) {
        const file = path.join(outDir, `${r.path.slice(1)}.html`)
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, home.replace(block, pageMeta(r)))
      }
      writeFileSync(path.join(outDir, 'sitemap.xml'), sitemap(all))
      writeFileSync(path.join(outDir, 'robots.txt'), robots())
    },
  }
}

// The agent skill lives in the repo (skills/equito/SKILL.md) for `npx skills add`; the site also serves it at
// /SKILL.md so `hermes skills install https://equito.pages.dev/SKILL.md` and plain fetches get the same file.
function agentSkill(): Plugin {
  return {
    name: 'equito-agent-skill',
    generateBundle() {
      const source = readFileSync(path.resolve(import.meta.dirname, '../skills/equito/SKILL.md'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'SKILL.md', source })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), staticFacts(), agentSkill(), seoPages()],
  // /docs reads the API's own endpoint catalog (../api/src/discovery.ts), so the docs cannot drift from the API.
  server: { fs: { allow: ['..'] } },
})
