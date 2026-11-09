import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { ErrorState } from '../components/kit'
import { describeError } from './auth/authKit'

/**
 * Handles the Google OAuth2 callback.
 *
 * Flow:
 *  1. Backend server-side OAuth exchange completes at /api/auth/google/callback and sets the HttpOnly session cookies
 *  2. Backend redirects to the web app at /auth/google/callback?login=success (no tokens in the URL)
 *  3. This page fetches /users/me with the cookie and applies auth state
 */
export default function GoogleCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { applyAuth } = useAuth()
  const called = useRef(false)
  const [failure, setFailure] = useState(null)

  useEffect(() => {
    if (called.current) return
    called.current = true

    if (searchParams.get('error') || searchParams.get('login') !== 'success') {
      setFailure('We could not complete sign in with Google. Try again from the sign-in page.')
      return
    }

    api.get('/users/me')
      .then((user) => {
        applyAuth({ user })
        navigate('/lead-requests', { replace: true })
      })
      .catch((err) => {
        setFailure(err?.isNetworkError ? describeError(err).message : 'We could not complete sign in with Google. Try again from the sign-in page.')
      })
    // Runs once on arrival: the one-time guard above stops a double fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (failure) {
    return (
      <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app px-4">
        <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-0 h-80 w-80 rounded-full bg-primary-400/25 blur-3xl" />
        <div className="card relative w-full max-w-sm shadow-lift ring-1 ring-primary-500/10">
          <ErrorState title="Google sign-in failed" message={failure} className="py-10" />
          <div className="px-6 pb-8 text-center">
            <Link to="/login" className="btn-primary">
              Back to sign in
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-app px-4">
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-0 h-80 w-80 rounded-full bg-primary-400/25 blur-3xl" />
      <div role="status" className="glass relative flex items-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold text-ink shadow-lift">
        <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-primary-600 dark:text-primary-400" />
        Completing sign in…
      </div>
    </main>
  )
}
