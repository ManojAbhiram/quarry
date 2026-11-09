import { useEffect, useRef, useState } from 'react'
import { animate } from 'motion/react'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * A figure that counts up to its value. Screen readers get the final number at once (the moving digits are
 * hidden from them), and users who prefer reduced motion see the final number straight away.
 */
export default function AnimatedNumber({ value, className }) {
  const target = Number.isFinite(Number(value)) ? Number(value) : 0
  const [shown, setShown] = useState(() => (reduced() ? target : 0))
  const from = useRef(shown)

  useEffect(() => {
    if (reduced()) {
      setShown(target)
      from.current = target
      return undefined
    }
    const controls = animate(from.current, target, {
      duration: 0.9,
      ease: 'easeOut',
      onUpdate: (v) => {
        from.current = v
        setShown(Math.round(v))
      },
      onComplete: () => setShown(target),
    })
    return () => controls.stop()
  }, [target])

  return (
    <>
      <span aria-hidden="true" className={className}>
        {shown.toLocaleString()}
      </span>
      <span className="sr-only">{target.toLocaleString()}</span>
    </>
  )
}
