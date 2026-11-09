import clsx from 'clsx'
import { GlowingEffect } from '../../components/ui/glowing-effect'
import AnimatedNumber from './AnimatedNumber'

/**
 * One headline figure in the bento grid: a pressable glass tile with a gradient icon, a glow that follows the
 * pointer and a count-up number. `data-reveal` sits on the wrapper (GSAP moves it); the lift is on the inner button.
 */
export default function StatTile({ id, label, value, hint, icon: Icon, gradient, onClick, className }) {
  return (
    <div data-reveal className={clsx('relative', className)}>
      <button
        id={id}
        type="button"
        onClick={onClick}
        className="group card card-hover relative flex h-full min-h-[8.5rem] w-full flex-col justify-between p-5 text-left"
      >
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">{label}</p>
          <span className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-md ring-1 ring-white/30 transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-3', gradient)}>
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
        </div>
        <div className="relative z-10 mt-4">
          <AnimatedNumber value={value} className="block text-4xl font-black tracking-tight text-ink" />
          {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
        </div>
        <div aria-hidden="true" className={clsx('pointer-events-none absolute -bottom-6 -right-6 h-24 w-24 rounded-full bg-gradient-to-br opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-25', gradient)} />
      </button>
    </div>
  )
}
