// Every docs page: its place in the sidebar and its body. The API reference pages are built from the API's own
// endpoint catalog (api/src/discovery.ts), the same list behind openapi.json, llms.txt, the x402 listing and the MCP
// tools, so the reference cannot drift from the API. Any endpoint not placed in a reference group below still shows
// up, on a catch-all page.
import type { ReactNode } from 'react'
import { CATALOG, type Entry } from '../../../api/src/discovery.ts'
import { API_URL as API, SITE_URL as SITE } from '../../../api/src/hosts.ts'
import { FREE_CALLS_PER_DAY, USDG, callPrice } from '../../../api/src/x402.ts'
import { TOKEN_ADDRESS } from '../data/token'
import { CodeBlock } from './code-block'

const REPO = 'https://github.com/equito-dev/equito-app'
const SKILL_REPO = 'equito-dev/equito-app'

export type DocPage = { slug: string; title: string; lead: string; body: () => ReactNode; endpoints?: Entry[] }
export type DocGroup = { label: string; pages: DocPage[] }

export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function H2({ children, id }: { children: string; id?: string }) {
  return <h2 id={id ?? slugify(children)} className="mt-12 scroll-mt-24 text-2xl font-semibold tracking-tight">{children}</h2>
}
const P = ({ children }: { children: ReactNode }) => <p className="mt-4 leading-relaxed text-muted">{children}</p>
const C = ({ children }: { children: ReactNode }) => <code className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] text-ink">{children}</code>
const A = ({ href, children }: { href: string; children: ReactNode }) => <a href={href} className="font-medium text-ink underline decoration-line underline-offset-4 hover:decoration-ink">{children}</a>
const List = ({ items }: { items: ReactNode[] }) => (
  <ul className="mt-4 space-y-2 text-muted">{items.map((it, i) => <li key={i} className="flex gap-3"><span className="mt-2.5 h-1 w-1 shrink-0 rounded-full bg-ink/40" /><span>{it}</span></li>)}</ul>
)
const Note = ({ children }: { children: ReactNode }) => (
  <div className="mt-6 rounded-xl border border-line bg-zinc-50 px-5 py-4 text-sm leading-relaxed text-muted">{children}</div>
)
const Block = ({ code, label }: { code: string; label?: string }) => <div className="mt-4"><CodeBlock code={code} label={label} /></div>

function Cards({ items }: { items: { href: string; title: string; body: string }[] }) {
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {items.map((c) => (
        <a key={c.href} href={c.href} className="rounded-xl border border-line bg-white p-5 transition hover:border-ink/30">
          <p className="font-medium">{c.title}</p>
          <p className="mt-1 text-sm text-muted">{c.body}</p>
        </a>
      ))}
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="mt-5 overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 font-mono text-[11px] uppercase tracking-wider text-muted">
          <tr>{head.map((h) => <th key={h} className="px-4 py-2.5 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">{r.map((c, j) => <td key={j} className="px-4 py-3 text-muted">{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- API reference ----

const price = (e: Entry) => (e.units === 0 ? 'Free' : callPrice(e.units))

function example(e: Entry): string {
  const path = e.example.replace('{id}', 'al_…')
  if (e.method === 'POST' && e.path === '/trade/build') {
    return `curl -X POST ${API}/v1/trade/build \\\n  -H 'content-type: application/json' \\\n  -d '{"symbol":"NVDA","side":"buy","amount":"100","recipient":"0xYourWallet"}'`
  }
  if (e.method === 'POST' && e.path === '/alerts') {
    return `curl -X POST ${API}/v1/alerts \\\n  -H 'content-type: application/json' \\\n  -d '{"symbol":"NVDA","metric":"premium_pct","op":"above","value":1,"webhookUrl":"https://example.com/hook"}'`
  }
  return `curl${e.method === 'DELETE' ? ' -X DELETE' : ''} "${API}/v1${path}"`
}

const METHOD_TONE: Record<Entry['method'], string> = {
  GET: 'bg-emerald-50 text-up',
  POST: 'bg-sky-50 text-sky-700',
  DELETE: 'bg-rose-50 text-down',
}

export const endpointTitle = (e: Entry) => `${e.method} /v1${e.path}`

function Endpoint({ e }: { e: Entry }) {
  return (
    <section className="mt-12 border-t border-line pt-8">
      <h2 id={e.tool} className="flex scroll-mt-24 flex-wrap items-center gap-3 text-xl font-semibold">
        <span className={`rounded-md px-2 py-0.5 font-mono text-xs font-medium ${METHOD_TONE[e.method]}`}>{e.method}</span>
        <code className="font-mono text-[17px]">/v1{e.path}</code>
      </h2>
      <p className="mt-3 leading-relaxed text-muted">{e.summary}</p>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-mono text-xs text-muted">
        <span>price: {price(e)}</span>
        <span>MCP tool: {e.tool}</span>
      </div>
      {e.params && e.params.length > 0 && (
        <Table
          head={['Parameter', 'In', 'Description']}
          rows={e.params.map((p) => [<C>{p.name}</C>, `${p.in}${p.required ? ', required' : ''}`, p.description])}
        />
      )}
      <Block code={example(e)} />
    </section>
  )
}

const REFERENCE: { slug: string; title: string; lead: string; tools: string[] }[] = [
  { slug: 'api/assets', title: 'Assets and prices', lead: 'The token registry from Robinhood, live prices and candles.', tools: ['list_assets', 'get_asset', 'get_price', 'get_history'] },
  { slug: 'api/stats', title: 'Stats and premium', lead: 'How far each token trades from the real stock, and how deep its pools are.', tools: ['get_stats', 'list_stats'] },
  { slug: 'api/trading', title: 'Quotes and trades', lead: 'A real Uniswap quote, then unsigned transactions your wallet signs.', tools: ['get_quote', 'build_trade'] },
  { slug: 'api/portfolio', title: 'Portfolio', lead: 'Every stock token a wallet holds, valued live.', tools: ['get_portfolio'] },
  { slug: 'api/research', title: 'Research and corporate actions', lead: 'SEC fundamentals, filings, dividends and splits.', tools: ['get_research', 'corporate_actions'] },
  { slug: 'api/launches', title: 'Launches', lead: 'New tokens launched on Robinhood Chain, with ticker reuse counts.', tools: ['list_launches'] },
  { slug: 'api/alerts', title: 'Alerts', lead: 'Signed webhooks when a metric crosses your line.', tools: ['create_alert', 'get_alert', 'delete_alert'] },
]

function referencePage(slug: string, title: string, lead: string, endpoints: Entry[]): DocPage {
  return { slug, title, lead, endpoints, body: () => <>{endpoints.map((e) => <Endpoint key={e.method + e.path} e={e} />)}</> }
}

function referencePages(): DocPage[] {
  const placed = new Set(REFERENCE.flatMap((r) => r.tools))
  const pages = REFERENCE.map((r) =>
    referencePage(r.slug, r.title, r.lead, CATALOG.filter((e) => r.tools.includes(e.tool))),
  )
  const rest = CATALOG.filter((e) => !placed.has(e.tool))
  if (rest.length) pages.push(referencePage('api/more', 'More endpoints', 'Endpoints not yet sorted into a group above.', rest))
  return pages
}

// ---- Guides ----

const MCP_JSON = `{\n  "mcpServers": {\n    "equito": { "url": "${API}/mcp" }\n  }\n}`

export const GROUPS: DocGroup[] = [
  {
    label: 'Getting started',
    pages: [
      {
        slug: '',
        title: 'Introduction',
        lead: 'Stock token data your AI agent can call, pay for and act on.',
        body: () => (
          <>
            <P>
              Robinhood Chain carries tokens that track real shares: NVDA, AAPL, TSLA and about two hundred more. Equito reads them
              from Robinhood, from the Uniswap pools on chain and from SEC EDGAR, and answers in one shape for an agent or a developer.
              An agent can look a token up, judge its price against the real stock, research the company, and turn a trade idea into
              transactions that a person approves and signs.
            </P>
            <H2>What an agent can do</H2>
            <List items={[
              'Find every stock token and its contract, multiplier and status.',
              'Compare the on-chain price with the real stock and see how deep the pools are.',
              'Read SEC fundamentals, filings, dividends and splits.',
              'Get a real Uniswap quote and an unsigned approve + swap.',
              'Value a wallet, watch new launches and set webhook alerts.',
            ]} />
            <H2>How it fits together</H2>
            <Table
              head={['Step', 'What happens']}
              rows={[
                ['Ask', <>The agent calls a tool over <A href="/docs/mcp">MCP</A>, follows the <A href="/docs/skills">agent skill</A>, or sends plain HTTP.</>],
                ['Pay, if needed', <>{FREE_CALLS_PER_DAY} calls a day are free. After that the agent pays {callPrice()} per call in USDG with <A href="/docs/x402">x402</A>, from its own wallet.</>],
                ['Act', 'Trades come back unsigned. A person, or a wallet they control, checks and signs. Equito never holds keys.'],
              ]}
            />
            <H2>Next steps</H2>
            <Cards items={[
              { href: '/docs/quickstart', title: 'Quickstart', body: 'Your first call in a minute, no key.' },
              { href: '/docs/mcp', title: 'Connect your agent', body: 'Claude Code, Cursor, Hermes or any MCP client.' },
              { href: '/docs/skills', title: 'Install the skill', body: 'npx skills add, for agents that read skills.' },
              { href: '/docs/api/stats', title: 'API reference', body: 'Every endpoint, parameter and price.' },
            ]} />
          </>
        ),
      },
      {
        slug: 'quickstart',
        title: 'Quickstart',
        lead: 'No key and no signup. Copy a line and run it.',
        body: () => (
          <>
            <H2>1. Read a token</H2>
            <P>The first {FREE_CALLS_PER_DAY} calls of the day from your IP are free.</P>
            <Block code={`curl ${API}/v1/stats/NVDA`} />
            <P>You get Robinhood's price (<C>tokenPrice</C>), the Uniswap price (<C>dexPrice</C>), the gap between them (<C>premiumPct</C>) and every pool's depth. <A href="/docs/numbers">What the numbers mean</A>.</P>
            <H2>2. Get a quote</H2>
            <Block code={`curl "${API}/v1/quote?symbol=NVDA&side=buy&amount=100"`} />
            <P><C>side=buy</C> spends <C>amount</C> USDG; <C>side=sell</C> spends <C>amount</C> tokens.</P>
            <H2>3. Build the trade</H2>
            <Block code={`curl -X POST ${API}/v1/trade/build \\\n  -H 'content-type: application/json' \\\n  -d '{"symbol":"NVDA","side":"buy","amount":"100","recipient":"0xYourWallet"}'`} />
            <P>The answer holds two unsigned transactions, approve then swap. Check them, then sign and send them from your wallet.</P>
            <H2>4. Hand it to your agent</H2>
            <P>Same calls, as tools: <A href="/docs/mcp">add the MCP server</A> or <A href="/docs/skills">install the skill</A>.</P>
          </>
        ),
      },
      {
        slug: 'x402',
        title: 'Pricing and x402',
        lead: `${FREE_CALLS_PER_DAY} free calls a day, then ${callPrice()} a call that an agent pays by itself.`,
        body: () => (
          <>
            <H2>Prices</H2>
            <Table head={['', 'Price', 'Note']} rows={[
              ['Free', `${FREE_CALLS_PER_DAY} calls a day per IP`, 'No key, no wallet'],
              ['Per call', callPrice(), 'USDG on Robinhood Chain'],
              ['trade/build', callPrice(2), 'Unsigned approve + swap'],
              ['$EQUITO holders', 'Half', 'Pay from the holding wallet'],
            ]} />
            <H2>How an agent pays</H2>
            <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
              <li>The header <C>x-free-calls-left</C> counts down; only successful answers use a call.</li>
              <li>Past the free calls a call answers <b className="text-ink">402</b> with the terms in the body and, base64, in <C>PAYMENT-REQUIRED</C>: USDG (<span className="font-mono text-sm">{USDG.slice(0, 10)}…</span>) on chain 4663, scheme exact.</li>
              <li>The agent's x402 client signs those terms and sends the same request again with <C>PAYMENT-SIGNATURE</C>.</li>
              <li>It is charged only when the answer succeeds; the answer then carries <C>PAYMENT-RESPONSE</C> with the transaction.</li>
            </ol>
            <Note>Give an agent its own wallet with a small USDG balance and a budget, and it can pay for data without asking each time. Gas for the payment is paid by the facilitator, not by the agent.</Note>
            <H2>Paid-only paths</H2>
            <P>Every endpoint also lives under <C>/v1/paid/…</C> with no free calls. x402 directories list these paths: <A href={`${API}/.well-known/x402`}>/.well-known/x402</A>.</P>
          </>
        ),
      },
    ],
  },
  {
    label: 'For AI agents',
    pages: [
      {
        slug: 'agents',
        title: 'Agents overview',
        lead: 'Pick the way in that your agent already speaks.',
        body: () => (
          <>
            <Table head={['Your agent', 'Use', 'Setup']} rows={[
              ['Claude Code, Cursor', <A href="/docs/mcp">MCP server</A>, 'One command or one JSON block'],
              ['Hermes Agent', <A href="/docs/hermes">MCP + skill</A>, 'config.yaml and one install'],
              ['Any agent that reads skills', <A href="/docs/skills">Agent skill</A>, <C>npx skills add {SKILL_REPO}</C>],
              ['Your own code', <A href="/docs/sdk">TypeScript SDK</A>, 'From the repo; on npm soon'],
              ['Anything that speaks HTTP', <A href="/docs/discovery">llms.txt, OpenAPI</A>, 'Nothing'],
            ]} />
            <H2>The agent loop</H2>
            <List items={[
              <><b className="text-ink">Discover</b>: the agent finds the tools in llms.txt, openapi.json, the agent card or the MCP tool list.</>,
              <><b className="text-ink">Call</b>: one tool per endpoint, the same answers as HTTP.</>,
              <><b className="text-ink">Pay</b>: past the free calls, x402 from the agent's own wallet, {callPrice()} a call.</>,
              <><b className="text-ink">Act</b>: a trade comes back unsigned, for a person to check and sign.</>,
            ]} />
            <H2>What Equito never does</H2>
            <List items={['Hold keys or funds.', 'Sign or send a transaction.', 'Give investment advice. The data says what is, not what to buy.']} />
          </>
        ),
      },
      {
        slug: 'mcp',
        title: 'MCP server',
        lead: 'A remote MCP server with one tool per endpoint.',
        body: () => (
          <>
            <P>Server URL, streamable HTTP, no key: <C>{API}/mcp</C></P>
            <H2>Claude Code</H2>
            <Block code={`claude mcp add --transport http equito ${API}/mcp`} />
            <H2>Cursor</H2>
            <P>Add to <C>.cursor/mcp.json</C> in the project, or <C>~/.cursor/mcp.json</C> for every project:</P>
            <Block label="json" code={MCP_JSON} />
            <H2>Hermes Agent</H2>
            <P>See <A href="/docs/hermes">Hermes Agent</A>.</P>
            <H2>Any other client</H2>
            <P>Most clients take the same block:</P>
            <Block label="json" code={MCP_JSON} />
            <H2>Tools</H2>
            <Table head={['Tool', 'Endpoint', 'Price']} rows={CATALOG.map((e) => [<C>{e.tool}</C>, <span className="font-mono text-xs">{endpointTitle(e)}</span>, price(e)]).concat([[<C>get_pricing</C>, <span className="font-mono text-xs">GET /v1/pricing</span>, 'Free']])} />
            <H2>Paying over MCP</H2>
            <P>Past the free calls a tool answers with the x402 terms. Sign them and call the same tool again with <C>payment_signature</C>.</P>
          </>
        ),
      },
      {
        slug: 'skills',
        title: 'Agent skill',
        lead: 'A short instruction file your agent reads whenever stock tokens come up.',
        body: () => (
          <>
            <P>
              The skill tells an agent which Equito call answers which question, what each number means, what calls cost, and that
              trades come back unsigned for a person to sign. It lives in the repo at <A href={`${REPO}/blob/main/skills/equito/SKILL.md`}>skills/equito/SKILL.md</A> and
              follows the open Agent Skills format, so skills.sh, Claude Code, Cursor, Codex and Hermes all read it.
            </P>
            <H2>Install with skills.sh</H2>
            <Block code={`npx skills add ${SKILL_REPO}`} />
            <P>For every project instead of this one, and for chosen agents:</P>
            <Block code={`npx skills add ${SKILL_REPO} --skill equito -g -a claude-code -a cursor -a codex`} />
            <Table head={['Agent', 'Flag']} rows={[
              ['Claude Code', <C>-a claude-code</C>],
              ['Cursor', <C>-a cursor</C>],
              ['Codex', <C>-a codex</C>],
              ['Hermes Agent', <C>-a hermes-agent</C>],
            ]} />
            <Note>The skills.sh CLI needs Node 22.20 or newer. <C>-g</C> installs into your home folder; without it the skill goes into the current project.</Note>
            <H2>Read it first</H2>
            <P>The same file is served at <A href={`${SITE}/SKILL.md`}>{SITE}/SKILL.md</A>.</P>
          </>
        ),
      },
      {
        slug: 'hermes',
        title: 'Hermes Agent',
        lead: "Give Nous Research's Hermes Agent the Equito tools and the skill that explains them.",
        body: () => (
          <>
            <H2>1. Install Hermes</H2>
            <Block code="curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash" />
            <H2>2. Add the MCP server</H2>
            <P>In <C>~/.hermes/config.yaml</C>:</P>
            <Block label="yaml" code={`mcp_servers:\n  equito:\n    url: "${API}/mcp"`} />
            <H2>3. Add the skill</H2>
            <Block code={`npx skills add ${SKILL_REPO} --skill equito -g -a hermes-agent`} />
            <P>Or straight from the site:</P>
            <Block code={`hermes skills install ${SITE}/SKILL.md`} />
            <H2>4. Ask</H2>
            <P>Try: “What is NVDA's premium on Robinhood Chain right now, and how deep is its pool?” Hermes calls <C>get_stats</C> and explains the answer.</P>
          </>
        ),
      },
      {
        slug: 'discovery',
        title: 'llms.txt and OpenAPI',
        lead: 'Machine-readable descriptions for agents that read before they call.',
        body: () => (
          <>
            <Table head={['File', 'For']} rows={[
              [<A href={`${API}/llms.txt`}>/llms.txt</A>, 'Language models: every endpoint in plain text with its price.'],
              [<A href={`${API}/openapi.json`}>/openapi.json</A>, 'Code generators, x402scan and other directories.'],
              [<A href={`${API}/.well-known/agent.json`}>/.well-known/agent.json</A>, 'A2A agent card.'],
              [<A href={`${API}/.well-known/x402`}>/.well-known/x402</A>, 'x402 listing of the paid paths.'],
              [<A href={`${API}/status`}>/status</A>, 'Live health of the data sources.'],
            ]} />
          </>
        ),
      },
    ],
  },
  {
    label: 'Developers',
    pages: [
      {
        slug: 'sdk',
        title: 'TypeScript SDK',
        lead: 'No dependencies. Node 18+, browsers, Deno, Bun and Workers.',
        body: () => (
          <>
            <Note>
              The package is not on npm yet. Until it is, copy <A href={`${REPO}/tree/main/sdk`}>sdk/</A> from the repo, or call the
              API over HTTP or MCP: the answers are the same. Once published it installs with <C>npm install equito</C>.
            </Note>
            <Block label="ts" code={`import { Equito } from "equito";

const eq = new Equito({
  // optional: sign x402 payments with your own wallet once the free calls are used
  pay: async (requirements) => signWithMyWallet(requirements),
});

const nvda = await eq.stats("NVDA");
const quote = await eq.quote({ symbol: "NVDA", side: "buy", amount: 100 });
const trade = await eq.buildTrade({ symbol: "NVDA", side: "buy", amount: 100, recipient: "0xYourWallet" });
// trade.transactions: unsigned approve + swap. Check them, then sign and send from your wallet.`} />
            <H2>Methods</H2>
            <Table head={['Method', 'Endpoint']} rows={[
              ['assets() · asset(symbol)', '/v1/assets'],
              ['price(symbol)', '/v1/prices/{symbol}'],
              ['stats(symbol) · stats({ sort })', '/v1/stats'],
              ['history(symbol, { interval, days })', '/v1/history/{symbol}'],
              ['quote({ symbol, side, amount })', '/v1/quote'],
              ['buildTrade({ …, recipient, slippageBps })', '/v1/trade/build'],
              ['portfolio(address)', '/v1/portfolio/{address}'],
              ['corporateActions(symbol?)', '/v1/corporate-actions'],
              ['research(symbol, { filings })', '/v1/research/{symbol}'],
              ['markets({ hours, limit })', '/v1/markets'],
              ['createAlert(…) · alert(id) · deleteAlert(id)', '/v1/alerts'],
              ['pricing()', '/v1/pricing'],
            ].map(([m, e]) => [<C>{m}</C>, <span className="font-mono text-xs">{e}</span>])} />
            <P>Errors throw <C>EquitoError</C> with <C>status</C>, <C>code</C> and, on 402, the payment terms.</P>
          </>
        ),
      },
    ],
  },
  { label: 'API reference', pages: referencePages() },
  {
    label: 'Reference',
    pages: [
      {
        slug: 'numbers',
        title: 'What the numbers mean',
        lead: 'Where each figure comes from, and when it can mislead.',
        body: () => (
          <Table head={['Field', 'Meaning']} rows={[
            [<C>tokenPrice</C>, "Robinhood's own price for one token: its token bid/ask, already times the multiplier."],
            [<C>dexPrice</C>, "The deepest Uniswap v3 USDG pool. A pool counts only with in-range liquidity, both tokens inside and a price within 10x of Robinhood's."],
            [<C>premiumPct</C>, 'dexPrice against tokenPrice, in percent. Positive means the token costs more on chain. Outside US market hours the two can drift apart.'],
            [<C>liquidityUsd</C>, "Every USDG pool of the token, both sides, valued at Robinhood's price."],
            ['Lists, candles, launches', 'From a collector that reads the chain about once an hour; each answer says when.'],
          ]} />
        ),
      },
      {
        slug: 'token',
        title: '$EQUITO',
        lead: 'Hold it, and every paid call costs half.',
        body: () => (
          <>
            <P>Wallets holding 2,000,000 $EQUITO pay half for every paid call. The balance is read live on each call, and the payment must come from that wallet: send <C>x-holder: &lt;address&gt;</C> and pay from it.</P>
            {TOKEN_ADDRESS
              ? <P>Contract on Robinhood Chain: <C>{TOKEN_ADDRESS}</C>. This is the only Equito token.</P>
              : <Note>The token launches on Pons once the API is live. Until then no contract is official; anything claiming to be $EQUITO is not ours.</Note>}
          </>
        ),
      },
    ],
  },
]

export const PAGES: (DocPage & { group: string })[] = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label })))
export const docHref = (slug: string) => (slug ? `/docs/${slug}` : '/docs')
// The tab title, set by the page in the browser and written into each page's own HTML at build (vite.config.ts).
export const docTitle = (p: { title: string }) => `${p.title} · Equito docs`
