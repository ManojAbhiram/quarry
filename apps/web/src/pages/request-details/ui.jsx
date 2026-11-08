import { useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import { Check, CircleHelp, Search, X, AlertTriangle, XCircle } from 'lucide-react'
import { emailStatus } from './emailStatus'

/**
 * A side panel over the page. Escape and a click on the backdrop close it; focus moves into the panel when it
 * opens, is kept inside while it is open, and returns to the element that opened it.
 * (Built here for the request details screen; a candidate for promotion into the kit.)
 */
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return undefined
    const opener = document.activeElement
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusable = panelRef.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus()
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('relative flex h-full w-full flex-col border-l border-line bg-surface', width)}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-ink break-words">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-muted break-words">{subtitle}</p>}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-head hover:text-ink">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && <div className="border-t border-line px-4 py-3 sm:px-6">{footer}</div>}
      </div>
    </div>
  )
}

const TONES = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  muted: 'bg-head text-muted',
}
const ICONS = { ok: Check, warn: AlertTriangle, bad: XCircle, muted: CircleHelp }

/** The email status as a word plus an icon. */
export function EmailStatusBadge({ lead, className }) {
  const status = emailStatus(lead)
  const Icon = ICONS[status.tone]
  return (
    <span title={status.hint} data-email-status={status.key} className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold', TONES[status.tone], className)}>
      <Icon aria-hidden="true" className="h-3 w-3" />
      {status.label}
    </span>
  )
}

/** A number with a small bar. `value` is 0 to 100. */
export function ScoreBar({ value, label = 'Match score', className }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={clsx('flex items-center gap-2', className)} role="img" aria-label={`${label}: ${Math.round(pct)} out of 100`}>
      <span className="w-7 text-right text-sm font-semibold tabular-nums text-ink">{Math.round(pct)}</span>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-head" aria-hidden="true">
        <div className="h-full rounded-full bg-primary-600 dark:bg-primary-400" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export function SearchInput({ value, onChange, placeholder, label, className }) {
  return (
    <div className={clsx('relative', className)}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={label || placeholder} className="input pl-9" />
    </div>
  )
}

export function SelectFilter({ label, value, onChange, options, className }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={clsx('h-10 rounded-md border border-line bg-surface px-3 text-sm text-ink focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20', className)}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o
        return <option key={opt.value} value={opt.value}>{opt.label}</option>
      })}
    </select>
  )
}

/** Empty value placeholder for table cells. */
export const Dash = () => <span className="text-muted" aria-label="not available">—</span>

export function Tag({ children, className }) {
  return <span className={clsx('inline-block max-w-full truncate rounded-md border border-line bg-head px-1.5 py-0.5 text-xs text-ink', className)}>{children}</span>
}

export function ExtLink({ href, children, className }) {
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={clsx('text-primary-700 hover:underline dark:text-primary-300', className)}>
      {children}
    </a>
  )
}
