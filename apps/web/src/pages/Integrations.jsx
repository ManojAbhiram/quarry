import { useCallback, useEffect, useState } from 'react'
import { Coins, KeyRound, Plus, Webhook } from 'lucide-react'
import { enrichApi, integrationsApi } from '../api.p3'
import { Button, EmptyState, Field, PageHeader, useToast } from '../components/kit'
import { Loadable, Pill, Section } from './p3/ui'

function useLoad(fn) {
  const [state, setState] = useState('loading')
  const [data, setData] = useState(null)
  const load = useCallback(async () => {
    setState('loading')
    try { setData(await fn()); setState('ready') } catch { setState('error') }
  }, [fn])
  useEffect(() => { load() }, [load])
  return { state, data, load }
}

function SecretOnce({ label, value }) {
  return (
    <div role="status" className="mb-3 rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">
      <p className="font-semibold text-ink">{label} (shown once, copy it now)</p>
      <code className="mt-1 block break-all text-xs">{value}</code>
    </div>
  )
}

const keysFn = () => integrationsApi.keys()
const hooksFn = () => integrationsApi.webhooks()
const credFn = () => enrichApi.credits()

function ApiKeys() {
  const toast = useToast()
  const { state, data, load } = useLoad(keysFn)
  const [name, setName] = useState('')
  const [secret, setSecret] = useState(null)
  const create = async (e) => {
    e.preventDefault()
    try { const r = await integrationsApi.createKey({ name: name || 'API key' }); setSecret(r.key); setName(''); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'Could not create the key.' }) }
  }
  const revoke = async (k) => {
    try { await integrationsApi.revokeKey(k._id); toast.push({ type: 'success', message: 'Key revoked.' }); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'Could not revoke.' }) }
  }
  const keys = data?.keys || []
  return (
    <Section title="API keys" description="Read-only access to requests, leads and lists at /api/public/v1. Keys are stored hashed.">
      <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2">
        <Field className="min-w-[12rem] flex-1" label="Key name" value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit"><Plus aria-hidden="true" className="h-4 w-4" />Create key</Button>
      </form>
      {secret && <SecretOnce label="API key" value={secret} />}
      <Loadable state={state} onRetry={load} label="API keys">
        {keys.length === 0 ? <EmptyState icon={KeyRound} title="No API keys" description="Create a key to read your data from scripts." className="py-8" /> : (
          <ul className="divide-y divide-line">{keys.map((k) => (
            <li key={k._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span><span className="font-semibold text-ink">{k.name}</span> <code className="text-xs text-muted">{k.prefix}…</code></span>
              {k.revoked_at ? <Pill tone="bad">Revoked</Pill> : <Button size="sm" variant="secondary" aria-label={`Revoke ${k.name}`} onClick={() => revoke(k)}>Revoke</Button>}
            </li>))}</ul>
        )}
      </Loadable>
    </Section>
  )
}

function Webhooks() {
  const toast = useToast()
  const { state, data, load } = useLoad(hooksFn)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState(null)
  const create = async (e) => {
    e.preventDefault()
    try { const r = await integrationsApi.createWebhook({ url }); setSecret(r.secret); setUrl(''); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'Could not add the webhook.' }) }
  }
  const act = async (fn, ok) => { try { await fn(); toast.push({ type: 'success', message: ok }); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'That did not work.' }) } }
  const hooks = data?.webhooks || []
  return (
    <Section title="Webhooks" description="Signed JSON POSTs (X-Quarry-Signature, HMAC-SHA256) with automatic retries.">
      <form onSubmit={create} className="mb-4 flex flex-wrap items-end gap-2">
        <Field className="min-w-[14rem] flex-1" label="Endpoint URL" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button type="submit"><Plus aria-hidden="true" className="h-4 w-4" />Add webhook</Button>
      </form>
      {secret && <SecretOnce label="Signing secret" value={secret} />}
      <Loadable state={state} onRetry={load} label="webhooks">
        {hooks.length === 0 ? <EmptyState icon={Webhook} title="No webhooks" description="Get notified about replies, bounces, signals and alerts." className="py-8" /> : (
          <ul className="divide-y divide-line">{hooks.map((h) => (
            <li key={h._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span className="min-w-0 break-all font-medium text-ink">{h.url}</span>
              <span className="flex flex-wrap items-center gap-2">
                <Pill tone={h.active ? 'ok' : 'warn'}>{h.active ? 'Active' : 'Disabled'}</Pill>
                <Button size="sm" variant="secondary" onClick={() => act(() => integrationsApi.testWebhook(h._id), 'Test event sent.')}>Send test</Button>
                <Button size="sm" variant="ghost" onClick={() => act(() => integrationsApi.patchWebhook(h._id, { active: !h.active }), h.active ? 'Disabled.' : 'Enabled.')}>{h.active ? 'Disable' : 'Enable'}</Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${h.url}`} onClick={() => act(() => integrationsApi.deleteWebhook(h._id), 'Webhook deleted.')}>Delete</Button>
              </span>
            </li>))}</ul>
        )}
      </Loadable>
    </Section>
  )
}

function Enrichment() {
  const toast = useToast()
  const { state, data, load } = useLoad(credFn)
  const [drafts, setDrafts] = useState({})
  const save = async (p) => {
    try { await enrichApi.setKey(p, drafts[p]); setDrafts({ ...drafts, [p]: '' }); toast.push({ type: 'success', message: 'Key saved.' }); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'Could not save the key.' }) }
  }
  return (
    <Section title="Email lookup credits" description="These are separate from the request credits on your Billing page. Emails are looked up in order: existing scrape, Hunter, Snov, People Data Labs. You pay credits only for hits on platform keys; your own keys cost no credits.">
      <Loadable state={state} onRetry={load} label="credits">
        {data && (
          <>
            <p className="mb-4 flex items-center gap-2 text-3xl font-black text-ink tabular-nums"><Coins aria-hidden="true" className="h-7 w-7 text-primary-600" />{data.balance}<span className="text-sm font-semibold text-muted">credits</span></p>
            <ul className="space-y-3">{data.providers.map((p) => (
              <li key={p.provider} className="flex flex-wrap items-end gap-2">
                <Field className="min-w-[14rem] flex-1" label={`${p.provider} API key`} type="password" autoComplete="off" placeholder={p.byo_key || (p.platform_key ? 'Using the platform key' : 'Not set')} value={drafts[p.provider] || ''} onChange={(e) => setDrafts({ ...drafts, [p.provider]: e.target.value })} hint={`${p.credits_per_hit} credit${p.credits_per_hit === 1 ? '' : 's'} per hit on the platform key`} />
                <Button variant="secondary" disabled={!(drafts[p.provider] || '').trim()} onClick={() => save(p.provider)}>Save</Button>
                {p.byo_key && <Button variant="ghost" aria-label={`Remove ${p.provider} key`} onClick={async () => { await enrichApi.deleteKey(p.provider); load() }}>Remove</Button>}
              </li>))}</ul>
          </>
        )}
      </Loadable>
    </Section>
  )
}

export default function Integrations() {
  return (
    <div className="h-full overflow-y-auto pb-12 page-container">
      <PageHeader title="Integrations" description="API keys, webhooks and enrichment providers. Looking for HubSpot or Zapier? See CRM integrations in the account menu." />
      <div className="space-y-6"><ApiKeys /><Webhooks /><Enrichment /></div>
    </div>
  )
}
