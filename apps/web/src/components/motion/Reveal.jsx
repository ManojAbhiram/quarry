import { useRef } from 'react'
import { useStaggerIn } from './useStaggerIn'

/**
 * Wraps a group and fades its `[data-reveal]` children in one after another on mount. The wrapper itself is a
 * plain element; reduced-motion users see the final state. Pass `dependencies` when the children arrive later
 * (for example after data loads) so they are revealed too.
 */
export default function Reveal({ as: Tag = 'div', className, children, selector, dependencies, ...props }) {
  const ref = useRef(null)
  useStaggerIn(ref, { selector, dependencies })
  return (
    <Tag ref={ref} className={className} {...props}>
      {children}
    </Tag>
  )
}
