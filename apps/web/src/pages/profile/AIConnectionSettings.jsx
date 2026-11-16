import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { Button } from '../../components/kit'
import Section from './Section'
import { KeyRound } from 'lucide-react'

const endpoint = '/users/me/ai-connection'
const inputClass = 'mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-primary-500'

export default function AIConnectionSettings() {
  const [connection, setConnection] = useState(null)
  const [provider, setProvider] = useState('openrouter')
  const [key, setKey] = useState('')
  const [primary, setPrimary] = useState('')
  const [fast, setFast] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const sequence = useRef(0)
  const apply = (data) => {
    setConnection(data)
    setProvider(data.provider || data.providers?.find((item) => item.metadata_available)?.id || data.providers?.[0]?.id || 'openrouter')
    setPrimary(data.primary_model || ''); setFast(data.fast_model || '')
  }
  useEffect(() => {
    let active = true
    api.get(endpoint).then((data) => { if (active) apply(data) }).catch(() => { if (active) setError('Could not load AI connection settings.') })
    return () => { active = false; sequence.current += 1 }
  }, [])
  const run = async (action, message) => {
    const version = ++sequence.current
    setBusy(true); setError(''); setNotice('')
    try {
      const data = await action()
      if (sequence.current !== version) return
      apply(data); setKey(''); setNotice(message)
    } catch (err) {
      if (sequence.current === version) setError(err.message || 'Could not update the connection.')
    } finally {
      if (sequence.current === version) setBusy(false)
    }
  }
  const sameProvider = provider === connection?.provider
  const selectedProvider = connection?.providers?.find((item) => item.id === provider)
  const models = sameProvider && !key ? connection?.models || [] : []
  const shown = models.filter((m) => `${m.display_name} ${m.id}`.toLowerCase().includes(query.toLowerCase()) || m.id === primary || m.id === fast)
  const dirty = !!key || !sameProvider
  const options = shown.map((m) => <option key={m.id} value={m.id} disabled={!m.eligible}>{m.display_name || m.id}{m.eligible ? '' : ' — capability unknown'}</option>)
  return <Section id="ai-provider" icon={KeyRound} title="AI provider" description="Use your own provider for research, extraction and scoring. Model access and credits are confirmed only by actual work.">
    {!connection && !error && <p role="status" className="text-sm text-muted">Loading AI connection…</p>}
    {error && <p role="alert" className="mb-3 text-sm text-bad">{error}</p>}
    {notice && <p role="status" className="mb-3 text-sm text-muted">{notice}</p>}
    <form className="space-y-4" onSubmit={(event) => {
      event.preventDefault()
      run(() => api.put(endpoint, { provider, api_key: key.trim(), revision: connection?.revision || null }), 'Connection saved securely. You can finish model setup later.')
    }}>
      <label className="block text-sm font-medium">Provider
        <select className={inputClass} value={provider} disabled={busy || !connection} onChange={(event) => {
          sequence.current += 1
          setProvider(event.target.value); setKey(''); setPrimary(''); setFast(''); setQuery(''); setError(''); setNotice('')
        }}>{(connection?.providers || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      </label>
      {selectedProvider?.public_catalogue && <p className="text-sm text-muted">OpenRouter provides a public catalogue without sending your API key. Model access and credential validity remain unconfirmed.</p>}
      {selectedProvider?.metadata_available === false && <p className="text-sm text-warn">Model discovery is not yet enabled for this provider. You can save its key for later, or choose OpenRouter to finish model setup.</p>}
      {sameProvider && connection?.has_key && <p className="text-sm text-muted">Saved key: <code>{connection.masked}</code></p>}
      <label className="block text-sm font-medium">AI provider API key
        <input type="password" autoComplete="new-password" spellCheck={false} className={inputClass} value={key} disabled={busy || !connection} onChange={(event) => { setKey(event.target.value); setNotice('') }} placeholder={sameProvider && connection?.has_key ? 'Enter a replacement key' : 'Paste your provider key'} />
      </label>
      <p className="text-xs text-muted">Stored encrypted on the server. Saving does not verify credentials or run generation. Replacing a key clears model selections.</p>
      <Button type="submit" disabled={busy || key.trim().length < 8 || /\s/.test(key.trim())}>Save connection</Button>
    </form>
    {sameProvider && connection?.has_key && <div className="mt-5 space-y-4 border-t border-line pt-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy || dirty || selectedProvider?.verification_available === false} onClick={() => run(() => api.post(`${endpoint}/verify`, {}), 'Credential inspection finished; no generation performed.')}>Verify credentials</Button>
        <Button variant="secondary" disabled={busy || dirty} onClick={() => run(() => api.post(`${endpoint}/refresh`, {}), 'Model discovery finished; no generation performed.')}>Refresh models</Button>
        <Button variant="ghost" disabled={busy} onClick={() => run(() => api.delete(endpoint), 'AI provider disconnected.')}>Disconnect provider</Button>
      </div>
      {selectedProvider?.verification_available === false && <p className="text-xs text-muted">Credential verification is unavailable. You can choose discovered models without a test generation; your key is used only when you request AI work.</p>}
      {connection.verification?.message && <p role="status" className="text-sm text-muted">{connection.verification.message}</p>}
      {connection.catalog_warning && <p className="text-sm text-muted">{connection.catalog_warning}</p>}
      <label className="block text-sm font-medium">Search models
        <input type="search" className={inputClass} value={query} disabled={!models.length || busy} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name or model ID" />
      </label>
      <label className="block text-sm font-medium">Primary model
        <select className={inputClass} disabled={busy || !models.length} value={primary} onChange={(event) => setPrimary(event.target.value)}><option value="">Choose a text model</option>{options}</select>
      </label>
      <label className="block text-sm font-medium">Fast model (optional)
        <select className={inputClass} disabled={busy || !models.length} value={fast} onChange={(event) => setFast(event.target.value)}><option value="">Use primary model</option>{options}</select>
      </label>
      {primary && <p className="text-xs text-muted">Model ID: {primary}. Access unconfirmed; metadata is not an inference test.</p>}
      {!models.length && <p className="text-sm text-muted">Model setup can be deferred. Refresh models when discovery is available; AI work requires a compatible primary model.</p>}
      <Button disabled={busy || !primary || dirty} onClick={() => run(() => api.put(endpoint, { provider, primary_model: primary, fast_model: fast || null, revision: connection.revision }), 'Model choices saved.')}>Save models</Button>
    </div>}
    {!connection && error && <Button variant="secondary" onClick={() => run(() => api.get(endpoint), 'Settings loaded.')}>Retry AI settings</Button>}
  </Section>
}
