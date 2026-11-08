import { useRef } from 'react'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP, SplitText)

/**
 * A heading whose characters rise into place once. The full text is always in the DOM (SplitText adds an
 * aria-label), and users who prefer reduced motion simply see the finished heading.
 * Waits for web fonts so line breaks are measured correctly.
 */
export default function SplitHeading({ as: Tag = 'h1', children, className, ...props }) {
  const ref = useRef(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        let split
        let cancelled = false
        const ready = document.fonts?.ready ?? Promise.resolve()
        ready.then(() => {
          if (cancelled || !ref.current) return
          split = SplitText.create(ref.current, { type: 'chars,words', mask: 'chars', aria: 'auto' })
          gsap.from(split.chars, { yPercent: 110, opacity: 0, duration: 0.9, ease: 'expo.out', stagger: 0.03 })
        })
        return () => {
          cancelled = true
          split?.revert()
        }
      })
    },
    { scope: ref },
  )

  return (
    <Tag ref={ref} className={className} {...props}>
      {children}
    </Tag>
  )
}
