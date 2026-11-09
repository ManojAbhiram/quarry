import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Eraser, History, Link2, Plus, Trash2 } from 'lucide-react'
import { api } from '../api'
import { Button, EmptyState, ErrorState, Field, PageHeader, Skeleton, useToast } from '../components/kit'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import Section from './profile/Section'
import ConfirmDialog from './requests/ConfirmDialog'

const when = (iso) => (iso ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
const ACTIONS = { erase_person: 'Erased a person', retention_purge: 'Deleted expired leads' }

function SuppressionList() {
  const toast = useToast()
  const [state, setState] = useState({ status: 'loading', items: [] })
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState('')

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    api.getSuppressions().then((d) => setState({ status: 'ready', items: d.items })).catch(() => setState({ status: 'error', items: [] }))
  }, [])
  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    if (!value.trim()) return setError('Enter an email address or a domain.')
    setBusy(true)
    setError('')
    try {
      await api.addSuppression(value.trim(), reason.trim())
      setValue('')
      setReason('')
      toast.push({ type: 'success', message: 'Added to the suppression list.' })
      load()
    } catch (err) {
      setError(err.message || 'Could not add that.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item) => {
    try {
      await api.removeSuppression(item.value)
      setState((s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) }))
      toast.push({ type: 'success', message: `${item.value} removed.` })
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not remove it.' })
    }
  }

  const makeLink = async () => {
    if (!/@/.test(value)) return setError('Enter a full email address to make an opt-out link.')
    setError('')
    try {
      setLink((await api.makeOptOutLink(value.trim())).url)
    } catch (err) {
      setError(err.message || 'Could not make a link.')
    }
  }

  return (
    <Section id="suppression" title="Suppression list" description="Addresses and domains that are never exported or contacted. A domain also covers its subdomains." icon={Ban}>
      <form onSubmit={add} noValidate className="grid gap-4 sm:grid-cols-[1.4fr_1fr_auto] sm:items-start">
        <Field id="sup-value" label="Email or domain" placeholder="jane@acme.com or acme.com" value={value} disabled={busy} error={error} onChange={(e) => { setValue(e.target.value); setError('') }} />
        <Field id="sup-reason" label="Reason (optional)" value={reason} disabled={busy} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2 sm:mt-7">
          <Button type="submit" loading={busy}>{!busy && <Plus aria-hidden="true" className="h-4 w-4" />}Add</Button>
          <Button variant="secondary" onClick={makeLink} title="Create a signed opt-out link for this email">
            <Link2 aria-hidden="true" className="h-4 w-4" />Opt-out link
          </Button>
        </div>
      </form>
      {link && (
        <p className="mt-3 break-all rounded-md bg-head p-2 font-mono text-xs text-ink" role="status">{link}</p>
      )}

      <div className="mt-5">
        {state.status === 'loading' && <div role="status" aria-label="Loading list"><Skeleton className="h-16 w-full" /></div>}
        {state.status === 'error' && <ErrorState title="Could not load the suppression list" message="Check your connection and try again." onRetry={load} />}
        {state.status === 'ready' && state.items.length === 0 && <EmptyState icon={Ban} title="Nothing suppressed yet" description="People who opt out and anyone you erase are added here automatically." />}
        {state.status === 'ready' && state.items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {state.items.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="break-all text-sm font-semibold text-ink">{i.value} <span className="ml-1 rounded-full bg-head px-2 py-0.5 text-xs font-medium text-muted">{i.kind}</span></p>
                  <p className="text-xs text-muted">{[i.reason, `Source: ${i.source.replace('_', ' ')}`, when(i.created_at)].filter(Boolean).join(' · ')}</p>
                </div>
                <Button size="sm" variant="ghost" aria-label={`Remove ${i.value}`} className="text-bad hover:text-bad" onClick={() => remove(i)}>
                  <Trash2 aria-hidden="true" className="h-4 w-4" />Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

function ErasureTool({ onDone }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [suppress, setSuppress] = useState(true)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const ask = (e) => {
    e.preventDefault()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return setError('Enter the person’s full email address.')
    setError('')
    setConfirm(true)
  }

  const run = async () => {
    setBusy(true)
    try {
      setResult(await api.erasePerson(email.trim(), suppress))
      setEmail('')
      toast.push({ type: 'success', message: 'Data erased.' })
      onDone()
    } catch (err) {
      setError(err.message || 'Erasure failed. Nothing was changed.')
    } finally {
      setBusy(false)
      setConfirm(false)
    }
  }

  return (
    <Section id="erasure" title="Erase a person" description="Delete everything you hold about someone, found by their email address. The action is recorded in the audit log without their address." icon={Eraser} danger>
      <form onSubmit={ask} noValidate className="space-y-4">
        <Field id="erase-email" label="Email address" type="email" className="sm:max-w-md" value={email} error={error} disabled={busy} onChange={(e) => { setEmail(e.target.value); setError(''); setResult(null) }} />
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={suppress} onChange={(e) => setSuppress(e.target.checked)} className="h-4 w-4 accent-primary-600" />
          Also add to the suppression list so they are not collected again
        </label>
        <Button type="submit" variant="danger" disabled={!email.trim()}><Eraser aria-hidden="true" className="h-4 w-4" />Erase data</Button>
      </form>
      {result && (
        <p role="status" className="mt-4 rounded-md bg-ok-soft p-3 text-sm text-ok">
          Deleted {result.decision_makers_deleted} contact{result.decision_makers_deleted === 1 ? '' : 's'}, cleared the email from {result.leads_email_cleared} lead{result.leads_email_cleared === 1 ? '' : 's'}.
        </p>
      )}
      <ConfirmDialog open={confirm} destructive loading={busy} title="Erase this person’s data?" description={`All contacts with ${email.trim()} are deleted and their email is removed from your leads. This cannot be undone.`} confirmLabel="Erase" onConfirm={run} onCancel={() => setConfirm(false)} />
    </Section>
  )
}

function AuditLog({ refreshKey }) {
  const toast = useToast()
  const [state, setState] = useState({ status: 'loading', items: [] })
  const [running, setRunning] = useState(false)

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    api.getAuditLog().then((d) => setState({ status: 'ready', items: d.items })).catch(() => setState({ status: 'error', items: [] }))
  }, [])
  useEffect(() => { load() }, [load, refreshKey])

  const purge = async () => {
    setRunning(true)
    try {
      const r = await api.runRetention(false)
      toast.push({ type: 'success', message: `${r.leads_deleted} expired lead${r.leads_deleted === 1 ? '' : 's'} deleted.` })
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not run the deletion.' })
    } finally {
      setRunning(false)
    }
  }

  return (
    <Section id="audit" title="Retention and audit log" description="Leads you reject, and search results never added to a list, are deleted after 30 days. Every erasure and deletion is logged here." icon={History}>
      <Button variant="secondary" loading={running} onClick={purge}>Delete expired leads now</Button>
      <div className="mt-5">
        {state.status === 'loading' && <div role="status" aria-label="Loading log"><Skeleton className="h-12 w-full" /></div>}
        {state.status === 'error' && <ErrorState title="Could not load the audit log" message="Try again in a moment." onRetry={load} />}
        {state.status === 'ready' && state.items.length === 0 && <EmptyState icon={History} title="No actions yet" description="Erasures and automatic deletions will appear here." />}
        {state.status === 'ready' && state.items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {state.items.map((i) => (
              <li key={i.id} className="px-3 py-2.5 text-sm">
                <p className="font-semibold text-ink">{ACTIONS[i.action] || i.action}{i.details.subject_masked ? `: ${i.details.subject_masked}` : ''}</p>
                <p className="text-xs text-muted">
                  {when(i.created_at)}
                  {i.action === 'erase_person' && ` · ${i.details.decision_makers_deleted} contacts deleted, ${i.details.leads_email_cleared} leads cleared`}
                  {i.action === 'retention_purge' && ` · ${i.details.leads_deleted} leads deleted`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  )
}

export default function Compliance() {
  const pageRef = useRef(null)
  useStaggerIn(pageRef)
  const [auditKey, setAuditKey] = useState(0)
  return (
    <div ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <div className="mx-auto max-w-4xl">
        <div data-reveal>
          <PageHeader title="Compliance" description="Keep your outreach lawful: suppress people, erase data on request and keep a record." />
          <p className="-mt-4 mb-6 text-sm text-muted">Read the <Link to="/privacy" className="font-semibold text-primary-700 underline dark:text-primary-300">privacy notice</Link> for how Quarry handles personal data.</p>
        </div>
        <div className="space-y-6">
          <SuppressionList />
          <ErasureTool onDone={() => setAuditKey((k) => k + 1)} />
          <AuditLog refreshKey={auditKey} />
        </div>
      </div>
    </div>
  )
}
