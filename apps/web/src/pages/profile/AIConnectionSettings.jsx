import { useEffect, useRef, useState } from 'react'
import { KeyRound, LockKeyhole, RefreshCw } from 'lucide-react'
import { api } from '../../api'
import { Button, Field } from '../../components/kit'
import Section from './Section'

const endpoint = '/users/me/ai-connection'
const defaultProvider = (data) => data.provider || data.providers?.find((item) => item.metadata_available)?.id || data.providers?.[0]?.id || ''
const savedFastModel = (data) => data.fast_model === data.primary_model ? '' : data.fast_model || ''

export default function AIConnectionSettings() {
  const [connection, setConnection] = useState(null)
  const [provider, setProvider] = useState('')
  const [key, setKey] = useState('')
  const [primary, setPrimary] = useState('')
  const [fast, setFast] = useState('')
  const [query, setQuery] = useState('')
  const [pending, setPending] = useState('')
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState('')
  const sequence = useRef(0)

  useEffect(() => {
    const version = ++sequence.current
    api.get(endpoint).then((data) => {
      if (sequence.current !== version) return
      setConnection(data)
      setProvider(defaultProvider(data))
      setPrimary(data.primary_model || '')
      setFast(savedFastModel(data))
    }).catch(() => {
      if (sequence.current === version) setError({ message: 'Could not load AI connection settings.', reload: true })
    })
    return () => { sequence.current += 1 }
  }, [])

  const run = async (operation, request, message) => {
    const version = ++sequence.current
    setPending(operation)
    setNotice('')
    try {
      const data = await request()
      if (sequence.current !== version) return
      setConnection(data)
      if (operation !== 'reload' || !key || !data.providers?.some((item) => item.id === provider)) {
        setProvider(defaultProvider(data))
        setKey('')
      }
      setPrimary(data.primary_model || '')
      setFast(savedFastModel(data))
      setQuery('')
      setError(null)
      setNotice(message)
    } catch (err) {
      if (sequence.current === version) setError({
        message: err.message || 'Could not update the connection.',
        reload: operation === 'reload' || err.status === 409,
      })
    } finally {
      if (sequence.current === version) setPending('')
    }
  }

  const blocked = !!pending || !!error?.reload
  const sameProvider = provider === connection?.provider
  const selectedProvider = connection?.providers?.find((item) => item.id === provider)
  const models = sameProvider ? connection?.models || [] : []
  const filter = query.trim().toLowerCase()
  const shown = models.filter((model) => model.id === primary || model.id === fast || `${model.display_name} ${model.id}`.toLowerCase().includes(filter))
  const eligibleCount = models.filter((model) => model.eligible).length
  const keyDraft = key.trim()
  const saveable = keyDraft.length >= 8 && keyDraft.length <= 1024 && !/\s/.test(keyDraft)
  const wantsReplacement = !!key || !sameProvider
  const status = connection?.ready ? 'Model selected' : connection?.has_key ? 'Key saved' : 'Not connected'
  const options = shown.map((model) => (
    <option key={model.id} value={model.id} disabled={!model.eligible}>
      {model.display_name || model.id}{model.eligible ? '' : ' (capability unknown)'}
    </option>
  ))

  return (
    <Section id="ai-provider" icon={KeyRound} plain title="AI provider" description="Run research, extraction and scoring with your own provider and model.">
      {!connection && !error && <p role="status" className="text-sm text-muted">Loading AI connection…</p>}
      {error && <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-bad/20 bg-bad-soft p-3 text-sm text-bad">
        <p role="alert">{error.message}</p>
        {error.reload && <Button size="sm" variant="secondary" loading={pending === 'reload'}
          onClick={() => run('reload', () => api.get(endpoint), 'Connection settings reloaded.')}>
          Reload connection
        </Button>}
      </div>}
      {notice && <p role="status" className="mb-4 rounded-lg border border-ok/20 bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</p>}

      {connection && <>
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-app px-3 py-2 text-sm">
          <span className="inline-flex items-center gap-2 font-medium text-ink">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${connection.ready ? 'bg-ok' : connection.has_key ? 'bg-warn' : 'bg-muted'}`} />
            {status}
          </span>
          {connection.has_key && <span className="text-muted">{connection.providers?.find((item) => item.id === connection.provider)?.name || connection.provider}</span>}
          {connection.masked && <code className="break-all text-xs text-muted">{connection.masked}</code>}
        </div>

        <form className="space-y-4" onSubmit={(event) => {
          event.preventDefault()
          if (!blocked && saveable) {
            run('key', () => api.put(endpoint, { provider, api_key: keyDraft, revision: connection.revision || null }), 'Connection saved. Credentials are unverified.')
          }
        }}>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <Field label="Provider" as="select" value={provider} disabled={blocked} onChange={(event) => {
              const next = event.target.value
              setProvider(next); setKey(''); setQuery(''); setError(null); setNotice('')
              setPrimary(next === connection.provider ? connection.primary_model || '' : '')
              setFast(next === connection.provider ? savedFastModel(connection) : '')
            }}>
              {(connection.providers || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </Field>
            <Field label="AI provider API key" type="password" autoComplete="new-password" spellCheck={false}
              value={key} disabled={blocked} onChange={(event) => { setKey(event.target.value); setNotice('') }}
              placeholder={sameProvider && connection.has_key ? 'Enter a replacement key' : 'Paste your provider key'} />
          </div>
          {selectedProvider?.metadata_available === false && <p className="text-sm text-warn">
            Model discovery is not yet enabled for this provider. Save its key for later, or choose a provider with discovery to finish setup.
          </p>}
          {selectedProvider?.public_catalogue && <p className="text-sm text-muted">
            OpenRouter shares a public catalogue without sending your API key. Model selection does not confirm access or available credits.
          </p>}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button type="submit" variant={sameProvider && connection.has_key ? 'secondary' : 'solid'}
              loading={pending === 'key'} disabled={blocked || !provider || !saveable}>Save connection</Button>
            <p className="flex items-start gap-2 text-xs text-muted">
              <LockKeyhole aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              {connection.has_key ? 'Replacing the key clears saved model choices.' : 'Keys are encrypted on the server. Saving a key uses no provider credits.'}
            </p>
          </div>
        </form>

        {sameProvider && connection.has_key && (
          <div className="mt-6 space-y-4 rounded-xl border border-line bg-app p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-ink">Model selection</h3>
                <p className="mt-1 text-sm text-muted">
                  {models.length > 0
                    ? `${eligibleCount} compatible ${eligibleCount === 1 ? 'model' : 'models'} in the catalogue`
                    : selectedProvider?.metadata_available === false ? 'Model selection is unavailable for this provider.' : 'Refresh the catalogue to find a compatible text model.'}
                </p>
              </div>
              <Button size="sm" variant={models.length ? 'secondary' : 'solid'} loading={pending === 'refresh'}
                disabled={blocked || wantsReplacement || selectedProvider?.metadata_available === false}
                onClick={() => run('refresh', () => api.post(`${endpoint}/refresh`, {}), '')}>
                {pending !== 'refresh' && <RefreshCw aria-hidden="true" className="h-4 w-4" />} Refresh models
              </Button>
            </div>
            {connection.verification?.message && <p role="status" className="text-sm text-muted">{connection.verification.message}</p>}
            {connection.catalog_warning && <p className="text-sm text-warn">{connection.catalog_warning}</p>}
            {models.length > 0 && <Field label="Search models" type="search" value={query} disabled={blocked || wantsReplacement}
              onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name or model ID" />}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Primary model" as="select" disabled={blocked || wantsReplacement || !eligibleCount}
                value={primary} onChange={(event) => setPrimary(event.target.value)}>
                <option value="">Choose a text model</option>{options}
              </Field>
              <Field label="Fast model (optional)" as="select" disabled={blocked || wantsReplacement || !eligibleCount}
                value={fast} onChange={(event) => setFast(event.target.value)}>
                <option value="">Use primary model</option>{options}
              </Field>
            </div>
            {primary && <p className="break-all font-mono text-xs text-muted">{primary}</p>}
            {models.length > 0 && <Button variant="solid" loading={pending === 'models'} disabled={blocked || wantsReplacement || !primary}
              onClick={() => run('models', () => api.put(endpoint, { provider, primary_model: primary, fast_model: fast || null, revision: connection.revision }), 'Model choices saved.')}>
              Save models
            </Button>}
          </div>
        )}

        {connection.has_key && <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <Button size="sm" variant="ghost" loading={pending === 'verify'} disabled={blocked || wantsReplacement || selectedProvider?.verification_available === false}
            onClick={() => run('verify', () => api.post(`${endpoint}/verify`, {}), '')}
            aria-describedby={selectedProvider?.verification_available === false ? 'ai-verification-note' : undefined}>
            Verify credentials
          </Button>
          <Button size="sm" variant="ghost" className="text-bad" loading={pending === 'disconnect'} disabled={blocked || wantsReplacement}
            onClick={() => run('disconnect', () => api.delete(endpoint), 'AI provider disconnected.')}>
            Disconnect provider
          </Button>
          {selectedProvider?.verification_available === false && <p id="ai-verification-note" className="w-full text-xs text-muted">
            Credential verification is unavailable for this provider. Quarry uses the key when you request AI work.
          </p>}
        </div>}
      </>}
    </Section>
  )
}
