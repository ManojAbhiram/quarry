import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Link2, ListChecks, RefreshCw, SlidersHorizontal, Webhook } from 'lucide-react'
import { api } from '../api'
import { Button, EmptyState, ErrorState, Field, PageHeader, Skeleton, useToast } from '../components/kit'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import ConfirmDialog from './requests/ConfirmDialog'
import Section from './profile/Section'

const STATUS_STYLE = {
  synced: 'bg-ok-soft text-ok ring-ok/20',
  failed: 'bg-bad-soft text-bad ring-bad/20',
  not_synced: 'bg-head text-muted ring-line',
}
const STATUS_LABEL = { synced: 'Synced', failed: 'Failed', not_synced: 'Not synced' }

function Connection({ data, onChange }) {
  const toast = useToast()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const hub = data.integrations.find((i) => i.provider === 'hubspot')

  const connect = async (e) => {
    e.preventDefault()
    if (token.trim().length < 8) return setError('Paste your HubSpot private app access token.')
    setBusy(true)
    setError('')
    try {
      await api.put('/integrations/hubspot/token', { access_token: token.trim() })
      setToken('')
      toast.push({ type: 'success', message: 'HubSpot connected.' })
      onChange()
    } catch (err) {
      setError(err.message || 'Could not connect.')
    } finally {
      setBusy(false)
    }
  }

  const oauth = async () => {
    try {
      const res = await api.get('/integrations/hubspot/oauth/url')
      window.location.assign(res.url)
    } catch (err) {
      setError(err.message || 'Could not start the HubSpot sign-in.')
    }
  }

  const disconnect = async () => {
    setBusy(true)
    try {
      await api.delete('/integrations/hubspot')
      toast.push({ type: 'success', message: 'HubSpot disconnected.' })
      setConfirm(false)
      onChange()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not disconnect.' })
      setConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  if (hub?.connected) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-ok-soft px-3 py-1 text-sm font-semibold text-ok ring-1 ring-inset ring-ok/20">
          <CheckCircle2 aria-hidden="true" className="h-4 w-4" /> Connected{hub.info?.portal_id ? ` to portal ${hub.info.portal_id}` : ''} via {hub.auth_type === 'oauth' ? 'OAuth' : 'private app'}
        </p>
        {data.can_manage && <Button variant="secondary" onClick={() => setConfirm(true)}>Disconnect</Button>}
        <ConfirmDialog open={confirm} title="Disconnect HubSpot?" description="Sync history for this connection will be deleted. Records already in HubSpot are not touched." confirmLabel="Disconnect" destructive loading={busy} onConfirm={disconnect} onCancel={() => setConfirm(false)} />
      </div>
    )
  }

  if (!data.can_manage) return <p className="text-sm text-muted">HubSpot is not connected. Ask an owner or admin to connect it.</p>

  return (
    <form onSubmit={connect} noValidate className="space-y-4">
      {data.crm_connections_allowed < 1 && <p role="status" className="rounded-xl bg-warn-soft p-3 text-sm font-medium text-warn">Your plan does not include CRM integrations. Upgrade on the Billing page.</p>}
      <Field id="hubspot-token" label="Private app access token" type="password" autoComplete="off" className="sm:max-w-md" value={token} disabled={busy} placeholder="pat-na1-…" hint="Create a private app in HubSpot with company and contact read/write scopes. The token is stored encrypted." error={error} onChange={(e) => { setToken(e.target.value); setError('') }} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy}><Link2 aria-hidden="true" className="h-4 w-4" /> Connect HubSpot</Button>
        {data.hubspot_oauth_available && <Button variant="secondary" onClick={oauth}>Sign in with HubSpot</Button>}
      </div>
    </form>
  )
}

function Mapping({ data }) {
  const toast = useToast()
  const [mapping, setMapping] = useState(null)
  const [state, setState] = useState('loading')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setState('loading')
    api.get('/integrations/hubspot/mapping')
      .then((r) => { setMapping(r.mapping); setState('ready') })
      .catch(() => setState('error'))
  }, [])
  useEffect(load, [load])

  const set = (kind, field, value) => setMapping((m) => ({ ...m, [kind]: { ...m[kind], [field]: value } }))

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    const clean = {}
    for (const kind of ['company', 'contact']) clean[kind] = Object.fromEntries(Object.entries(mapping[kind]).filter(([, v]) => v && v.trim()).map(([k, v]) => [k, v.trim()]))
    try {
      const r = await api.put('/integrations/hubspot/mapping', clean)
      setMapping(r.mapping)
      toast.push({ type: 'success', message: 'Field mapping saved.' })
    } catch (err) {
      setError(err.message || 'Could not save the mapping.')
    } finally {
      setSaving(false)
    }
  }

  if (state === 'loading') return <Skeleton className="h-40 w-full" />
  if (state === 'error') return <ErrorState title="Could not load the mapping" onRetry={load} className="py-6" />

  return (
    <form onSubmit={save} noValidate className="space-y-6">
      {['company', 'contact'].map((kind) => (
        <fieldset key={kind} className="space-y-3">
          <legend className="mb-1 text-sm font-bold capitalize text-ink">{kind} fields</legend>
          {Object.entries(data.fields[kind]).map(([field, label]) => {
            const locked = (kind === 'company' && field === 'domain') || (kind === 'contact' && field === 'email')
            return (
              <div key={field} className="grid items-center gap-2 sm:grid-cols-2">
                <label htmlFor={`map-${kind}-${field}`} className="text-sm text-ink">{label}</label>
                <input id={`map-${kind}-${field}`} className="input h-10 py-0 font-mono text-sm" value={mapping[kind][field] || ''} disabled={locked || !data.can_manage} placeholder="not synced" onChange={(e) => set(kind, field, e.target.value)} aria-describedby={locked ? `map-${kind}-${field}-lock` : undefined} />
                {locked && <span id={`map-${kind}-${field}-lock`} className="sr-only">Used to match existing records; cannot be changed.</span>}
              </div>
            )
          })}
        </fieldset>
      ))}
      <p className="text-xs text-muted">Enter the HubSpot internal property name (lowercase, for example <code>firstname</code> or a custom <code>quarry_score</code>). Leave blank to skip a field.</p>
      {error && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">{error}</p>}
      {data.can_manage && <Button type="submit" loading={saving}>Save mapping</Button>}
    </form>
  )
}

function Push({ canPush }) {
  const toast = useToast()
  const [lists, setLists] = useState({ status: 'loading', items: [] })
  const [listId, setListId] = useState('')
  const [sync, setSync] = useState(null)
  const [loadingSync, setLoadingSync] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [syncError, setSyncError] = useState('')
  const titles = useRef({})

  useEffect(() => {
    api.get('/lists')
      .then((r) => setLists({ status: 'ready', items: r?.lists || [] }))
      .catch(() => setLists({ status: 'error', items: [] }))
  }, [])

  const loadSync = useCallback(async (id) => {
    if (!id) return setSync(null)
    setLoadingSync(true)
    setSyncError('')
    try {
      const [s, list] = await Promise.all([api.get(`/integrations/hubspot/sync?list_id=${encodeURIComponent(id)}`), api.get(`/lists/${encodeURIComponent(id)}`)])
      titles.current = Object.fromEntries((list?.leads || []).map((l) => [l.id, l.title || l.url]))
      setSync(s)
    } catch (err) {
      setSyncError(err.message || 'Could not load sync status.')
      setSync(null)
    } finally {
      setLoadingSync(false)
    }
  }, [])
  useEffect(() => { loadSync(listId) }, [listId, loadSync])

  const push = async (onlyFailed) => {
    setPushing(true)
    try {
      const r = await api.post('/integrations/hubspot/push', { list_id: listId, only_failed: onlyFailed })
      const { synced, failed } = r.summary
      toast.push({ type: failed ? 'error' : 'success', message: failed ? `${synced} synced, ${failed} failed. See details below.` : `${synced} lead${synced === 1 ? '' : 's'} synced to HubSpot.` })
      await loadSync(listId)
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Push failed.' })
    } finally {
      setPushing(false)
    }
  }

  if (lists.status === 'loading') return <Skeleton className="h-16 w-full" />
  if (lists.status === 'error') return <ErrorState title="Could not load your lists" className="py-6" />
  if (lists.items.length === 0) return <EmptyState icon={ListChecks} title="No lead lists yet" description="Save leads into a list, then push the list to HubSpot." className="py-8" />

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <label htmlFor="push-list" className="label">Lead list</label>
          <select id="push-list" className="input h-10 w-full py-0 text-sm" value={listId} onChange={(e) => setListId(e.target.value)}>
            <option value="">Choose a list…</option>
            {lists.items.map((l) => <option key={l._id} value={l._id}>{l.name} ({(l.lead_ids || []).length})</option>)}
          </select>
        </div>
        {canPush && <Button disabled={!listId} loading={pushing} onClick={() => push(false)}>Push to HubSpot</Button>}
        {canPush && sync?.counts?.failed > 0 && <Button variant="secondary" disabled={pushing} onClick={() => push(true)}><RefreshCw aria-hidden="true" className="h-4 w-4" /> Retry failed</Button>}
      </div>
      {loadingSync && <Skeleton className="h-24 w-full" />}
      {syncError && <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">{syncError}</p>}
      {sync && !loadingSync && (
        <>
          <p className="text-sm text-muted" aria-live="polite">{sync.counts.synced} synced · {sync.counts.failed} failed · {sync.counts.not_synced} not synced</p>
          <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Sync status per lead">
            {sync.leads.map((l) => (
              <li key={l.lead_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{titles.current[l.lead_id] || l.lead_id}</span>
                  {l.error && <span className="block text-xs text-bad">{l.error}{l.retryable ? ' (will work on retry)' : ''}</span>}
                </span>
                <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset', STATUS_STYLE[l.status])}>{STATUS_LABEL[l.status] || l.status}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function Hooks({ canManage }) {
  const toast = useToast()
  const [state, setState] = useState({ status: 'loading', hooks: [] })
  const load = useCallback(() => {
    api.get('/hooks').then((r) => setState({ status: 'ready', hooks: r?.hooks || [] })).catch(() => setState({ status: 'error', hooks: [] }))
  }, [])
  useEffect(load, [load])

  const remove = async (id) => {
    try {
      await api.delete(`/hooks/${id}`)
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not remove the hook.' })
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <p className="text-muted">In Zapier or Make, use a webhook trigger that subscribes with <code className="rounded bg-head px-1">POST /api/hooks/subscribe</code> (<code className="rounded bg-head px-1">lead.created</code> or <code className="rounded bg-head px-1">list.updated</code>) and unsubscribes with <code className="rounded bg-head px-1">DELETE /api/hooks/&#123;id&#125;</code>. Deliveries are signed with <code className="rounded bg-head px-1">X-Quarry-Signature</code>.</p>
      {state.status === 'loading' && <Skeleton className="h-12 w-full" />}
      {state.status === 'error' && <ErrorState title="Could not load hooks" onRetry={load} className="py-6" />}
      {state.status === 'ready' && state.hooks.length === 0 && <EmptyState icon={Webhook} title="No active hooks" description="Hooks created by Zapier or Make show up here." className="py-8" />}
      {state.status === 'ready' && state.hooks.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Active hooks">
          {state.hooks.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <span className="min-w-0"><span className="font-semibold text-ink">{h.event}</span> <span className="break-all text-xs text-muted">{h.target_url}</span>{!h.active && <span className="ml-2 text-xs font-semibold text-bad">disabled after repeated failures</span>}</span>
              {canManage && <Button size="sm" variant="ghost" onClick={() => remove(h.id)} aria-label={`Remove hook for ${h.event}`}>Remove</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function Integrations() {
  const pageRef = useRef(null)
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const load = useCallback(() => {
    api.get('/integrations')
      .then((data) => setState({ status: 'ready', data, error: '' }))
      .catch((e) => setState({ status: 'error', data: null, error: e.message || 'Could not load integrations.' }))
  }, [])
  useEffect(load, [load])
  useStaggerIn(pageRef, { dependencies: [state.status] })

  const data = state.data
  const connected = data?.integrations.find((i) => i.provider === 'hubspot')?.connected

  return (
    <div id="integrations-page" ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <div className="mx-auto max-w-4xl">
        <div data-reveal>
          <PageHeader title="CRM integrations" description="Send leads to your CRM and trigger automations. API keys and webhooks are under Integrations." />
        </div>
        {state.status === 'loading' && <div role="status" aria-label="Loading integrations" className="space-y-4"><Skeleton className="h-40 w-full" /><Skeleton className="h-40 w-full" /></div>}
        {state.status === 'error' && <ErrorState title="Could not load integrations" message={state.error} onRetry={load} />}
        {state.status === 'ready' && (
          <div className="space-y-6">
            <Section id="hubspot" title="HubSpot" description="Companies are matched by website domain and contacts by email, so pushing twice never duplicates." icon={Link2}>
              <Connection data={data} onChange={() => { setState((s) => ({ ...s, status: 'loading' })); load() }} />
            </Section>
            {connected && (
              <>
                <Section id="mapping" title="Field mapping" description="Choose which HubSpot property each Quarry field is written to." icon={SlidersHorizontal}>
                  <Mapping data={data} />
                </Section>
                <Section id="push" title="Push a list" description="Sync a lead list now and see the result for every lead." icon={ListChecks}>
                  <Push canPush />
                </Section>
              </>
            )}
            <Section id="automation" title="Zapier and Make" description="Real-time events over REST hooks." icon={Webhook}>
              <Hooks canManage={data.can_manage} />
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
