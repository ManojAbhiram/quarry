import { useCallback, useEffect, useState } from 'react'
import { Mail, Pause, Play, Plus, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { outreachApi } from '../api.p3'
import { api } from '../api'
import { Button, EmptyState, Field, PageHeader, useToast } from '../components/kit'
import Reveal from '../components/motion/Reveal'
import { Dialog, Loadable, Pill, Section, Tabs, pct } from './p3/ui'

const BLANK_BOX = { email: '', from_name: '', smtp_host: '', smtp_port: 587, smtp_password: '', imap_host: '', imap_password: '', daily_cap: 40, warmup: true, timezone: 'UTC' }
const BLANK_STEPS = [{ subject: '', body: '', delay_days: 0 }, { subject: '', body: '', delay_days: 3 }]

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

const listBoxes = () => outreachApi.mailboxes()
const listSeqs = () => outreachApi.sequences()

function MailboxDialog({ open, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(BLANK_BOX)
  const [saving, setSaving] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await outreachApi.createMailbox({ ...form, smtp_port: Number(form.smtp_port), daily_cap: Number(form.daily_cap) })
      toast.push({ type: 'success', message: 'Mailbox connected.' })
      setForm(BLANK_BOX)
      onSaved()
      onClose()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not save the mailbox.' })
    } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Connect a mailbox">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Email address" type="email" required value={form.email} onChange={set('email')} />
        <Field label="From name" value={form.from_name} onChange={set('from_name')} />
        <Field label="SMTP host" required value={form.smtp_host} onChange={set('smtp_host')} />
        <Field label="SMTP port" type="number" value={form.smtp_port} onChange={set('smtp_port')} />
        <Field label="SMTP password" type="password" required autoComplete="off" value={form.smtp_password} onChange={set('smtp_password')} hint="Stored encrypted. App passwords work best." />
        <Field label="IMAP host (reply detection)" value={form.imap_host} onChange={set('imap_host')} />
        <Field label="IMAP password" type="password" autoComplete="off" value={form.imap_password} onChange={set('imap_password')} hint="Leave blank to reuse the SMTP password." />
        <Field label="Daily send cap" type="number" min="1" value={form.daily_cap} onChange={set('daily_cap')} />
        <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-primary-600" checked={form.warmup} onChange={set('warmup')} />Ramp up gradually (warmup)</label>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving}>Connect</Button></div>
      </form>
    </Dialog>
  )
}

function Preflight({ result }) {
  return (
    <ul aria-label="DNS check results" className="mt-3 space-y-1 text-sm">
      {Object.entries(result.checks).map(([k, c]) => (
        <li key={k} className="flex flex-wrap items-center gap-2"><Pill tone={c.status === 'pass' ? 'ok' : c.status === 'warn' ? 'warn' : 'bad'}>{k.toUpperCase()}: {c.status}</Pill>{c.hint && <span className="text-muted">{c.hint}</span>}</li>
      ))}
    </ul>
  )
}

function MailboxesPanel({ onChanged }) {
  const toast = useToast()
  const { state, data, load: loadBoxes } = useLoad(listBoxes)
  // The sequence dialog reads the page-level mailbox list, so refresh it whenever a mailbox changes.
  const load = async () => { await loadBoxes(); onChanged?.() }
  const [open, setOpen] = useState(false)
  const [pre, setPre] = useState({})
  const run = async (fn, ok) => {
    try { const r = await fn(); if (ok) toast.push({ type: 'success', message: ok }); return r } catch (err) { toast.push({ type: 'error', message: err.message || 'That did not work.' }) }
    return null
  }
  const boxes = data?.mailboxes || []
  return (
    <Section title="Mailboxes" description="Sending and reply-detection accounts. Credentials are encrypted at rest." actions={<Button onClick={() => setOpen(true)}><Plus aria-hidden="true" className="h-4 w-4" />Connect mailbox</Button>}>
      <Loadable state={state} onRetry={load} label="mailboxes">
        {boxes.length === 0 ? (
          <EmptyState icon={Mail} title="No mailbox yet" description="Connect a mailbox to start sending sequences." action={{ label: 'Connect mailbox', onClick: () => setOpen(true) }} />
        ) : (
          <ul className="divide-y divide-line">
            {boxes.map((b) => (
              <li key={b._id} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0"><p className="break-all text-sm font-semibold text-ink">{b.email}</p><p className="text-xs text-muted">{b.daily_cap}/day cap{b.warmup ? ', warming up' : ''}</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    {b.paused && <Pill tone="bad">Paused: {b.pause_reason || 'manual'}</Pill>}
                    {b.paused && <Button size="sm" variant="secondary" onClick={async () => { await run(() => outreachApi.resumeMailbox(b._id), 'Mailbox resumed.'); load() }}>Resume</Button>}
                    <Button size="sm" variant="secondary" onClick={async () => { const r = await run(() => outreachApi.preflight(b._id)); if (r) setPre({ ...pre, [b._id]: r }) }}><ShieldCheck aria-hidden="true" className="h-4 w-4" />Check DNS</Button>
                    <Button size="sm" variant="ghost" aria-label={`Delete ${b.email}`} onClick={async () => { await run(() => outreachApi.deleteMailbox(b._id), 'Mailbox removed.'); load() }}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
                  </div>
                </div>
                {pre[b._id] && <Preflight result={pre[b._id]} />}
              </li>
            ))}
          </ul>
        )}
      </Loadable>
      <MailboxDialog open={open} onClose={() => setOpen(false)} onSaved={load} />
    </Section>
  )
}

function StepEditor({ steps, onChange }) {
  const upd = (i, k, v) => onChange(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)))
  return (
    <ol className="space-y-3">
      {steps.map((s, i) => (
        <li key={i} className="rounded-xl border border-line bg-surface/60 p-3">
          <p className="mb-2 flex items-center justify-between text-xs font-bold uppercase tracking-wide text-muted">Step {i + 1}{i > 0 && <button type="button" className="text-bad" onClick={() => onChange(steps.filter((_, j) => j !== i))}>Remove step {i + 1}</button>}</p>
          {i > 0 && <Field className="mb-2 max-w-[10rem]" label={`Wait (days) before step ${i + 1}`} type="number" min="1" value={s.delay_days} onChange={(e) => upd(i, 'delay_days', Number(e.target.value))} />}
          <Field label={`Subject ${i + 1}`} value={s.subject} onChange={(e) => upd(i, 'subject', e.target.value)} hint={i > 0 ? 'Leave empty to reply in the same thread.' : 'Use {{first_name|there}}, {{company}}, {{title}}.'} />
          <Field as="textarea" rows={4} className="mt-2" label={`Body ${i + 1}`} value={s.body} onChange={(e) => upd(i, 'body', e.target.value)} />
        </li>
      ))}
      {steps.length < 8 && <Button variant="secondary" size="sm" onClick={() => onChange([...steps, { subject: '', body: '', delay_days: 3 }])}><Plus aria-hidden="true" className="h-4 w-4" />Add follow-up</Button>}
    </ol>
  )
}

function SequenceDialog({ open, onClose, boxes, onSaved }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [mailbox, setMailbox] = useState('')
  const [steps, setSteps] = useState(BLANK_STEPS)
  const [tz, setTz] = useState('UTC')
  const [saving, setSaving] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await outreachApi.createSequence({ name, mailbox_id: mailbox || boxes[0]?._id, steps, timezone: tz })
      toast.push({ type: 'success', message: 'Sequence created.' })
      onSaved(); onClose()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not save the sequence.' })
    } finally { setSaving(false) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="New sequence" wide>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Name" required value={name} onChange={(e) => setName(e.target.value)} />
          <div><label htmlFor="seq-mailbox" className="label">Send from</label><select id="seq-mailbox" className="input" value={mailbox} onChange={(e) => setMailbox(e.target.value)}>{boxes.map((b) => <option key={b._id} value={b._id}>{b.email}</option>)}</select></div>
          <Field label="Time zone" value={tz} onChange={(e) => setTz(e.target.value)} hint="Sends 09:00 to 17:00, weekdays." />
        </div>
        <StepEditor steps={steps} onChange={setSteps} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={saving} disabled={!boxes.length}>Create sequence</Button></div>
      </form>
    </Dialog>
  )
}

export function EnrollDialog({ open, onClose, contacts, sequences, lists, onDone }) {
  const toast = useToast()
  const [seqId, setSeqId] = useState('')
  const [listId, setListId] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState(null)
  const target = seqId || sequences[0]?._id
  const submit = async () => {
    setBusy(true)
    try {
      const body = listId ? { list_id: listId } : { contacts }
      const res = await outreachApi.enroll(target, body)
      toast.push({ type: 'success', message: `Enrolled ${res.enrolled}${res.skipped?.length ? `, skipped ${res.skipped.length}` : ''}.` })
      onDone?.(res); onClose()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not enroll.' })
    } finally { setBusy(false) }
  }
  const showPreview = async () => {
    try { setPreview((await outreachApi.preview(target, contacts?.[0])).steps) } catch (err) { toast.push({ type: 'error', message: err.message || 'Preview failed.' }) }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Add to a sequence">
      {sequences.length === 0 ? <p className="text-sm text-muted">Create a sequence on the Outreach page first.</p> : (
        <div className="space-y-3">
          <div><label htmlFor="enroll-seq" className="label">Sequence</label><select id="enroll-seq" className="input" value={target} onChange={(e) => setSeqId(e.target.value)}>{sequences.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}</select></div>
          {contacts ? <p className="text-sm text-muted">{contacts.length} contact{contacts.length === 1 ? '' : 's'} with an email selected.</p> : (
            <div><label htmlFor="enroll-list" className="label">Lead list</label><select id="enroll-list" className="input" value={listId} onChange={(e) => setListId(e.target.value)}><option value="">Choose a list</option>{(lists || []).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</select></div>
          )}
          {preview && <div className="space-y-2 rounded-xl border border-line p-3 text-sm" aria-label="Preview">{preview.map((p) => <div key={p.step}><p className="font-semibold text-ink">{p.step}. {p.subject}</p><p className="whitespace-pre-wrap text-muted">{p.body}</p>{p.missing.length > 0 && <Pill tone="warn">Missing: {p.missing.join(', ')}</Pill>}</div>)}</div>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={showPreview}>Preview</Button><Button loading={busy} disabled={!contacts && !listId} onClick={submit}><Send aria-hidden="true" className="h-4 w-4" />Enroll</Button></div>
        </div>
      )}
    </Dialog>
  )
}

function Stats({ id }) {
  const { state, data, load } = useLoad(useCallback(() => outreachApi.stats(id), [id]))
  return (
    <Loadable state={state} onRetry={load} label="stats">
      {data && (
        <div className="mt-3">
          <p className="text-3xl font-black text-ink tabular-nums" aria-label="Reply rate">{pct(data.reply_rate)}<span className="ml-2 text-sm font-semibold text-muted">reply rate</span></p>
          <p className="text-xs text-muted">{data.contacted} contacted, {data.replies} replies, {data.bounces} bounces, {data.unsubscribes} unsubscribed</p>
          <table className="mt-3 w-full text-left text-sm"><caption className="sr-only">Per-step results</caption>
            <thead className="text-xs uppercase text-muted"><tr><th scope="col" className="py-1">Step</th><th scope="col">Sent</th><th scope="col">Replies</th><th scope="col">Reply rate</th><th scope="col">Bounces</th></tr></thead>
            <tbody>{data.steps.map((s) => <tr key={s.step} className="border-t border-line tabular-nums"><th scope="row" className="py-1 font-medium">{s.step}</th><td>{s.sent}</td><td>{s.replies}</td><td>{pct(s.reply_rate)}</td><td>{s.bounces}</td></tr>)}</tbody></table>
        </div>
      )}
    </Loadable>
  )
}

function SequencesPanel({ boxes }) {
  const toast = useToast()
  const { state, data, load } = useLoad(listSeqs)
  const [open, setOpen] = useState(false)
  const [enrollFor, setEnrollFor] = useState(null)
  const [lists, setLists] = useState([])
  const [shown, setShown] = useState(null)
  useEffect(() => { api.getLists().then((r) => setLists(r?.lists || [])).catch(() => {}) }, [])
  const seqs = data?.sequences || []
  const act = async (fn, ok) => {
    try { await fn(); toast.push({ type: 'success', message: ok }); load() } catch (err) { toast.push({ type: 'error', message: err.message || 'That did not work.' }) }
  }
  return (
    <Section title="Sequences" description="Multi-step emails that stop on reply, bounce or unsubscribe." actions={<Button onClick={() => setOpen(true)}><Plus aria-hidden="true" className="h-4 w-4" />New sequence</Button>}>
      <Loadable state={state} onRetry={load} label="sequences">
        {seqs.length === 0 ? <EmptyState icon={Send} title="No sequences yet" description="Build a sequence, then add leads from a list or from a company's decision makers." action={{ label: 'New sequence', onClick: () => setOpen(true) }} /> : (
          <Reveal as="ul" className="space-y-3" dependencies={[seqs.length]}>
            {seqs.map((s) => (
              <li key={s._id} data-reveal className="rounded-xl border border-line bg-surface/60 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="font-semibold text-ink">{s.name}</p><p className="text-xs text-muted">{s.steps.length} steps</p></div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={s.status === 'active' ? 'ok' : 'info'}>{s.status}</Pill>
                    {s.status === 'active' ? <Button size="sm" variant="secondary" onClick={() => act(() => outreachApi.pause(s._id), 'Sequence paused.')}><Pause aria-hidden="true" className="h-4 w-4" />Pause</Button> : <Button size="sm" onClick={() => act(() => outreachApi.start(s._id), 'Sequence started.')}><Play aria-hidden="true" className="h-4 w-4" />Start</Button>}
                    <Button size="sm" variant="secondary" onClick={() => setEnrollFor(s._id)}>Add leads</Button>
                    <Button size="sm" variant="ghost" onClick={() => setShown(shown === s._id ? null : s._id)} aria-expanded={shown === s._id}>Stats</Button>
                  </div>
                </div>
                {shown === s._id && <Stats id={s._id} />}
              </li>
            ))}
          </Reveal>
        )}
      </Loadable>
      <SequenceDialog open={open} onClose={() => setOpen(false)} boxes={boxes} onSaved={load} />
      <EnrollDialog open={!!enrollFor} onClose={() => setEnrollFor(null)} contacts={null} sequences={seqs.filter((s) => s._id === enrollFor)} lists={lists} />
    </Section>
  )
}

export default function Outreach() {
  const [tab, setTab] = useState('sequences')
  const { data, load: reloadBoxes } = useLoad(listBoxes)
  return (
    <div className="h-full overflow-y-auto pb-12 page-container">
      <PageHeader title="Outreach" description="Personalised sequences with reply-first metrics. Open tracking is off by default." />
      <Tabs label="Outreach sections" value={tab} onChange={setTab} tabs={[['sequences', 'Sequences'], ['mailboxes', 'Mailboxes']]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'sequences' ? <SequencesPanel boxes={data?.mailboxes || []} /> : <MailboxesPanel onChanged={reloadBoxes} />}
      </div>
    </div>
  )
}
