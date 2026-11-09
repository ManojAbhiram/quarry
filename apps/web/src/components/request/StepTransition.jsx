import { motion, useReducedMotion } from 'motion/react'

/** Fades and slides step content in when `stepKey` changes. Reduced-motion users get no movement. */
export default function StepTransition({ stepKey, children }) {
  const reduce = useReducedMotion()
  return (
    <motion.div key={stepKey} initial={reduce ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.35, ease: 'easeOut' }}>
      {children}
    </motion.div>
  )
}
