import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { Gauge } from 'lucide-react'
import { api } from '../api'
import { Button, Skeleton } from './kit'

const usd = (n) => `$${Number(n || 0).toFixed(2)}`
const count = (n) => Number(n || 0).toLocaleString()
// Per-call prices are fractions of a cent, so show up to four decimals instead of rounding to $0.00.
const unitUsd = (n) => `$${parseFloat(Number(n || 0).toFixed(4))}`

/** This month's research runs, provider calls and estimated spend. */
export default function UsageCard({ className, dashboard = false }) {
  const [state, setState] = useState({ status: 'loading', data: null })

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    Promise.resolve()
      .then(() => api.getUsageSummary())
      .then((data) => setState({ status: 'ready', data }))
      .catch(() => setState({ status: 'error', data: null }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const { status, data } = state
  return (
    <section aria-labelledby="usage-title" className={clsx('usage-card card p-5', className)}>
      <div className="mb-4 flex items-center gap-2">
        {!dashboard && <Gauge aria-hidden="true" className="h-5 w-5 text-primary-600 dark:text-primary-400" />}
        <h2 id="usage-title" className="text-base font-black tracking-tight text-ink">Usage this month</h2>
      </div>
      {status === 'loading' && <div role="status" aria-label="Loading usage"><Skeleton className="h-16 w-full" /></div>}
      {status === 'error' && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-warn">Could not load your usage</span>
          <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
        </div>
      )}
      {status === 'ready' && data && (
        <div className="usage-content space-y-4">
          <dl className="grid grid-cols-2 gap-4">
            <div>
              <dt className="text-sm text-muted">Runs</dt>
              <dd className="text-lg font-semibold tabular-nums text-ink">{count(data.runs)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted">Estimated provider cost</dt>
              <dd className="text-lg font-semibold tabular-nums text-ink">{usd(data.cost_usd)}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted">
            {count(data.search_calls)} searches and {count(data.llm_calls)} model calls so far, {count(data.samples)} sample {data.samples === 1 ? 'run' : 'runs'}. Spend is an estimate at about {unitUsd(data.unit_prices.search_call_usd)} per search and {unitUsd(data.unit_prices.llm_call_usd)} per model call.
          </p>
        </div>
      )}
    </section>
  )
}
