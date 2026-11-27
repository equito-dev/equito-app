import { useState } from 'react'
import { Check, Copy } from 'lucide-react'

export function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#0c0c0e] text-[13px] text-zinc-200">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
        <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-500">{label ?? 'shell'}</span>
        <button
          onClick={() => navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}
          className="flex items-center gap-1.5 font-mono text-xs text-zinc-400 hover:text-white"
          aria-label="Copy code"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono leading-relaxed"><code>{code}</code></pre>
    </div>
  )
}
