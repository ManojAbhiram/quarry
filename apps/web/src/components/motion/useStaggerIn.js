import gsap from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

/**
 * Fade/slide the `[data-reveal]` elements inside `scopeRef` in, one after another, on mount.
 * - Skipped entirely for users who prefer reduced motion (they just see the final state).
 * - GSAP moves the `[data-reveal]` wrapper only; put hover transforms on a child so they don't fight.
 * - `clearProps` hands the element back to CSS when the tween ends.
 */
export function useStaggerIn(scopeRef, { selector = '[data-reveal]', dependencies = [] } = {}) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from(selector, {
          y: 22,
          autoAlpha: 0,
          duration: 0.7,
          ease: 'power3.out',
          stagger: 0.08,
          clearProps: 'transform,opacity,visibility',
        })
      })
    },
    { scope: scopeRef, dependencies },
  )
}
