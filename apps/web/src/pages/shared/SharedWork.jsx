import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Users } from 'lucide-react'
import clsx from 'clsx'
import { api } from '../../api'
import { useOrg } from '../../context/OrgContext'
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge, useToast } from '../../components/kit'

/** The "Shared" marker used on every row so shared work is never mistaken for your own. */
export function SharedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-semibold text-primary-800 ring-1 ring-inset ring-primary-500/20 dark:bg-primary-950/60 dark:text-primary-300">
      <Users aria-hidden="true" className="h-3 w-3" />
      Shared
    </span>
  )
}

const KINDS = {
  requests: { path: 'requests', key: 'requests', noun: 'requests', resource: 'request' },
  lists: { path: 'lists', key: 'lists', noun: 'lead lists', resource: 'list' },
}

const num = (n) => (Number(n) > 0 ? Number(n).toLocaleString() : '0')

function RequestRow({ item }) {
  return (
    <>
      <p className="min-w-0 truncate text-sm font-bold text-ink">{item.title || 'Untitled'}</p>
      <StatusBadge status={item.status === 'Active' ? 'running' : item.status} />
    </>
  )
}

function RequestDetail({ item }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
      <div><dt className="text-xs text-muted">Companies</dt><dd className="font-semibold tabular-nums text-ink">{num(item.companies_count)}</dd></div>
      <div><dt className="text-xs text-muted">Contacts</dt><dd className="font-semibold tabular-nums text-ink">{num(item.contacts_count)}</dd></div>
      <div><dt className="text-xs text-muted">ICP match</dt><dd className="font-semibold tabular-nums text-ink">{item.icp_match_score != null ? `${item.icp_match_score}%` : '-'}</dd></div>
      <div><dt className="text-xs text-muted">Updated</dt><dd className="text-ink">{item.updated_at || item.date || '-'}</dd></div>
      {(item.description || item.business_type) && <p className="col-span-full break-words text-sm text-muted">{item.description || item.business_type}</p>}
    </dl>
  )
}

function ListDetail({ orgId, item }) {
  const [state, setState] = useState({ status: 'loading', leads: [] })
  const load = useCallback(() => {
    setState({ status: 'loading', leads: [] })
    api.get(`/orgs/${orgId}/shared/lists/${item.id || item._id}`)
      .then((r) => setState({ status: 'ready', leads: r?.leads || [] }))
      .catch(() => setState({ status: 'error', leads: [] }))
  }, [orgId, item])
  useEffect(load, [load])
  if (state.status === 'loading') return <div role="status" aria-label="Loading leads" className="space-y-2"><Skeleton className="h-8" /><Skeleton className="h-8" /></div>
  if (state.status === 'error') return <p className="text-sm text-muted">Could not load this list. <button type="button" onClick={load} className="font-semibold underline">Try again</button></p>
  if (state.leads.length === 0) return <p className="text-sm text-muted">This list has no leads yet.</p>
  return (
    <ul aria-label={`Leads in ${item.name}`} className="divide-y divide-line text-sm">
      {state.leads.map((l) => (
        <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
          <span className="min-w-0 truncate text-ink">{l.title || l.url}</span>
          <span className="text-xs text-muted">{l.email || 'no email'}{l.match_score != null ? ` · ${Math.round(l.match_score)}% match` : ''}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Requests or lead lists that teammates shared into the active organization. Read-only: you can look but not edit.
 * Whoever shared an item (or an admin) can stop sharing it. Renders nothing in the personal workspace.
 */
export default function SharedWork({ kind, excludeIds = [] }) {
  const cfg = KINDS[kind]
  const { activeOrg, can } = useOrg()
  const toast = useToast()
  const orgId = activeOrg?.id
  const [state, setState] = useState({ status: 'loading', items: [] })
  const [openId, setOpenId] = useState(null)
  const [removing, setRemoving] = useState(null)

  const load = useCallback(() => {
    if (!orgId) return
    setState((s) => ({ ...s, status: 'loading' }))
    api.get(`/orgs/${orgId}/shared/${cfg.path}`)
      .then((r) => setState({ status: 'ready', items: r?.[cfg.key] || [] }))
      .catch(() => setState({ status: 'error', items: [] }))
  }, [orgId, cfg])
  useEffect(load, [load])

  if (!orgId) return null

  const idOf = (i) => i.id || i._id
  const items = state.items.filter((i) => !excludeIds.includes(idOf(i)))

  const stop = async (item) => {
    setRemoving(idOf(item))
    try {
      await api.delete(`/orgs/${orgId}/shares/${cfg.resource}/${idOf(item)}`)
      toast.push({ type: 'success', message: 'Stopped sharing.' })
      load()
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not stop sharing.' })
    } finally {
      setRemoving(null)
    }
  }

  return (
    <section aria-labelledby={`shared-${kind}-title`} className="card mt-6 ring-1 ring-primary-500/5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <h2 id={`shared-${kind}-title`} className="flex items-center gap-2 text-base font-bold tracking-tight text-ink">
          <Users aria-hidden="true" className="h-4 w-4 text-primary-600" />
          Shared with {activeOrg.name}
        </h2>
        <p className="text-xs text-muted">Read-only. Shared by teammates in this organization.</p>
      </div>
      {state.status === 'loading' && (
        <div role="status" aria-label={`Loading shared ${cfg.noun}`} className="space-y-2 p-4"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
      )}
      {state.status === 'error' && <ErrorState title={`Could not load shared ${cfg.noun}`} message="Check your connection and try again." onRetry={load} />}
      {state.status === 'ready' && items.length === 0 && (
        <EmptyState icon={Users} title={`No shared ${cfg.noun} yet`} description={`${cfg.noun[0].toUpperCase()}${cfg.noun.slice(1)} a teammate shares with ${activeOrg.name} appear here.`} className="py-8" />
      )}
      {state.status === 'ready' && items.length > 0 && (
        <ul>
          {items.map((item, i) => {
            const id = idOf(item)
            const open = openId === id
            return (
              <li key={id} className={clsx(i > 0 && 'border-t border-line')}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`shared-${kind}-${id}`}
                    aria-label={`${open ? 'Hide' : 'Show'} details for ${item.title || item.name || 'Untitled'}`}
                    onClick={() => setOpenId(open ? null : id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    {open ? <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" /> : <ChevronRight aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />}
                    {kind === 'requests' ? <RequestRow item={item} /> : (
                      <>
                        <span className="min-w-0 truncate text-sm font-bold text-ink">{item.name}</span>
                        <span className="text-xs text-muted tabular-nums">{(item.lead_ids || []).length} leads</span>
                      </>
                    )}
                  </button>
                  <SharedBadge />
                  {can('admin') && (
                    <Button size="sm" variant="ghost" loading={removing === id} onClick={() => stop(item)} aria-label={`Stop sharing ${item.title || item.name}`}>
                      Stop sharing
                    </Button>
                  )}
                </div>
                {open && (
                  <div id={`shared-${kind}-${id}`} className="border-t border-line bg-head/40 px-4 py-3">
                    {kind === 'requests' ? <RequestDetail item={item} /> : <ListDetail orgId={orgId} item={item} />}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
