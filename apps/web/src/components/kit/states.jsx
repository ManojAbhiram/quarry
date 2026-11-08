import clsx from 'clsx'
import { AlertCircle, Inbox } from 'lucide-react'
import Button from './Button'

/** Nothing here yet: say why and offer the next step. */
export function EmptyState({ title, description, action, icon: Icon = Inbox, className }) {
  return (
    <div className={clsx('flex flex-col items-center justify-center text-center px-6 py-14', className)}>
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-100 to-accent-100 text-primary-700 shadow-inner ring-1 ring-primary-200/60 dark:from-primary-950 dark:to-accent-950 dark:text-primary-300 dark:ring-primary-900/60">
        <Icon aria-hidden="true" className="h-7 w-7" />
      </span>
      <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && (
        <Button className="mt-5" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}

/** Something failed: say what, show the reason, offer a retry when there is one. */
export function ErrorState({ title = 'Something went wrong', message, onRetry, className }) {
  return (
    <div role="alert" className={clsx('flex flex-col items-center justify-center text-center px-6 py-14', className)}>
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-bad-soft text-bad shadow-inner ring-1 ring-bad/20">
        <AlertCircle aria-hidden="true" className="h-7 w-7" />
      </span>
      <h2 className="text-lg font-bold tracking-tight text-ink">{title}</h2>
      {message && <p className="mt-1 max-w-md text-sm text-muted break-words">{message}</p>}
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

/** A loading placeholder block. Hidden from screen readers; pair it with a labelled region. */
export function Skeleton({ className }) {
  return <div aria-hidden="true" className={clsx('animate-pulse rounded-xl bg-head', className)} />
}

/** The page title (the page's h1), with an optional description and action buttons. */
export function PageHeader({ title, description, actions, className }) {
  return (
    <header className={clsx('flex flex-wrap items-start justify-between gap-3 mb-6', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-black tracking-tight text-ink break-words sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
