import clsx from 'clsx'

/** A frosted settings panel with a gradient icon tile. `danger` tints it for destructive actions. */
export default function Section({ id, title, description, icon: Icon, danger = false, plain = false, children }) {
  return (
    <section id={id} data-reveal aria-labelledby={`${id}-title`}>
      <div className={clsx('p-5 sm:p-7', plain ? 'rounded-xl border border-line bg-surface' : 'card', danger && 'border-bad/30 ring-1 ring-bad/15')}>
        <div className="mb-6 flex items-start gap-4">
          <span
            className={clsx(
              'flex shrink-0 items-center justify-center',
              plain ? 'h-10 w-10 rounded-lg border border-line bg-head text-ink' : [
                'h-12 w-12 rounded-2xl text-white shadow-lg ring-1 ring-white/30',
                danger ? 'bg-gradient-to-br from-rose-500 to-red-600 shadow-rose-600/25' : 'bg-gradient-to-br from-primary-500 to-accent-600 shadow-primary-600/25',
              ],
            )}
          >
            <Icon aria-hidden="true" className={plain ? 'h-5 w-5' : 'h-6 w-6'} />
          </span>
          <div className="min-w-0">
            <h2 id={`${id}-title`} className={clsx('text-lg tracking-tight text-ink', plain ? 'font-semibold' : 'font-black')}>
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
