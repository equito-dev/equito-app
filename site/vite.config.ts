import { readFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { API_URL as API, SITE_URL as SITE } from '../api/src/hosts.ts'
import { FREE_CALLS_PER_DAY, callPrice } from '../api/src/x402.ts'

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

// index.html writes the call price as this slot, filled from the API's own price setting.
const PRICE_SLOT = '%CALL_PRICE%'

function staticFacts(): Plugin {
  return {
    name: 'equito-static-facts',
    transformIndexHtml: (html) => {
      if (!html.includes(ROOT)) throw new Error('index.html lost the root div')
      if (!html.includes(HEAD_END)) throw new Error('index.html lost </head>')
      return html
        .replaceAll(PRICE_SLOT, callPrice())
        .replace(HEAD_END, '  ' + apiLinks() + '\n  ' + HEAD_END)
        .replace(ROOT, ROOT + '\n    ' + projectFacts(tokenAddress()))
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
  plugins: [react(), tailwindcss(), staticFacts(), agentSkill()],
  // /docs reads the API's own endpoint catalog (../api/src/discovery.ts), so the docs cannot drift from the API.
  server: { fs: { allow: ['..'] } },
})
