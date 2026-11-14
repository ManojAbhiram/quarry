import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { Gauge } from 'lucide-react'
import { api } from '../api'
import { Button, Skeleton } from './kit'

const usd = (n) => `$${Number(n || 0).toFixed(2)}`
const count = (n) => Number(n || 0).toLocaleString()
// Per-call prices are fractions of a cent, so show up to four decimals instead of rounding to $0.00.
const unitUsd = (n) => `$${parseFloat(Number(n || 0).toFixed(4))}`

function Meter({ label, used, total, format = count, dashboard }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const high = pct >= 90
  return (
    <div className="usage-meter">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums font-semibold text-ink">{format(used)} of {format(total)}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-valuetext={`${format(used)} of ${format(total)}`} className="usage-meter-track h-2 overflow-hidden rounded-full bg-head ring-1 ring-inset ring-line">
        <div
          className={clsx('usage-meter-fill h-full rounded-full', dashboard ? 'w-full origin-left transition-transform' : 'transition-[width] duration-700', high ? 'bg-bad' : dashboard ? 'bg-btn' : 'bg-gradient-to-r from-primary-500 to-accent-500')}
          style={dashboard ? { transform: `scaleX(${pct / 100})` } : { width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

/** This month's runs, search and model calls and estimated spend against the user's quota. */
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
          <Meter label="Runs" used={data.runs} total={data.quota.runs} dashboard={dashboard} />
          <Meter label="Estimated spend" used={data.cost_usd} total={data.quota.cost_usd} format={usd} dashboard={dashboard} />
          <p className="text-xs text-muted">
            {count(data.search_calls)} searches and {count(data.llm_calls)} model calls so far, {count(data.samples)} sample {data.samples === 1 ? 'run' : 'runs'}. Spend is an estimate at about {unitUsd(data.unit_prices.search_call_usd)} per search and {unitUsd(data.unit_prices.llm_call_usd)} per model call. Resets on the 1st.
          </p>
        </div>
      )}
    </section>
  )
}
