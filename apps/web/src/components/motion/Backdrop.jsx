import { cn } from '@/lib/utils'
import { Spotlight } from '../ui/spotlight'
import { BackgroundBeams } from '../ui/background-beams'

/**
 * Decorative spotlight and beams for hero surfaces (sign-in, empty states). Purely visual: hidden from assistive
 * tech, never intercepts clicks, and removed entirely for users who prefer reduced motion. The parent needs
 * `relative overflow-hidden` so the wide SVGs cannot cause sideways scrolling on phones.
 */
export default function Backdrop({ className }) {
  return (
    <div aria-hidden="true" data-testid="backdrop" className={cn('pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden', className)}>
      <Spotlight className="-top-40 left-0 text-primary-400/80 md:-top-20 md:left-40" fill="currentColor" />
      <BackgroundBeams className="opacity-60" />
    </div>
  )
}
