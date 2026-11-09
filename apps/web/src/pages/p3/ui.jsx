import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { X } from 'lucide-react'
import { ErrorState, Skeleton } from '../../components/kit'

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** A titled glass card. */
export function Section({ title, description, actions, children, className }) {
  return (
    <section className={clsx('card p-5 sm:p-6', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}

const TONES = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300',
}

export function Pill({ tone = 'info', children }) {
  return <span className={clsx('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ring-current/15', TONES[tone])}>{children}</span>
}

/** Skeleton while loading, an error with retry, or the children. */
export function Loadable({ state, onRetry, label, children }) {
  if (state === 'loading') {
    return (
      <div role="status" aria-label={`Loading ${label}`} className="space-y-3">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
    )
  }
  if (state === 'error') return <ErrorState title={`Could not load ${label}`} message="Check your connection and try again." onRetry={onRetry} className="py-8" />
  return children
}

/** An accessible modal: focus moves in and stays inside, Escape closes, focus returns to the opener. */
export function Dialog({ open, title, onClose, children, wide }) {
  const titleId = useId()
  const ref = useRef(null)
  const returnTo = useRef(null)
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    if (!open) return undefined
    returnTo.current = document.activeElement
    ref.current?.querySelector(FOCUSABLE)?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close.current()
      } else if (e.key === 'Tab' && ref.current) {
        const items = [...ref.current.querySelectorAll(FOCUSABLE)]
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      returnTo.current?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-fade-in bg-ink/40 backdrop-blur-sm" onClick={() => close.current()} aria-hidden="true" />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className={clsx('card relative max-h-[90vh] w-full overflow-y-auto p-6 shadow-lift', wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-bold tracking-tight text-ink">{title}</h2>
          <button type="button" aria-label="Close" onClick={() => close.current()} className="rounded-lg p-1 text-muted hover:bg-head hover:text-ink"><X aria-hidden="true" className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

/** Tabs with proper roles; the parent renders the active panel. */
export function Tabs({ tabs, value, onChange, label }) {
  return (
    <div role="tablist" aria-label={label} className="mb-6 inline-flex rounded-2xl border border-line bg-surface/70 p-1 shadow-sm backdrop-blur">
      {tabs.map(([id, text]) => (
        <button key={id} role="tab" type="button" id={`tab-${id}`} aria-selected={value === id} aria-controls={`panel-${id}`} onClick={() => onChange(id)}
          className={clsx('rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200', value === id ? 'bg-gradient-to-br from-btn to-btn-hover text-white shadow-md' : 'text-muted hover:text-ink')}>
          {text}
        </button>
      ))}
    </div>
  )
}

export const pct = (v) => `${((v || 0) * 100).toFixed(1).replace(/\.0$/, '')}%`
