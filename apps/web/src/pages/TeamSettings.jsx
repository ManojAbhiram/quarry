import { useCallback, useEffect, useRef, useState } from 'react'
import { Building2, Copy, Mail, Share2, UserPlus, Users } from 'lucide-react'
import { api } from '../api'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { Button, EmptyState, ErrorState, Field, PageHeader, Skeleton, useToast } from '../components/kit'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import ConfirmDialog from './requests/ConfirmDialog'
import Section from './profile/Section'

const ROLES = ['owner', 'admin', 'member', 'viewer']
const INVITE_ROLES = ['admin', 'member', 'viewer']
const ROLE_HELP = {
  owner: 'Full control, including billing and ownership.',
  admin: 'Manage members, invites, billing and integrations.',
  member: 'Create requests and share work with the team.',
  viewer: 'Read what the team shares.',
}
const SELECT = 'input h-10 py-0 text-sm'

function RoleBadge({ role }) {
  return <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-semibold capitalize text-primary-800 ring-1 ring-inset ring-primary-200/70 dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-900/60">{role}</span>
}

function CreateOrg({ onCreated }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return setError('Give the organization a name.')
    setBusy(true)
    setError('')
    try {
      const org = await api.post('/orgs', { name: name.trim() })
      setName('')
      onCreated(org)
    } catch (err) {
      setError(err.message || 'Could not create the organization.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
      <Field id="new-org-name" label="Organization name" className="min-w-[14rem] flex-1" value={name} maxLength={100} placeholder="e.g. Acme Sales" error={error} disabled={busy} onChange={(e) => { setName(e.target.value); setError('') }} />
      <Button type="submit" loading={busy}>Create organization</Button>
    </form>
  )
}

function Members({ org, me, canManage, onLeft, refreshOrgs }) {
  const toast = useToast()
  const [state, setState] = useState({ status: 'loading', members: [], error: '' })
  const [confirm, setConfirm] = useState(null)
  const [working, setWorking] = useState(false)

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    api.get(`/orgs/${org.id}/members`)
      .then((r) => setState({ status: 'ready', members: r?.members || [], error: '' }))
      .catch((e) => setState({ status: 'error', members: [], error: e.message }))
  }, [org.id])
  useEffect(load, [load])

  const changeRole = async (m, role) => {
    try {
      await api.put(`/orgs/${org.id}/members/${m.user_id}`, { role })
      toast.push({ type: 'success', message: `${m.name || m.email} is now ${role}.` })
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not change the role.' })
      load()
    }
  }

  const remove = async () => {
    setWorking(true)
    try {
      await api.delete(`/orgs/${org.id}/members/${confirm.user_id}`)
      toast.push({ type: 'success', message: confirm.user_id === me ? 'You left the organization.' : 'Member removed.' })
      const self = confirm.user_id === me
      setConfirm(null)
      if (self) {
        await refreshOrgs()
        onLeft()
      } else load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not remove the member.' })
      setConfirm(null)
    } finally {
      setWorking(false)
    }
  }

  if (state.status === 'loading') return <div aria-label="Loading members" role="status"><Skeleton className="h-12 w-full" /><Skeleton className="mt-2 h-12 w-full" /></div>
  if (state.status === 'error') return <ErrorState title="Could not load members" message={state.error} onRetry={load} className="py-6" />

  return (
    <>
      <ul className="divide-y divide-line" aria-label="Members">
        {state.members.map((m) => (
          <li key={m.user_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-ink">{m.name || m.email}{m.user_id === me && <span className="ml-2 text-xs font-medium text-muted">(you)</span>}</p>
              <p className="truncate text-xs text-muted">{m.email}</p>
            </div>
            <div className="flex items-center gap-2">
              {canManage ? (
                <select aria-label={`Role for ${m.name || m.email}`} className={SELECT} value={m.role} onChange={(e) => changeRole(m, e.target.value)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              ) : <RoleBadge role={m.role} />}
              {(canManage || m.user_id === me) && (
                <Button size="sm" variant="ghost" onClick={() => setConfirm(m)} aria-label={m.user_id === me ? 'Leave organization' : `Remove ${m.name || m.email}`}>
                  {m.user_id === me ? 'Leave' : 'Remove'}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.user_id === me ? 'Leave this organization?' : 'Remove this member?'}
        description={confirm?.user_id === me ? 'You will lose access to everything shared with the team.' : `${confirm?.name || confirm?.email} will lose access to the team's shared work.`}
        confirmLabel={confirm?.user_id === me ? 'Leave' : 'Remove'}
        destructive
        loading={working}
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </>
  )
}

function Invites({ org }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('member')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [link, setLink] = useState(null)
  const [pending, setPending] = useState({ status: 'loading', items: [] })

  const load = useCallback(() => {
    api.get(`/orgs/${org.id}/invites`)
      .then((r) => setPending({ status: 'ready', items: r?.invites || [] }))
      .catch(() => setPending({ status: 'error', items: [] }))
  }, [org.id])
  useEffect(load, [load])

  const submit = async (e) => {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.')
    setBusy(true)
    setError('')
    try {
      const res = await api.post(`/orgs/${org.id}/invites`, { email: email.trim(), role })
      setLink(res)
      setEmail('')
      toast.push({ type: 'success', message: res.emailed ? 'Invitation emailed.' : 'Invite created. Copy the link to share it.' })
      load()
    } catch (err) {
      setError(err.message || 'Could not send the invite.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link.invite_url)
      toast.push({ type: 'success', message: 'Link copied.' })
    } catch {
      toast.push({ type: 'error', message: 'Could not copy. Select the link and copy it manually.' })
    }
  }

  const revoke = async (id) => {
    try {
      await api.delete(`/orgs/${org.id}/invites/${id}`)
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not revoke the invite.' })
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} noValidate className="flex flex-wrap items-end gap-3">
        <Field id="invite-email" label="Email" type="email" className="min-w-[14rem] flex-1" value={email} placeholder="teammate@company.com" error={error} disabled={busy} onChange={(e) => { setEmail(e.target.value); setError('') }} />
        <div>
          <label htmlFor="invite-role" className="label">Role</label>
          <select id="invite-role" className={SELECT} value={role} onChange={(e) => setRole(e.target.value)} aria-describedby="invite-role-help">
            {INVITE_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <Button type="submit" loading={busy}><Mail aria-hidden="true" className="h-4 w-4" /> Send invite</Button>
      </form>
      <p id="invite-role-help" className="text-xs text-muted">{ROLE_HELP[role]}</p>
      {link && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-xl bg-ok-soft p-3 text-sm">
          <code className="min-w-0 flex-1 break-all text-xs text-ink">{link.invite_url}</code>
          <Button size="sm" variant="secondary" onClick={copy}><Copy aria-hidden="true" className="h-4 w-4" /> Copy link</Button>
        </div>
      )}
      {pending.status === 'ready' && pending.items.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Pending invites">
          {pending.items.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-ink">{i.email} <span className="text-xs text-muted">as {i.role}</span></span>
              <Button size="sm" variant="ghost" onClick={() => revoke(i.id)} aria-label={`Revoke invite for ${i.email}`}>Revoke</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Sharing({ org, canShare }) {
  const toast = useToast()
  const [shared, setShared] = useState({ status: 'loading', lists: [], requests: [] })
  const [mine, setMine] = useState({ lists: [], requests: [] })
  const [pick, setPick] = useState('')

  const load = useCallback(() => {
    Promise.all([api.get(`/orgs/${org.id}/shared/lists`), api.get(`/orgs/${org.id}/shared/requests`)])
      .then(([l, r]) => setShared({ status: 'ready', lists: l?.lists || [], requests: r?.requests || [] }))
      .catch(() => setShared({ status: 'error', lists: [], requests: [] }))
  }, [org.id])
  useEffect(load, [load])

  useEffect(() => {
    if (!canShare) return
    Promise.all([api.get('/lists'), api.get('/requests')])
      .then(([l, r]) => setMine({ lists: l?.lists || [], requests: Array.isArray(r) ? r : [] }))
      .catch(() => {})
  }, [canShare])

  const share = async (e) => {
    e.preventDefault()
    if (!pick) return
    const [type, id] = pick.split(':')
    try {
      await api.post(`/orgs/${org.id}/shares`, { resource_type: type, resource_id: id })
      toast.push({ type: 'success', message: 'Shared with the team.' })
      setPick('')
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not share.' })
    }
  }

  const unshare = async (type, id) => {
    try {
      await api.delete(`/orgs/${org.id}/shares/${type}/${id}`)
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not stop sharing.' })
    }
  }

  const rows = [
    ...shared.lists.map((l) => ({ type: 'list', id: l._id, title: l.name, meta: `${(l.lead_ids || []).length} leads` })),
    ...shared.requests.map((r) => ({ type: 'request', id: r.id, title: r.title || 'Untitled request', meta: r.status })),
  ]

  return (
    <div className="space-y-5">
      {canShare && (
        <form onSubmit={share} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="share-pick" className="label">Share one of your lists or requests</label>
            <select id="share-pick" className={`${SELECT} w-full`} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {mine.lists.length > 0 && <optgroup label="Lead lists">{mine.lists.map((l) => <option key={l._id} value={`list:${l._id}`}>{l.name}</option>)}</optgroup>}
              {mine.requests.length > 0 && <optgroup label="Requests">{mine.requests.map((r) => <option key={r.id} value={`request:${r.id}`}>{r.title || 'Untitled request'}</option>)}</optgroup>}
            </select>
          </div>
          <Button type="submit" disabled={!pick}><Share2 aria-hidden="true" className="h-4 w-4" /> Share</Button>
        </form>
      )}
      {shared.status === 'loading' && <Skeleton className="h-16 w-full" />}
      {shared.status === 'error' && <ErrorState title="Could not load shared work" onRetry={load} className="py-6" />}
      {shared.status === 'ready' && rows.length === 0 && <EmptyState icon={Share2} title="Nothing shared yet" description="Lists and requests you share show up here for everyone on the team." className="py-8" />}
      {shared.status === 'ready' && rows.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Shared with this team">
          {rows.map((r) => (
            <li key={`${r.type}:${r.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate font-medium text-ink">{r.title} <span className="text-xs font-normal text-muted">{r.type} · {r.meta}</span></span>
              {canShare && <Button size="sm" variant="ghost" onClick={() => unshare(r.type, r.id)} aria-label={`Stop sharing ${r.title}`}>Stop sharing</Button>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function TeamSettings() {
  const { user } = useAuth()
  const { orgs, activeOrg, role, can, switchOrg, refresh } = useOrg()
  const toast = useToast()
  const pageRef = useRef(null)
  useStaggerIn(pageRef)
  const [name, setName] = useState('')
  const [renaming, setRenaming] = useState(false)

  useEffect(() => setName(activeOrg?.name || ''), [activeOrg])

  const rename = async (e) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === activeOrg.name) return
    setRenaming(true)
    try {
      await api.put(`/orgs/${activeOrg.id}`, { name: name.trim() })
      await refresh()
      toast.push({ type: 'success', message: 'Organization renamed.' })
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not rename.' })
    } finally {
      setRenaming(false)
    }
  }

  const onCreated = async (org) => {
    await refresh()
    toast.push({ type: 'success', message: `${org.name} created.` })
    switchOrg(org.id)
  }

  const me = user?.id || user?._id

  return (
    <div id="team-page" ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <div className="mx-auto max-w-4xl">
        <div data-reveal>
          <PageHeader title="Team settings" description={activeOrg ? `Manage ${activeOrg.name}: members, invites and shared work.` : 'Work together: create an organization to share requests and lead lists.'} />
        </div>

        {!activeOrg && (
          <div className="space-y-6">
            <Section id="create-org" title="Create an organization" description="You are in your personal workspace. An organization lets teammates share requests and lead lists." icon={Building2}>
              <CreateOrg onCreated={onCreated} />
            </Section>
            {orgs.length > 0 && (
              <Section id="your-orgs" title="Your organizations" description="Switch into one to manage it." icon={Users}>
                <ul className="divide-y divide-line">
                  {orgs.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="min-w-0 truncate text-sm font-semibold text-ink">{o.name} <RoleBadge role={o.role} /></span>
                      <Button size="sm" variant="secondary" onClick={() => switchOrg(o.id)}>Open</Button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </div>
        )}

        {activeOrg && (
          <div className="space-y-6">
            <Section id="org-details" title="Organization" description={`You are ${/^[aeiou]/i.test(role) ? 'an' : 'a'} ${role}.`} icon={Building2}>
              <form onSubmit={rename} noValidate className="flex flex-wrap items-end gap-3">
                <Field id="org-name" label="Name" className="min-w-[14rem] flex-1" value={name} maxLength={100} disabled={!can('admin') || renaming} onChange={(e) => setName(e.target.value)} hint={can('admin') ? undefined : 'Only admins can rename the organization.'} />
                {can('admin') && <Button type="submit" loading={renaming} disabled={!name.trim() || name.trim() === activeOrg.name}>Save</Button>}
              </form>
            </Section>
            <Section id="members" title="Members" description="Everyone with access to this organization." icon={Users}>
              <Members org={activeOrg} me={String(me)} canManage={can('admin')} refreshOrgs={refresh} onLeft={() => switchOrg('')} />
            </Section>
            {can('admin') && (
              <Section id="invites" title="Invite people" description="They get a link by email. Invites expire after 7 days." icon={UserPlus}>
                <Invites org={activeOrg} />
              </Section>
            )}
            <Section id="sharing" title="Shared with this team" description="Teammates can view shared lists and requests. Your originals stay yours." icon={Share2}>
              <Sharing org={activeOrg} canShare={can('member')} />
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
