import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { STORAGE_KEYS } from '../config/constants'

/**
 * Handles the Google OAuth2 callback.
 *
 * Flow:
 *  1. Backend server-side OAuth exchange completes at /auth/google/callback
 *  2. Backend redirects to http://localhost:3000/auth/google/callback?access_token=...&refresh_token=...
 *  3. This page reads the tokens, fetches /users/me, and applies auth state
 */
export default function GoogleCallback() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { applyAuth } = useAuth()
  const called = useRef(false)

  useEffect(() => {
    if (called.current) return
    called.current = true

    const accessToken = searchParams.get('access_token')
    const refreshToken = searchParams.get('refresh_token') || ''
    const error = searchParams.get('error')

    if (error || !accessToken) {
      navigate('/login?error=google_auth_failed', { replace: true })
      return
    }

    // Store tokens so api.get can attach the Authorization header
    localStorage.setItem(STORAGE_KEYS.TOKEN, accessToken)
    if (refreshToken) localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refreshToken)

    api.get('/users/me')
      .then((user) => {
        applyAuth({ access_token: accessToken, refresh_token: refreshToken, user })
        navigate('/lead-requests', { replace: true })
      })
      .catch(() => {
        localStorage.removeItem(STORAGE_KEYS.TOKEN)
        localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
        navigate('/login?error=google_auth_failed', { replace: true })
      })
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] dark:bg-[#060b13]">
      <div className="text-center space-y-3 animate-fade-in">
        <div className="w-10 h-10 border-4 border-primary-600 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-sm font-bold text-slate-600 dark:text-slate-400">Completing sign in…</p>
      </div>
    </div>
  )
}
