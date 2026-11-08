import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { Button, Field } from '../components/kit'
import { AuthLayout, AuthLink, FormAlert, PasswordField, EMAIL_RE, describeError, useForm } from './auth/authKit'

const WRONG_CREDENTIALS = 'Incorrect email or password. If you signed up with Google, use Continue with Google.'

function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  )
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState(
    searchParams.get('error') === 'google_auth_failed' ? { message: 'Google sign-in failed. Please try again.' } : null,
  )
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const busy = useRef(false)

  const form = useForm(
    { email: '', password: '' },
    {
      email: (v) => (!v.trim() ? 'Enter your email address.' : !EMAIL_RE.test(v.trim()) ? 'Enter a valid email address.' : ''),
      password: (v) => (!v ? 'Enter your password.' : ''),
    },
  )

  const submit = async (e) => {
    e?.preventDefault()
    if (busy.current) return
    form.touchAll()
    if (form.hasErrors()) return
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      await login(form.values.email.trim(), form.values.password)
      navigate('/')
    } catch (err) {
      const wrong = err?.status && err.status < 500 && err.status !== 429
      setError(wrong ? { message: WRONG_CREDENTIALS } : { ...describeError(err, { fallback: 'Sign in failed. Please try again.' }), retryFn: submit })
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  const google = async () => {
    if (busy.current) return
    busy.current = true
    setError(null)
    setGoogleLoading(true)
    try {
      const { url } = await api.get('/auth/google/url')
      window.location.href = url
    } catch (err) {
      setError({ ...describeError(err, { fallback: 'Could not start Google sign-in. Please try again.' }), retryFn: google })
      setGoogleLoading(false)
    } finally {
      busy.current = false
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back to Quarry."
      footer={
        <>
          New to Quarry? <AuthLink to="/register">Create an account</AuthLink>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert error={error} disabled={loading || googleLoading} />
        <Field label="Email" type="email" name="email" autoComplete="email" autoFocus required placeholder="you@company.com" {...form.bind('email')} />
        <PasswordField label="Password" name="password" autoComplete="current-password" required {...form.bind('password')} />
        <div className="-mt-2 text-right text-sm">
          <AuthLink to="/forgot-password" className="inline-flex min-h-10 items-center">
            Forgot password?
          </AuthLink>
        </div>
        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>

      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <Button variant="secondary" onClick={google} loading={googleLoading} disabled={loading} className="w-full">
        {!googleLoading && <GoogleMark />}
        Continue with Google
      </Button>
    </AuthLayout>
  )
}
