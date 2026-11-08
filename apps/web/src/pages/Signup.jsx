import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, Field } from '../components/kit'
import { AuthLayout, AuthLink, FormAlert, PasswordField, EMAIL_RE, MIN_PASSWORD, describeError, useForm } from './auth/authKit'

export default function Signup() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)

  const form = useForm(
    { name: '', email: '', org_name: '', org_domain: '', password: '', confirm: '' },
    {
      name: (v) => (!v.trim() ? 'Enter your name.' : ''),
      email: (v) => (!v.trim() ? 'Enter your email address.' : !EMAIL_RE.test(v.trim()) ? 'Enter a valid email address.' : ''),
      org_name: (v) => (!v.trim() ? 'Enter your organization name.' : ''),
      org_domain: (v) => (!v.trim() ? 'Enter your organization domain.' : ''),
      password: (v) => (!v ? 'Enter a password.' : v.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : ''),
      confirm: (v, all) => (!v ? 'Confirm your password.' : v !== all.password ? 'Passwords do not match.' : ''),
    },
  )

  const submit = async (e) => {
    e?.preventDefault()
    if (busy.current) return
    form.touchAll()
    if (form.hasErrors()) return
    const v = form.values
    busy.current = true
    setLoading(true)
    setError(null)
    try {
      await register(v.email.trim(), v.password, v.name.trim(), v.org_name.trim(), v.org_domain.trim())
      navigate('/')
    } catch (err) {
      setError({ ...describeError(err, { fallback: 'Sign up failed. Please try again.' }), retryFn: submit })
    } finally {
      busy.current = false
      setLoading(false)
    }
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Set up your workspace to start finding leads."
      footer={
        <>
          Already have an account? <AuthLink to="/login">Sign in</AuthLink>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormAlert error={error} disabled={loading} />
        <Field label="Full name" name="name" autoComplete="name" autoFocus required {...form.bind('name')} />
        <Field label="Work email" type="email" name="email" autoComplete="email" required placeholder="you@company.com" {...form.bind('email')} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organization name" name="org_name" autoComplete="organization" required {...form.bind('org_name')} />
          <Field label="Organization domain" name="org_domain" autoComplete="off" required placeholder="company.com" {...form.bind('org_domain')} />
        </div>
        <PasswordField label="Password" name="password" autoComplete="new-password" required hint={`At least ${MIN_PASSWORD} characters.`} {...form.bind('password')} />
        <Field label="Confirm password" type="password" name="confirm" autoComplete="new-password" required {...form.bind('confirm')} />
        <Button type="submit" loading={loading} className="w-full">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </AuthLayout>
  )
}
