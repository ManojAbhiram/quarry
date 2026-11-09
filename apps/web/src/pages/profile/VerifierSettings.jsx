import { useCallback, useEffect, useState } from 'react'
import { MailCheck, Save, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { Button, Field, Skeleton, useToast } from '../../components/kit'
import Section from './Section'

/** Choose how email addresses are verified: free checks, an optional SMTP probe, or your own paid provider key. */
export default function VerifierSettings() {
  const toast = useToast()
  const [s, setS] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [provider, setProvider] = useState('')
  const [smtp, setSmtp] = useState(false)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoadError(false)
    Promise.resolve()
      .then(() => api.getVerifierSettings())
      .then((d) => {
        setS(d)
        setProvider(d.provider || '')
        setSmtp(!!d.smtp_probe)
      })
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const save = async (e) => {
    e.preventDefault()
    if (provider && !key.trim() && !s?.has_key) return setError('Paste the API key for this provider.')
    setError('')
    setSaving(true)
    try {
      const body = { provider, smtp_probe: smtp }
      if (key.trim()) body.api_key = key.trim()
      const d = await api.setVerifierSettings(body)
      setS(d)
      setKey('')
      toast.push({ type: 'success', message: 'Email verification settings saved.' })
    } catch (err) {
      setError(err.message || 'Could not save your settings.')
    } finally {
      setSaving(false)
    }
  }

  const removeKey = async () => {
    try {
      setS(await api.deleteVerifierKey())
      toast.push({ type: 'success', message: 'Provider key removed.' })
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not remove the key.' })
    }
  }

  return (
    <Section id="email-verification" title="Email verification" description="Every address gets a status: Verified, Likely, Risky or Invalid. Free checks always run; add a provider key for deeper checks." icon={MailCheck}>
      {!s && !loadError && <Skeleton className="h-24 w-full" />}
      {loadError && (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span className="font-semibold text-warn">Could not load these settings.</span>
          <Button size="sm" variant="secondary" onClick={load}>Try again</Button>
        </p>
      )}
      {s && (
        <form onSubmit={save} noValidate className="space-y-5">
          <div>
            <label htmlFor="verifier-provider" className="label">Paid provider (optional)</label>
            <select id="verifier-provider" className="input sm:max-w-md" value={provider} onChange={(e) => { setProvider(e.target.value); setError('') }} disabled={saving}>
              <option value="">None, free checks only</option>
              {s.providers.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
            </select>
          </div>
          {provider && (
            <Field
              id="verifier-key"
              label="Provider API key"
              type="password"
              autoComplete="off"
              className="sm:max-w-md"
              value={key}
              disabled={saving}
              placeholder={s.has_key ? `Saved (${s.masked}). Enter a new key to replace` : 'Paste your API key'}
              hint="Stored encrypted and never shown again. Checks are billed to your provider account."
              error={error}
              onChange={(e) => { setKey(e.target.value); setError('') }}
            />
          )}
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={smtp} onChange={(e) => setSmtp(e.target.checked)} disabled={saving} className="mt-0.5 h-4 w-4 accent-primary-600" />
            <span>Probe the mail server directly (SMTP). Slower, and many networks block it. Also detects catch-all domains.</span>
          </label>
          {!provider && error && <p role="alert" className="text-sm font-medium text-bad">{error}</p>}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
            <Button type="submit" loading={saving}>{!saving && <Save aria-hidden="true" className="h-4 w-4" />} Save settings</Button>
            {s.has_key && (
              <Button variant="ghost" className="text-bad hover:text-bad" onClick={removeKey}>
                <Trash2 aria-hidden="true" className="h-4 w-4" /> Remove key
              </Button>
            )}
          </div>
        </form>
      )}
    </Section>
  )
}
