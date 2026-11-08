import { useCallback, useRef } from 'react'
import gsap from 'gsap'
import { Flip } from 'gsap/Flip'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP, Flip)

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * Smoothly glide list items to their new place when the list changes (sort, filter, paging, delete).
 *
 *   const capture = useFlip(listRef, [sortedIds.join()])
 *   const onSort = (value) => { capture(); setSort(value) }     // capture BEFORE the state change
 *
 * Give every moving item `data-flip-id={stableId}` (or pass a different `selector`). Nothing animates unless
 * `capture()` ran first, so first renders and background data refreshes stay still. Users who prefer reduced
 * motion never get an animation. Returns `capture`.
 */
export function useFlip(scopeRef, dependencies, { selector = '[data-flip-id]', duration = 0.45, ease = 'power2.inOut' } = {}) {
  const stateRef = useRef(null)

  const capture = useCallback(() => {
    if (!scopeRef.current || prefersReducedMotion()) {
      stateRef.current = null
      return
    }
    stateRef.current = Flip.getState(scopeRef.current.querySelectorAll(selector))
  }, [scopeRef, selector])

  useGSAP(
    () => {
      const state = stateRef.current
      stateRef.current = null // one animation per capture
      if (!state || prefersReducedMotion()) return
      Flip.from(state, {
        duration,
        ease,
        // Items that appear (a filter widening, "show more") fade in instead of popping.
        onEnter: (elements) => gsap.fromTo(elements, { autoAlpha: 0, y: 10 }, { autoAlpha: 1, y: 0, duration: duration * 0.9, ease: 'power2.out', clearProps: 'transform,opacity,visibility' }),
      })
    },
    { scope: scopeRef, dependencies },
  )

  return capture
}
