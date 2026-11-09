import clsx from 'clsx'

/** A frosted settings panel with a gradient icon tile. `danger` tints it for destructive actions. */
export default function Section({ id, title, description, icon: Icon, danger = false, children }) {
  return (
    <section id={id} data-reveal aria-labelledby={`${id}-title`}>
      <div className={clsx('card p-5 sm:p-7', danger && 'border-bad/30 ring-1 ring-bad/15')}>
        <div className="mb-6 flex items-start gap-4">
          <span
            className={clsx(
              'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-lg ring-1 ring-white/30',
              danger ? 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-600/25' : 'bg-gradient-to-br from-primary-500 to-accent-600 shadow-primary-600/25',
            )}
          >
            <Icon aria-hidden="true" className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className="text-lg font-black tracking-tight text-ink">
              {title}
            </h2>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
        </div>
        {children}
      </div>
    </section>
  )
}
