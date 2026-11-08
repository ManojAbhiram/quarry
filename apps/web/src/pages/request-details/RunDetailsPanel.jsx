import { useEffect, useRef, useState } from 'react'
import { Check, Copy, X } from 'lucide-react'
import { UI } from '../../config/constants'
import { Button } from '../../components/kit'

const DIMENSION_LABELS = {
  firmographic: 'Firmographic',
  technographic: 'Technographic',
  team_structure: 'Team and decision makers',
  buying_signals: 'Buying signals',
  compliance: 'Compliance',
  deployment_pref: 'Deployment preferences',
}

/** The ICP the run used and the search queries it ran. */
export default function RunDetailsPanel({ icpDimensions, queries = [], onClose }) {
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])

  const entries = Object.entries(icpDimensions || {}).filter(([k]) => DIMENSION_LABELS[k])
  const shownQueries = showAll ? queries : queries.slice(0, 3)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(queries.join('\n'))
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), UI.COPY_FEEDBACK_MS)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section aria-label="Run details" className="mb-5 rounded-lg border border-line bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 className="text-base font-semibold text-ink">Run details</h2>
        <div className="flex items-center gap-1">
          {queries.length > 0 && (
            <Button variant="secondary" size="sm" onClick={copy}>
              {copied ? <Check aria-hidden="true" className="h-3.5 w-3.5" /> : <Copy aria-hidden="true" className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy queries'}
            </Button>
          )}
          <button type="button" onClick={onClose} aria-label="Close run details" className="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-head hover:text-ink sm:h-8 sm:w-8">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      </div>
      <div className="max-h-96 space-y-5 overflow-y-auto p-4">
        {entries.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink">Ideal customer profile</h3>
            <dl className="grid gap-3 md:grid-cols-2">
              {entries.map(([key, val]) => {
                const isObj = typeof val === 'object' && val !== null
                const text = isObj ? val.value : val
                const bullets = String(text || '').split('\n').map((l) => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
                return (
                  <div key={key} className="rounded-lg border border-line p-3">
                    <dt className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                      {DIMENSION_LABELS[key]}
                      {isObj && val.confidence && <span className="rounded-md border border-line px-1.5 py-0.5 normal-case tracking-normal">{val.confidence} confidence</span>}
                    </dt>
                    {isObj && val.warning && <dd className="mt-1.5 rounded-md bg-warn-soft px-2 py-1 text-xs text-warn break-words">{val.warning}</dd>}
                    <dd className="mt-1.5">
                      {bullets.length > 0 ? (
                        <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink">{bullets.map((b, i) => <li key={i} className="break-words">{b}</li>)}</ul>
                      ) : <span className="text-sm text-muted">No data</span>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </div>
        )}
        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">Search queries <span className="font-normal text-muted tabular-nums">({queries.length})</span></h3>
          {queries.length > 0 ? (
            <ol className="space-y-1.5 text-xs">
              {shownQueries.map((q, i) => (
                <li key={i} className="flex gap-2 rounded-md bg-head px-2.5 py-2 font-mono text-ink">
                  <span className="shrink-0 tabular-nums text-muted">{i + 1}.</span>
                  <span className="min-w-0 break-all">{q}</span>
                </li>
              ))}
            </ol>
          ) : <p className="text-sm text-muted">No search queries were recorded for this run.</p>}
          {queries.length > 3 && (
            <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 h-10 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">
              {showAll ? 'Show fewer' : `Show all ${queries.length}`}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
