import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'

const STEPS = [
  { n: 1, label: 'Product input' },
  { n: 2, label: 'ICP definition' },
]

/** The wizard's step list. Shown from the lg breakpoint up; on phones the page shows "Step n of 2" instead. */
export default function WorkflowSidebar({ isCollapsed, onToggle, step }) {
  return (
    <aside aria-label="Request steps" className={clsx('relative hidden h-full shrink-0 border-r border-line bg-surface/80 backdrop-blur-xl transition-[width] duration-200 lg:block', isCollapsed ? 'w-14' : 'w-56')}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={isCollapsed ? 'Expand steps' : 'Collapse steps'}
        aria-expanded={!isCollapsed}
        className="absolute -right-3 top-6 z-10 flex h-6 w-6 items-center justify-center rounded-md border border-line bg-surface text-muted transition-colors hover:text-ink"
      >
        {isCollapsed ? <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronLeft aria-hidden="true" className="h-3.5 w-3.5" />}
      </button>

      <div className="overflow-hidden px-3 py-6">
        {!isCollapsed && <p className="mb-3 px-2 text-xs font-semibold uppercase tracking-wide text-muted">Steps</p>}
        <ol className="space-y-6">
          {STEPS.map(({ n, label }) => {
            const done = step > n
            const current = step === n
            return (
              <li key={n} aria-current={current ? 'step' : undefined} className={clsx('relative flex items-center gap-2.5 rounded-xl px-2 py-2 transition-colors', current && 'bg-primary-50 shadow-soft ring-1 ring-primary-200/70 dark:bg-primary-950/60 dark:ring-primary-900/60')}>
                {n < STEPS.length && (
                  <span aria-hidden="true" className="absolute left-[19px] top-full h-6 w-0.5 overflow-hidden rounded-full bg-line">
                    <span className={clsx('block w-full bg-gradient-to-b from-primary-500 to-accent-500 transition-[height] duration-500', done ? 'h-full' : 'h-0')} />
                  </span>
                )}
                <span
                  aria-hidden="true"
                  className={clsx(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
                    done || current ? 'bg-gradient-to-br from-btn to-btn-hover text-white shadow-lg shadow-primary-600/30 ring-2 ring-primary-300/40' : 'border border-line bg-surface text-muted',
                  )}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={3} /> : n}
                </span>
                {!isCollapsed ? (
                  <span className="min-w-0">
                    <span className={clsx('block truncate text-sm font-semibold', current ? 'text-primary-800 dark:text-primary-300' : 'text-muted')}>{label}</span>
                    <span className="block text-xs text-muted">{done ? 'Done' : current ? 'In progress' : 'Next'}</span>
                  </span>
                ) : (
                  <span className="sr-only">
                    {label}, {done ? 'done' : current ? 'in progress' : 'next'}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </div>
    </aside>
  )
}
