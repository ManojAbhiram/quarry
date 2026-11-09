import { memo, useEffect, useId, useRef } from 'react'
import clsx from 'clsx'
import { motion, MotionConfig, useReducedMotion } from 'motion/react'
import { Check, CircleHelp, Info, Search, X, AlertTriangle, XCircle } from 'lucide-react'
import { emailStatus, formatChecked, statusTitle } from './emailStatus'

/**
 * A side panel over the page. Escape and a click on the backdrop close it; focus moves into the panel when it
 * opens, is kept inside while it is open, and returns to the element that opened it.
 * (Built here for the request details screen; a candidate for promotion into the kit.)
 */
export function Drawer({ open, onClose, title, subtitle, icon, children, footer, width = 'max-w-2xl' }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const titleId = useId()
  const reduce = useReducedMotion()

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
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
        initial={reduce ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25 }}
      />
      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={reduce ? false : { x: '100%' }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        className={clsx('relative flex h-full w-full flex-col border-l border-white/60 bg-surface/95 shadow-lift backdrop-blur-2xl dark:border-line', width)}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary-500/10 to-transparent" />
        <div className="relative flex items-start justify-between gap-3 border-b border-line px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            {icon}
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-black tracking-tight text-ink break-words">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-muted break-words">{subtitle}</p>}
            </div>
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-head hover:text-ink">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="relative flex-1 overflow-y-auto px-4 py-5 sm:px-6">{children}</div>
        {footer && <div className="relative border-t border-line bg-surface/80 px-4 py-3 backdrop-blur-xl sm:px-6">{footer}</div>}
      </motion.div>
    </div>
  )
}

const TONES = {
  ok: 'bg-ok-soft text-ok',
  info: 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  muted: 'bg-head text-muted',
}
const ICONS = { ok: Check, info: Info, warn: AlertTriangle, bad: XCircle, muted: CircleHelp }

/**
 * The email status as a word plus an icon, with the reason and check date in its tooltip. `showDate` also prints
 * "Checked 3 Jan 2026" next to it. Pass `lead` (a lead or a contact: anything with an email and status fields).
 */
export function EmailStatusBadge({ lead, className, showDate = false }) {
  const status = emailStatus(lead)
  const Icon = ICONS[status.tone]
  const when = formatChecked(status.checkedAt)
  return (
    <span className={clsx('inline-flex flex-wrap items-center gap-x-2 gap-y-0.5', className)}>
      <span title={statusTitle(status)} data-email-status={status.key} className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15', TONES[status.tone])}>
        <Icon aria-hidden="true" className="h-3 w-3" />
        {status.label}
      </span>
      {showDate && when && <span className="text-xs text-muted">Checked {when}</span>}
    </span>
  )
}

/** Marks a lead whose AI enrichment failed, so its blank fields are explained rather than looking like missing data. */
export function EnrichmentFailedBadge({ lead, className }) {
  if (!lead?.enrichment_failed) return null
  return (
    <span
      title={lead.enrichment_failure_reason || 'The AI step failed for this company.'}
      data-enrichment-failed=""
      className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15', TONES.warn, className)}
    >
      <AlertTriangle aria-hidden="true" className="h-3 w-3" />
      Enrichment failed
    </span>
  )
}

/** A number with a gradient bar that grows in once when it appears. `value` is 0 to 100. */
export const ScoreBar = memo(function ScoreBar({ value, label = 'Match score', className }) {
  const reduce = useReducedMotion()
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={clsx('flex items-center gap-2', className)} role="img" aria-label={`${label}: ${Math.round(pct)} out of 100`}>
      <span className="w-7 text-right text-sm font-bold tabular-nums text-ink">{Math.round(pct)}</span>
      <div className="h-2 w-16 overflow-hidden rounded-full bg-head ring-1 ring-inset ring-line" aria-hidden="true">
        <motion.div
          className="h-full origin-left rounded-full bg-gradient-to-r from-primary-500 to-accent-500 shadow-[0_0_10px_rgb(var(--p-500)/0.5)]"
          style={{ width: `${pct}%` }}
          initial={reduce ? false : { scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
        />
      </div>
    </div>
  )
})

/**
 * A row of tabs with a gradient underline that glides to the selected tab. `layoutId` must be unique per tab bar.
 * Extra per-tab props (id, aria-controls) go in `tab.props`.
 */
export function TabBar({ label, tabs, active, onSelect, layoutId, size = 'md' }) {
  return (
    <MotionConfig reducedMotion="user">
      <div role="tablist" aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((tab) => {
          const selected = active === tab.id
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              aria-selected={selected}
              onClick={() => onSelect(tab.id)}
              className={clsx('relative flex shrink-0 items-center gap-2 text-sm transition-colors', size === 'md' ? 'h-11 px-4 font-semibold' : 'h-10 px-3 font-medium', selected ? 'text-ink' : 'text-muted hover:text-ink')}
              {...tab.props}
            >
              {tab.label}
              {tab.count != null && <span className={clsx('rounded-full px-2 text-xs font-semibold tabular-nums ring-1 ring-inset', selected ? 'bg-primary-50 text-primary-800 ring-primary-200 dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-900' : 'bg-head text-muted ring-line')}>{tab.count}</span>}
              {selected && <motion.span layoutId={layoutId} aria-hidden="true" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-primary-500 to-accent-500 shadow-[0_0_8px_rgb(var(--p-500)/0.6)]" transition={{ type: 'spring', stiffness: 400, damping: 34 }} />}
            </button>
          )
        })}
      </div>
    </MotionConfig>
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
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={clsx('h-10 rounded-xl border border-line bg-surface/80 px-3 text-sm text-ink transition-all focus:border-primary-400 focus:outline-none focus:ring-4 focus:ring-primary-500/10', className)}>
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
  return <span className={clsx('inline-block max-w-full truncate rounded-full border border-line bg-head px-2.5 py-0.5 text-xs font-medium text-ink', className)}>{children}</span>
}

export function ExtLink({ href, children, className }) {
  if (!href) return null
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className={clsx('text-primary-700 hover:underline dark:text-primary-300', className)}>
      {children}
    </a>
  )
}
