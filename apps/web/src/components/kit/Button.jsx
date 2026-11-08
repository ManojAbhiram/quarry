import clsx from 'clsx'
import { Loader2 } from 'lucide-react'

const VARIANTS = {
  primary:
    'bg-primary-600 border-primary-600 text-white hover:bg-primary-700 hover:border-primary-700 dark:bg-primary-400 dark:border-primary-400 dark:text-app dark:hover:bg-primary-300 dark:hover:border-primary-300',
  secondary: 'bg-surface border-line text-ink hover:bg-head',
  ghost: 'bg-transparent border-transparent text-muted hover:bg-head hover:text-ink',
  danger: 'bg-bad border-bad text-white hover:opacity-90 dark:text-app',
}

const SIZES = {
  md: 'h-10 px-4 text-sm',
  sm: 'h-8 px-3 text-sm',
}

/** A plain <button> by default (never submits a form by accident). While `loading` it is disabled and busy. */
export default function Button({ variant = 'primary', size = 'md', loading = false, disabled, type = 'button', className, children, ...props }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-md border font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
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
