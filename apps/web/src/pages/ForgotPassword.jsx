import { useRef, useState } from 'react'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { api } from '../api'
import { Button, Field } from '../components/kit'
import { AuthLayout, AuthLink, FormAlert, EMAIL_RE, describeError, useForm } from './auth/authKit'

export default function ForgotPassword() {
  const [sentTo, setSentTo] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)

  const form = useForm(
    { email: '' },
    { email: (v) => (!v.trim() ? 'Enter your email address.' : !EMAIL_RE.test(v.trim()) ? 'Enter a valid email address.' : '') },
  )

  const submit = async (e) => {
    e?.preventDefault()
    if (busy.current) return
    form.touchAll()
    if (form.hasErrors()) return
    const email = form.values.email.trim()
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      await api.post('/auth/forgot-password', { email })
      setSentTo(email)
    } catch (err) {
      setError({ ...describeError(err, { fallback: 'Could not send the reset link. Please try again.' }), retryFn: submit })
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  const back = (
    <AuthLink to="/login" className="inline-flex min-h-10 items-center gap-1.5">
      <ArrowLeft aria-hidden="true" className="h-4 w-4" />
      Back to sign in
    </AuthLink>
  )

  if (sentTo) {
    return (
      <AuthLayout title="Check your email" footer={back}>
        <div role="status" className="flex items-start gap-3 rounded-lg border border-line bg-surface p-4 text-sm">
          <MailCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-ok" />
          <p className="min-w-0 break-words text-ink">
            If an account exists for {sentTo}, we have sent a link to reset the password. It may take a minute to arrive, so check your spam folder too.
          </p>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Forgot your password?" description="Enter your email and we will send you a link to reset it." footer={back}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert error={error} disabled={loading} />
        <Field label="Email" type="email" name="email" autoComplete="email" autoFocus required placeholder="you@company.com" {...form.bind('email')} />
        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>
    </AuthLayout>
  )
}
