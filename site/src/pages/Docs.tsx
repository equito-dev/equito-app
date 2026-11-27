// /docs: developer docs built from the API's own endpoint catalog (api/src/discovery.ts), the same list that makes
// openapi.json, llms.txt, the x402 listing and the MCP tools. Nothing here is typed out twice.
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { CATALOG, type Entry } from '../../../api/src/discovery.ts'
import { FREE_CALLS_PER_DAY, USDG, callPrice } from '../../../api/src/x402.ts'

import { API_URL as API } from '../../../api/src/hosts.ts'

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#0c0c0e] text-[13px] text-zinc-200">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label ?? 'shell'}</span>
        <button
          onClick={() => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
          className="flex items-center gap-1.5 font-mono text-xs text-zinc-400 hover:text-white"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono leading-relaxed"><code>{code}</code></pre>
    </div>
  )
}

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

const SECTIONS = [
  ['start', 'Quick start'],
  ['paying', 'Paying with x402'],
  ['sdk', 'TypeScript SDK'],
  ['mcp', 'MCP for agents'],
  ['endpoints', 'Endpoints'],
  ['numbers', 'What the numbers mean'],
] as const

export function DocsPage() {
  return (
    <main className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-8 lg:grid-cols-[200px_1fr]">
      <aside className="hidden lg:block">
        <nav className="sticky top-28 space-y-2 text-sm">
          {SECTIONS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="block text-muted hover:text-ink">{label}</a>
          ))}
        </nav>
      </aside>

      <div className="min-w-0 max-w-3xl">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted">// Docs</p>
        <h1 className="mt-4 text-5xl font-semibold leading-[1.02] tracking-[-0.04em]">Build on stock tokens.</h1>
        <p className="mt-5 text-lg text-muted">
          One HTTP API for every stock token on Robinhood Chain. No key, no signup: {FREE_CALLS_PER_DAY} calls a day per IP are free, then
          {callPrice()} a call in USDG over x402. Machine-readable: <a className="underline" href={`${API}/openapi.json`}>openapi.json</a> and{' '}
          <a className="underline" href={`${API}/llms.txt`}>llms.txt</a>.
        </p>

        <section id="start" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight">Quick start</h2>
          <p className="mt-3 text-muted">Ask for a token's numbers. The answer is JSON; errors are <code className="font-mono text-sm">{'{ error: { code, message } }'}</code>.</p>
          <div className="mt-5 space-y-3">
            <CodeBlock code={`curl ${API}/v1/stats/NVDA`} />
            <CodeBlock code={`curl "${API}/v1/quote?symbol=NVDA&side=buy&amount=100"`} />
          </div>
        </section>

        <section id="paying" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight">Paying with x402</h2>
          <ol className="mt-4 list-decimal space-y-2 pl-5 text-muted">
            <li>The first {FREE_CALLS_PER_DAY} calls of the UTC day from your IP are free. The header <code className="font-mono text-sm">x-free-calls-left</code> counts down; only successful answers use a call.</li>
            <li>After that a call answers <b className="text-ink">402</b> with the terms in the body and, base64, in the <code className="font-mono text-sm">PAYMENT-REQUIRED</code> header: USDG (<span className="font-mono text-sm">{USDG.slice(0, 10)}…</span>) on Robinhood Chain, scheme exact, {callPrice()} per call ({callPrice(2)} for trade/build).</li>
            <li>Sign those terms with your wallet (any x402 client does it) and send the same request again with the payload in <code className="font-mono text-sm">PAYMENT-SIGNATURE</code>.</li>
            <li>You are charged only when the answer succeeds. It then carries <code className="font-mono text-sm">PAYMENT-RESPONSE</code> with the transaction.</li>
          </ol>
          <p className="mt-4 text-sm text-muted">Holders of $EQUITO pay half once the token is live: send <code className="font-mono">x-holder: &lt;address&gt;</code> and pay from that address.</p>
        </section>

        <section id="sdk" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight">TypeScript SDK</h2>
          <p className="mt-3 text-muted">No dependencies. Node 18+, browsers, Deno, Bun and Workers. Give it a <code className="font-mono text-sm">pay</code> function and it pays and retries for you.</p>
          <div className="mt-5 space-y-3">
            <CodeBlock code="npm install equito" />
            <CodeBlock
              label="ts"
              code={`import { Equito } from "equito";

const eq = new Equito({
  // optional: sign x402 payments with your own wallet once the free calls are used
  pay: async (requirements) => signWithMyWallet(requirements),
});

const nvda = await eq.stats("NVDA");
const trade = await eq.buildTrade({ symbol: "NVDA", side: "buy", amount: "100", recipient: "0xYourWallet" });
// trade.transactions: unsigned approve + swap. Check them, then sign and send from your wallet.`}
            />
          </div>
        </section>

        <section id="mcp" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight">MCP for agents</h2>
          <p className="mt-3 text-muted">A remote MCP server with one tool per endpoint. Add it to any MCP client (desktop assistants, IDEs, agent frameworks):</p>
          <div className="mt-5">
            <CodeBlock label="json" code={`{\n  "mcpServers": {\n    "equito": { "url": "${API}/mcp" }\n  }\n}`} />
          </div>
          <p className="mt-3 text-sm text-muted">Tools: {CATALOG.map((e) => e.tool).join(', ')}, get_pricing. Past the free calls a tool answers with the payment terms; call it again with <code className="font-mono">payment_signature</code>.</p>
        </section>

        <section id="endpoints" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight">Endpoints</h2>
          <div className="mt-6 space-y-8">
            {CATALOG.map((e) => (
              <div key={e.method + e.path} id={e.tool} className="scroll-mt-28 border-t border-line pt-6">
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-md px-2 py-0.5 font-mono text-xs font-medium ${e.method === 'GET' ? 'bg-emerald-50 text-up' : e.method === 'POST' ? 'bg-sky-50 text-sky-700' : 'bg-rose-50 text-down'}`}>{e.method}</span>
                  <code className="font-mono text-[15px] font-medium">/v1{e.path}</code>
                  <span className="ml-auto font-mono text-xs text-muted">{price(e)}</span>
                </div>
                <p className="mt-3 text-muted">{e.summary}</p>
                {e.params && e.params.length > 0 && (
                  <ul className="mt-3 space-y-1 text-sm">
                    {e.params.map((p) => (
                      <li key={p.name}>
                        <code className="font-mono">{p.name}</code> <span className="text-muted">({p.in}{p.required ? ', required' : ''}): {p.description}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4"><CodeBlock code={example(e)} /></div>
              </div>
            ))}
          </div>
        </section>

        <section id="numbers" className="mt-16 scroll-mt-28">
          <h2 className="text-2xl font-semibold tracking-tight">What the numbers mean</h2>
          <ul className="mt-4 space-y-3 text-muted">
            <li><b className="text-ink">tokenPrice</b>: Robinhood's own price for one token (its token bid/ask, already times the multiplier).</li>
            <li><b className="text-ink">dexPrice</b>: the deepest Uniswap v3 USDG pool. A pool counts only with in-range liquidity, both tokens inside and a price within 10x of Robinhood's.</li>
            <li><b className="text-ink">premiumPct</b>: dexPrice against tokenPrice, in percent. Positive means the token costs more on chain. Outside US market hours the two can drift apart.</li>
            <li><b className="text-ink">liquidityUsd</b>: every USDG pool of the token, both sides, valued at Robinhood's price.</li>
            <li><b className="text-ink">stats list, history, markets</b>: from a collector that reads the chain about once an hour; each answer says when.</li>
          </ul>
          <p className="mt-6 text-sm text-muted">Equito never holds keys and never signs or sends a transaction. Data, not investment advice.</p>
        </section>
      </div>
    </main>
  )
}
