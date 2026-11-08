import clsx from 'clsx'
import { AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react'

const TONES = {
  warn: 'bg-warn-soft text-warn',
  ok: 'bg-ok-soft text-ok',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300',
}

const STATUSES = {
  pending: { label: 'Pending', tone: 'warn', Icon: Clock },
  running: { label: 'Running', tone: 'info', Icon: Loader2, spin: true },
  completed: { label: 'Completed', tone: 'ok', Icon: CheckCircle2 },
  failed: { label: 'Failed', tone: 'bad', Icon: XCircle },
  partial: { label: 'Partial', tone: 'warn', Icon: AlertTriangle },
}

/** A request status as text plus an icon (never colour alone). Unknown statuses are shown as given. */
export default function StatusBadge({ status, className }) {
  const known = STATUSES[String(status || '').toLowerCase()]
  const { label, tone, Icon, spin } = known || { label: String(status || 'Unknown'), tone: 'info', Icon: Clock }
  return (
    <span data-status={known ? String(status).toLowerCase() : 'unknown'} className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-current/15', TONES[tone], className)}>
      <Icon aria-hidden="true" className={clsx('h-3.5 w-3.5', spin && 'animate-spin')} />
      {label}
    </span>
  )
}
