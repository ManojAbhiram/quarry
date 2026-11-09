import { useCallback, useEffect, useState } from 'react'
import { BellRing, Plus, Radar, RefreshCw } from 'lucide-react'
import { watchApi } from '../api.p3'
import { Button, EmptyState, Field, PageHeader, useToast } from '../components/kit'
import { Loadable, Pill, Section } from './p3/ui'

const KIND_TONE = { hiring: 'info', funding: 'ok', tech: 'warn', news: 'info' }
const searchesFn = () => watchApi.searches()
const signalsFn = () => watchApi.signals()

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

function Searches() {
  const toast = useToast()
  const { state, data, load } = useLoad(searchesFn)
  const [form, setForm] = useState({ name: '', text: '', min_score: 0, slack: '' })
  const [saving, setSaving] = useState(false)
  const create = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await watchApi.createSearch({ name: form.name, query: { text: form.text, min_score: Number(form.min_score) || 0 }, ...(form.slack ? { slack_webhook_url: form.slack } : {}) })
      setForm({ name: '', text: '', min_score: 0, slack: '' })
      toast.push({ type: 'success', message: 'Saved. You will be alerted about new matches.' })
      load()
    } catch (err) { toast.push({ type: 'error', message: err.message || 'Could not save.' }) } finally { setSaving(false) }
  }
  const run = async (s) => {
    try { const r = await watchApi.runSearch(s._id); toast.push({ type: 'success', message: `${r.new} new match${r.new === 1 ? '' : 'es'}.` }); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'Run failed.' }) }
  }
  const searches = data?.searches || []
  return (
    <Section title="Saved searches" description="Get an email (and optional Slack message) when new leads match.">
      <form onSubmit={create} className="mb-5 grid gap-3 sm:grid-cols-2">
        <Field label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Field label="Keywords" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} />
        <Field label="Minimum score" type="number" min="0" max="100" value={form.min_score} onChange={(e) => setForm({ ...form, min_score: e.target.value })} />
        <Field label="Slack incoming-webhook URL" type="url" value={form.slack} onChange={(e) => setForm({ ...form, slack: e.target.value })} hint="Optional. Stored encrypted." />
        <div className="sm:col-span-2"><Button type="submit" loading={saving}><Plus aria-hidden="true" className="h-4 w-4" />Save search</Button></div>
      </form>
      <Loadable state={state} onRetry={load} label="saved searches">
        {searches.length === 0 ? <EmptyState icon={BellRing} title="No saved searches" description="Save one above to start receiving alerts." className="py-8" /> : (
          <ul className="divide-y divide-line">{searches.map((s) => (
            <li key={s._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
              <span><span className="font-semibold text-ink">{s.name}</span> {s.has_slack && <Pill>Slack</Pill>} {s.last_error && <Pill tone="bad">Last alert failed</Pill>}</span>
              <span className="flex gap-2"><Button size="sm" variant="secondary" onClick={() => run(s)}>Run now</Button><Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={async () => { await watchApi.deleteSearch(s._id); load() }}>Delete</Button></span>
            </li>))}</ul>
        )}
      </Loadable>
    </Section>
  )
}

function Signals() {
  const toast = useToast()
  const { state, data, load } = useLoad(signalsFn)
  const [scanning, setScanning] = useState(false)
  const scan = async () => {
    setScanning(true)
    try { await watchApi.scan(); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'Scan failed.' }) } finally { setScanning(false) }
  }
  const items = data?.signals || []
  return (
    <Section title="Signals" description="Hiring, funding and tech-stack changes across your leads' companies." actions={<Button variant="secondary" loading={scanning} onClick={scan}><RefreshCw aria-hidden="true" className="h-4 w-4" />Scan now</Button>}>
      <Loadable state={state} onRetry={load} label="signals">
        {items.length === 0 ? <EmptyState icon={Radar} title="No signals yet" description="Changes are detected between scans, so the first scan sets a baseline." className="py-8" /> : (
          <ul className="divide-y divide-line">{items.map((s) => (
            <li key={s._id} className="flex flex-wrap items-start gap-2 py-2.5 text-sm">
              <Pill tone={KIND_TONE[s.kind] || 'info'}>{s.kind}</Pill>
              <span className="min-w-0 flex-1"><span className="font-semibold text-ink">{s.domain}</span> <span className="text-muted break-words">{s.summary}</span></span>
            </li>))}</ul>
        )}
      </Loadable>
    </Section>
  )
}

export default function Watch() {
  return (
    <div className="h-full overflow-y-auto pb-12 page-container">
      <PageHeader title="Watch" description="Alerts and buying signals." />
      <div className="space-y-6"><Searches /><Signals /></div>
    </div>
  )
}
