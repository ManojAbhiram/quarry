import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { ErrorState } from './states'

/** Unknown URL: say so and offer a way back (instead of silently redirecting). */
export function NotFound() {
  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-sm font-semibold text-muted">404</p>
      <h1 className="mt-1 text-2xl font-bold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The page you opened doesn&apos;t exist or has moved.</p>
      <Link to="/lead-requests" className="btn-primary mt-6">
        Back to requests
      </Link>
    </main>
  )
}

/** Shown while the saved session is being checked, or when it could not be checked (offline, server error). */
export function BootScreen({ error, onRetry }) {
  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-app">
        <ErrorState title="Can't reach Quarry" message={error.message} onRetry={onRetry} />
      </main>
    )
  }
  return (
    <main className="flex min-h-screen items-center justify-center bg-app">
      <div role="status" className="flex items-center gap-2 text-sm text-muted">
        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    </main>
  )
}
