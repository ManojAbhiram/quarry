import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'
import { api } from '../api'
import { Button, Field, ErrorState } from '../components/kit'
import { AuthLayout, FormAlert, PasswordField, MIN_PASSWORD, describeError, useForm } from './auth/authKit'

function ExpiredLink({ message }) {
  return (
    <AuthLayout title="Reset password">
      <div className="rounded-lg border border-line bg-surface">
        <ErrorState title="This reset link can't be used" message={message} className="py-10" />
        <div className="px-6 pb-8 text-center">
          <Link to="/forgot-password" className="btn-primary">
            Request a new link
          </Link>
        </div>
      </div>
    </AuthLayout>
  )
}

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const [done, setDone] = useState(false)
  const [tokenError, setTokenError] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)

  const form = useForm(
    { password: '', confirm: '' },
    {
      password: (v) => (!v ? 'Enter a new password.' : v.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : ''),
      confirm: (v, all) => (!v ? 'Confirm your new password.' : v !== all.password ? 'Passwords do not match.' : ''),
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
      await api.post('/auth/reset-password', { token, new_password: form.values.password })
      setDone(true)
    } catch (err) {
      if (err?.status === 400 || err?.status === 401 || err?.status === 404) {
        setTokenError('The link is invalid or has expired. Reset links work once and only for a short time.')
      } else {
        setError({ ...describeError(err, { fallback: 'Could not reset the password. Please try again.' }), retryFn: submit })
      }
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  if (!token) return <ExpiredLink message="This link is missing its reset token. Request a new one to continue." />
  if (tokenError) return <ExpiredLink message={tokenError} />

  if (done) {
    return (
      <AuthLayout title="Password reset">
        <div role="status" className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
          <p className="text-ink">Password updated. You can now sign in with your new password.</p>
        </div>
        <Link to="/login" className="btn-primary mt-4 w-full">
          Sign in
        </Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Set a new password" description="Choose a password you have not used before.">
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert error={error} disabled={loading} />
        <PasswordField label="New password" name="password" autoComplete="new-password" autoFocus required hint={`At least ${MIN_PASSWORD} characters.`} {...form.bind('password')} />
        <Field label="Confirm password" type="password" name="confirm" autoComplete="new-password" required {...form.bind('confirm')} />
        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Resetting…' : 'Reset password'}
        </Button>
      </form>
    </AuthLayout>
  )
}
