import { useCallback, useEffect, useState } from 'react'
import clsx from 'clsx'
import { BadgeDollarSign, Briefcase, Cpu, Radio } from 'lucide-react'
import { watchApi } from '../../api.p3'
import { Button, Skeleton } from '../../components/kit'
import { signalDate, signalLabel } from './signals'

const ICONS = { hiring: Briefcase, funding: BadgeDollarSign, tech: Cpu }
const TONE = {
  hiring: 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300',
  funding: 'bg-ok-soft text-ok',
  tech: 'bg-warn-soft text-warn',
}

/** One detected signal: kind, when it was seen, and the summary as a tooltip. */
export function SignalChip({ signal }) {
  const Icon = ICONS[signal.kind] || Radio
  const date = signalDate(signal.detected_at)
  return (
    <span
      title={signal.summary || undefined}
      className={clsx('inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15', TONE[signal.kind] || TONE.hiring)}
    >
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      <span className="truncate">{signalLabel(signal.kind)}</span>
      {date && <span className="font-normal opacity-80">{date}</span>}
    </span>
  )
}

/** Compact chips for a table row. `signals` is already filtered to the company. Renders nothing when empty. */
export function RowSignals({ signals, state, max = 3 }) {
  if (state === 'loading') return <Skeleton className="mt-1 h-5 w-24" aria-hidden="true" />
  if (!signals || signals.length === 0) return null
  const shown = signals.slice(0, max)
  const more = signals.length - shown.length
  return (
    <ul aria-label="Detected signals" className="mt-1 flex flex-wrap items-center gap-1">
      {shown.map((s, i) => <li key={s._id || i}><SignalChip signal={s} /></li>)}
      {more > 0 && <li className="text-xs text-muted">+{more} more</li>}
    </ul>
  )
}

/** Drawer section body: loads the company's signals and shows chips with dates, with loading, empty and error states. */
export function LeadSignals({ leadId }) {
  const [state, setState] = useState(leadId ? 'loading' : 'empty')
  const [items, setItems] = useState([])

  const load = useCallback(async () => {
    if (!leadId) return
    setState('loading')
    try {
      const res = await watchApi.leadSignals(String(leadId))
      const list = Array.isArray(res?.signals) ? res.signals : []
      setItems(list)
      setState(list.length ? 'ready' : 'empty')
    } catch {
      setState('error')
    }
  }, [leadId])
  useEffect(() => { load() }, [load])

  if (state === 'loading') return <div role="status" aria-label="Loading signals" className="flex gap-2"><Skeleton className="h-6 w-24" /><Skeleton className="h-6 w-28" /></div>
  if (state === 'error') {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>Could not load signals.</span>
        <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
      </div>
    )
  }
  if (state === 'empty') return <p className="text-sm text-muted">No hiring, funding or tech changes detected in the last 60 days. Signals appear after a watch scan.</p>
  return (
    <ul aria-label="Detected signals" className="flex flex-wrap gap-1.5">
      {items.map((s, i) => (
        <li key={s._id || i} className="max-w-full"><SignalChip signal={s} /></li>
      ))}
    </ul>
  )
}
