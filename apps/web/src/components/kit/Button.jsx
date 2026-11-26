import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  // Gradient between the palette's AA-safe button shade and its hover shade (see config/palettes.js), with a soft glow.
  primary: 'border-transparent bg-gradient-to-br from-btn to-btn-hover text-white shadow-lg shadow-primary-600/25 hover:shadow-lift hover:brightness-110',
  solid: 'rounded-lg border-transparent bg-btn text-white hover:bg-btn-hover',
  secondary: 'bg-surface/80 border-line text-ink shadow-sm backdrop-blur-md hover:bg-surface hover:shadow-md',
  ghost: 'bg-transparent border-transparent text-muted hover:bg-head hover:text-ink',
  danger: 'bg-bad border-bad text-white shadow-sm hover:opacity-90 dark:text-app',
}

const SIZES = {
  md: 'h-11 px-5 text-sm',
  sm: 'h-9 px-3.5 text-sm',
}

/** A plain <button> by default (never submits a form by accident). While `loading` it is disabled and busy. */
export default function Button({ variant = 'primary', size = 'md', loading = false, disabled, type = 'button', className, children, ...props }) {
  return (
    <button
      type={type}
      data-button-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 border font-semibold duration-200 disabled:opacity-60 disabled:cursor-not-allowed disabled:shadow-none',
        variant === 'solid' ? 'transition-colors' : 'rounded-xl transition-all active:scale-95',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}
