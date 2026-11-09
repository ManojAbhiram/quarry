import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, KeyRound, Lock, Mail, Save, ShieldAlert, Trash2, UserCircle2 } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { Button, Field, PageHeader, Skeleton, useToast } from '../components/kit'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import ConfirmDialog from './requests/ConfirmDialog'
import Section from './profile/Section'

const FIELD_MAX = 100
const PHONE_RE = /^[+()\d][\d\s().+-]{4,29}$/

const fromUser = (user) => ({
  name: user?.name || '',
  email: user?.email || '',
  company: user?.company || '',
  job_title: user?.job_title || '',
  phone: user?.phone || '',
})

function validate(p) {
  const e = {}
  if (!p.name.trim()) e.name = 'Enter your name.'
  else if (p.name.length > FIELD_MAX) e.name = `Keep it under ${FIELD_MAX} characters.`
  if (p.company.length > FIELD_MAX) e.company = `Keep it under ${FIELD_MAX} characters.`
  if (p.job_title.length > FIELD_MAX) e.job_title = `Keep it under ${FIELD_MAX} characters.`
  if (p.phone.trim() && !PHONE_RE.test(p.phone.trim())) e.phone = 'Use digits, spaces and + ( ) - only, for example +1 555 000 0000.'
  return e
}

export default function Profile() {
  const { user, logout, updateUser } = useAuth()
  const toast = useToast()
  const pageRef = useRef(null)
  useStaggerIn(pageRef)

  const [profile, setProfile] = useState(() => fromUser(user))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const [serper, setSerper] = useState({ state: 'loading', has_key: false, masked: null }) // loading | ready | error
  const [keyInput, setKeyInput] = useState('')
  const [keyError, setKeyError] = useState('')
  const [keySaving, setKeySaving] = useState(false)

  const [resetState, setResetState] = useState('idle') // idle | sending | sent | error
  const [confirm, setConfirm] = useState(null) // 'key' | 'account'
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (user) setProfile(fromUser(user))
  }, [user])

  const loadKey = useCallback(() => {
    setSerper((s) => ({ ...s, state: 'loading' }))
    api
      .getSerperKey()
      .then((s) => setSerper({ state: 'ready', has_key: !!s?.has_key, masked: s?.masked || null }))
      .catch(() => setSerper((s) => ({ ...s, state: 'error' })))
  }, [])

  useEffect(() => {
    loadKey()
  }, [loadKey])

  const dirty = (() => {
    const base = fromUser(user)
    return ['name', 'company', 'job_title', 'phone'].some((k) => profile[k] !== base[k])
  })()

  const setField = (key) => (e) => {
    setProfile((p) => ({ ...p, [key]: e.target.value }))
    if (errors[key]) setErrors((x) => ({ ...x, [key]: null }))
    setSaveError('')
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    const found = validate(profile)
    setErrors(found)
    if (Object.keys(found).length) return
    setSaving(true)
    setSaveError('')
    try {
      const updated = await api.put('/users/me', {
        name: profile.name.trim(),
        email: profile.email,
        company: profile.company.trim() || null,
        job_title: profile.job_title.trim() || null,
        phone: profile.phone.trim() || null,
      })
      updateUser(updated)
      toast.push({ type: 'success', message: 'Profile saved.' })
    } catch (err) {
      setSaveError(err.message || 'Could not save your profile.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveKey = async (e) => {
    e.preventDefault()
    const key = keyInput.trim()
    if (!key) return setKeyError('Paste your Serper API key first.')
    if (/\s/.test(key)) return setKeyError('A key has no spaces. Check what you pasted.')
    setKeyError('')
    setKeySaving(true)
    try {
      const status = await api.setSerperKey(key)
      setSerper({ state: 'ready', has_key: !!status?.has_key, masked: status?.masked || null })
      setKeyInput('')
      toast.push({ type: 'success', message: 'Search key saved.' })
    } catch (err) {
      setKeyError(err.message || 'Could not save the key.')
    } finally {
      setKeySaving(false)
    }
  }

  const sendReset = async () => {
    setResetState('sending')
    try {
      await api.post('/auth/forgot-password', { email: profile.email })
      setResetState('sent')
    } catch {
      setResetState('error')
    }
  }

  const runConfirm = async () => {
    setConfirming(true)
    try {
      if (confirm === 'key') {
        const status = await api.deleteSerperKey()
        setSerper({ state: 'ready', has_key: !!status?.has_key, masked: status?.masked || null })
        toast.push({ type: 'success', message: 'Search key removed.' })
      } else {
        await api.delete('/users/me')
        logout()
      }
      setConfirm(null)
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'That did not work. Nothing was changed.' })
      setConfirm(null)
    } finally {
      setConfirming(false)
    }
  }

  const initials =
    (profile.name || '')
      .split(' ')
      .filter(Boolean)
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U'

  return (
    <div id="profile-page" ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <div className="mx-auto max-w-4xl">
        <div data-reveal id="profile-header">
          <PageHeader title="Account settings" description="Manage your account details and security preferences." />
        </div>

        <div data-reveal id="profile-avatar-card" className="mb-6">
          <div className="card relative flex flex-col items-center gap-5 border-0 bg-gradient-to-br from-btn via-btn to-btn-hover p-6 text-white shadow-lift sm:flex-row sm:p-8">
            <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-12 h-52 w-52 rounded-full bg-accent-400/30 blur-3xl" />
            <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 left-10 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
            <div id="profile-avatar" aria-hidden="true" className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full border-4 border-white/30 bg-white/20 text-2xl font-extrabold shadow-inner backdrop-blur-md">
              {initials}
            </div>
            <div id="profile-name-email" className="relative min-w-0 flex-1 text-center sm:text-left">
              <p className="break-words text-xl font-black tracking-tight">{profile.name || 'Your name'}</p>
              <p className="break-all font-medium text-white/90">{profile.email}</p>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <Section id="personal-info" title="Personal information" description="Update your name and contact details." icon={UserCircle2}>
            <form id="personal-info-form" onSubmit={handleProfileSave} noValidate className="space-y-5">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <Field id="name" label="Full name" required autoComplete="name" value={profile.name} disabled={saving} placeholder="Your full name" error={errors.name} onChange={setField('name')} />
                <Field id="email" label="Email address" type="email" value={profile.email} readOnly disabled hint="Email cannot be changed." />
                <Field id="company" label="Company" autoComplete="organization" value={profile.company} disabled={saving} placeholder="Your company name" error={errors.company} onChange={setField('company')} />
                <Field id="jobTitle" label="Job title" autoComplete="organization-title" value={profile.job_title} disabled={saving} placeholder="e.g. Head of Sales" error={errors.job_title} onChange={setField('job_title')} />
                <Field id="phone" label="Phone number" type="tel" autoComplete="tel" className="sm:max-w-md" value={profile.phone} disabled={saving} placeholder="+1 (555) 000-0000" error={errors.phone} onChange={setField('phone')} />
              </div>
              {saveError && (
                <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">
                  {saveError}
                </p>
              )}
              <div id="personal-info-actions" className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
                <Button id="save-profile-btn" type="submit" loading={saving} disabled={!dirty}>
                  {!saving && <Save aria-hidden="true" className="h-4 w-4" />} Save changes
                </Button>
                {!dirty && <span className="text-sm text-muted">No changes to save.</span>}
              </div>
            </form>
          </Section>

          <Section id="password" title="Password" description="Change it with a secure link sent to your email." icon={Lock}>
            <div className="flex flex-wrap items-center gap-4">
              <Button id="send-reset-btn" variant="secondary" loading={resetState === 'sending'} disabled={!profile.email} onClick={sendReset}>
                {resetState !== 'sending' && <Mail aria-hidden="true" className="h-4 w-4" />} Email me a reset link
              </Button>
              {resetState === 'sent' && (
                <p role="status" className="flex items-center gap-1.5 text-sm font-semibold text-ok">
                  <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> If the address is right, a link is on its way. Check your inbox.
                </p>
              )}
              {resetState === 'error' && (
                <p role="alert" className="text-sm font-medium text-bad">
                  Could not send the link. Try again in a moment.
                </p>
              )}
            </div>
          </Section>

          <Section id="integrations" title="Integrations" description="Connect your own Serper.dev API key. Lead generation uses your key and quota." icon={KeyRound}>
            <form id="serper-key-form" onSubmit={handleSaveKey} noValidate className="space-y-5">
              <div className="flex flex-wrap items-center gap-2.5 text-sm" aria-live="polite">
                <span className="text-muted">Status:</span>
                {serper.state === 'loading' && <Skeleton className="h-6 w-40" />}
                {serper.state === 'error' && (
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-warn">Could not check your key.</span>
                    <Button size="sm" variant="secondary" onClick={loadKey}>
                      Try again
                    </Button>
                  </span>
                )}
                {serper.state === 'ready' && serper.has_key && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 font-semibold text-ok ring-1 ring-inset ring-ok/20">
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Connected
                    {serper.masked && <code className="ml-1 break-all rounded bg-surface/70 px-1.5 py-0.5 font-mono text-xs text-ink">{serper.masked}</code>}
                  </span>
                )}
                {serper.state === 'ready' && !serper.has_key && <span className="rounded-full bg-warn-soft px-3 py-1 font-semibold text-warn ring-1 ring-inset ring-warn/20">Not set. Required to launch lead generation.</span>}
              </div>
              <Field
                id="serperKey"
                label="Serper API key"
                type="password"
                autoComplete="off"
                className="sm:max-w-md"
                value={keyInput}
                disabled={keySaving}
                placeholder={serper.has_key ? 'Enter a new key to replace' : 'Paste your Serper.dev API key'}
                hint="Get a key at serper.dev. It is stored encrypted and never shown again."
                error={keyError}
                onChange={(e) => {
                  setKeyInput(e.target.value)
                  setKeyError('')
                }}
              />
              <div id="serper-key-actions" className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
                <Button id="save-serper-btn" type="submit" loading={keySaving} disabled={!keyInput.trim()}>
                  {!keySaving && <Save aria-hidden="true" className="h-4 w-4" />} {keySaving ? 'Validating…' : 'Save key'}
                </Button>
                {serper.has_key && (
                  <Button id="remove-serper-btn" variant="ghost" className="text-bad hover:text-bad" onClick={() => setConfirm('key')}>
                    <Trash2 aria-hidden="true" className="h-4 w-4" /> Remove key
                  </Button>
                )}
              </div>
            </form>
          </Section>

          <Section id="danger-zone" title="Delete account" description="Permanently delete your account and everything generated with it. This cannot be undone." icon={ShieldAlert} danger>
            <Button id="delete-account-btn" variant="danger" onClick={() => setConfirm('account')}>
              <Trash2 aria-hidden="true" className="h-4 w-4" /> Delete account
            </Button>
          </Section>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirm}
        destructive
        loading={confirming}
        title={confirm === 'key' ? 'Remove your search key?' : 'Delete your account?'}
        description={confirm === 'key' ? 'You will not be able to launch lead generation until you add a key again.' : 'This cannot be undone and you will lose all generated leads.'}
        confirmLabel={confirm === 'key' ? 'Remove key' : 'Delete account'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
