import { useId } from 'react'
import { cn } from '../lib/utils'

export default function BrandLogo({ className = 'w-8 h-8', title = 'Quarry logo' }) {
  const titleId = useId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width="64"
      height="64"
      fill="currentColor"
      role={title ? 'img' : undefined}
      aria-labelledby={title ? titleId : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
      className={cn('shrink-0 text-primary-700 dark:text-primary-300', className)}
    >
      {title && <title id={titleId}>{title}</title>}
      <path d="M20 4H36L52 20V38L40 26V24L32 16H24L16 24V32L24 40H26L38 52H20L4 36V20Z" />
      <path d="M32 24L60 52V60H52L24 32Z" />
    </svg>
  )
}
