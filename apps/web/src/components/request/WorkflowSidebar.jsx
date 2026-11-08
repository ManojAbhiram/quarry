import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'

const STEPS = [
  { n: 1, label: 'Product input' },
  { n: 2, label: 'ICP definition' },
]

/** The wizard's step list. Shown from the lg breakpoint up; on phones the page shows "Step n of 2" instead. */
export default function WorkflowSidebar({ isCollapsed, onToggle, step }) {
  return (
    <aside aria-label="Request steps" className={clsx('relative hidden h-full shrink-0 border-r border-line bg-surface transition-[width] duration-200 lg:block', isCollapsed ? 'w-14' : 'w-56')}>
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
        <ol className="space-y-1">
          {STEPS.map(({ n, label }) => {
            const done = step > n
            const current = step === n
            return (
              <li key={n} aria-current={current ? 'step' : undefined} className={clsx('flex items-center gap-2.5 rounded-md px-2 py-2', current && 'bg-primary-50 dark:bg-primary-950/60')}>
                <span
                  aria-hidden="true"
                  className={clsx(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
                    done || current ? 'bg-primary-600 text-white dark:bg-primary-400 dark:text-app' : 'border border-line text-muted',
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
