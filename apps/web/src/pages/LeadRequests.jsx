import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { Search, Copy, Trash2, ChevronLeft, ChevronRight, ArrowRight, Loader2, FileEdit, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useLeads } from '../context/LeadContext'
import { EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge, useToast } from '../components/kit'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import { useFlip } from '../components/motion/useFlip'
import { GlowingEffect } from '@/components/ui/glowing-effect'
import ConfirmDialog from './requests/ConfirmDialog'
import SharedWork from './shared/SharedWork'

const ITEMS_PER_PAGE = 10
const SORTS = ['Last updated', 'Name', 'Status']

// The filters offered in the stat strip and the select. "Running" covers both Active and Pending.
const FILTERS = [
  { value: 'Running', label: 'Running', statuses: ['Active', 'Pending'], Icon: Loader2, tile: 'from-primary-500 to-accent-500' },
  { value: 'Draft', label: 'Draft', statuses: ['Draft'], Icon: FileEdit, tile: 'from-slate-500 to-slate-700' },
  { value: 'Failed', label: 'Failed', statuses: ['Failed'], Icon: AlertTriangle, tile: 'from-red-500 to-rose-700' },
  { value: 'Completed', label: 'Completed', statuses: ['Completed'], Icon: CheckCircle2, tile: 'from-emerald-500 to-teal-700' },
]

// Rows: name | status | companies | contacts | ICP match | updated | actions (from lg; below that each row is a card)
const GRID = 'lg:grid lg:grid-cols-[minmax(0,1fr)_7.5rem_5.5rem_5.5rem_5rem_6.5rem_6.5rem] lg:items-center lg:gap-3'

const ICON_BUTTON =
  'inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-head hover:text-ink lg:h-8 lg:w-8 disabled:opacity-40'

const num = (n) => (Number(n) > 0 ? Number(n).toLocaleString() : '—')

/** Maps the API status to what the badge shows. Active means the pipeline is running. */
function badgeStatus(status) {
  return status === 'Active' ? 'running' : status
}

/** The one-line explanation shown under a request's title. */
function describe(req) {
  if (req.status === 'Failed' && req.failure_reason) return { text: req.failure_reason, tone: 'bad' }
  if (req.status === 'Active') return { text: 'Running now. Results appear when it finishes.', tone: 'info' }
  if (req.status === 'Completed' && !(Number(req.companies_count) > 0)) return { text: 'No companies matched this search.', tone: 'warn' }
  return { text: req.description || req.business_type || '', tone: 'muted' }
}

function filterKey(filter) {
  // The dashboard links here with an API status; fold Active and Pending into the Running filter.
  return filter === 'Active' || filter === 'Pending' ? 'Running' : filter
}

function Tile({ label, value, pressed, onClick, Icon, tile }) {
  return (
    <div data-reveal className="relative rounded-2xl">
      <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
      <button
        type="button"
        aria-pressed={pressed}
        onClick={onClick}
        className={clsx(
          'relative flex min-h-[4.5rem] w-full items-center gap-3 rounded-2xl border bg-surface/85 px-4 py-3 text-left shadow-soft backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift',
          pressed ? 'border-primary-500 ring-2 ring-primary-500/30 dark:border-primary-400' : 'border-white/70 dark:border-line/60',
        )}
      >
        <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ring-1 ring-white/30', tile)}>
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
          <span className="block text-3xl font-black leading-tight tracking-tight tabular-nums text-ink">{value}</span>
        </span>
      </button>
    </div>
  )
}

function ScorePill({ score }) {
  if (score == null) return <span>—</span>
  const tone = score >= 70 ? 'from-emerald-600 to-teal-700' : score >= 40 ? 'from-amber-700 to-orange-800' : 'from-slate-600 to-slate-800'
  return <span className={clsx('inline-flex items-center rounded-full bg-gradient-to-r px-2.5 py-0.5 text-xs font-bold tabular-nums text-white shadow-sm ring-1 ring-white/20', tone)}>{score}%</span>
}

function ListSkeleton() {
  return (
    <div role="status" aria-label="Loading requests" className="divide-y divide-line">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-6 w-20" />
        </div>
      ))}
    </div>
  )
}

export default function LeadRequests() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { requests, refreshRequests, deleteRequest, globalSearchQuery, setGlobalSearchQuery } = useLeads()
  const [sortBy, setSortBy] = useState(SORTS[0])
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('All')
  const [loadState, setLoadState] = useState('loading') // loading | ready | error
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const pageRef = useRef(null)

  // The dashboard can link here with a status filter in the router state.
  useEffect(() => {
    if (location.state?.filter) {
      setStatusFilter(filterKey(location.state.filter))
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, location.pathname, navigate])

  // refreshRequests resolves to the list on success and to undefined when the fetch failed.
  const load = useCallback(async () => {
    setLoadState('loading')
    const result = await refreshRequests()
    setLoadState(result === undefined ? 'error' : 'ready')
  }, [refreshRequests])

  useEffect(() => {
    load()
  }, [load])

  const list = useMemo(() => requests || [], [requests])

  const counts = useMemo(() => {
    const out = {}
    FILTERS.forEach((f) => {
      out[f.value] = list.filter((r) => f.statuses.includes(r.status)).length
    })
    return out
  }, [list])

  const filtered = useMemo(() => {
    let out = [...list]
    const active = FILTERS.find((f) => f.value === statusFilter)
    if (active) out = out.filter((r) => active.statuses.includes(r.status))
    const q = (globalSearchQuery || '').trim().toLowerCase()
    if (q) {
      out = out.filter((r) => r.title?.toLowerCase().includes(q) || r.business_type?.toLowerCase().includes(q) || r.goal?.toLowerCase().includes(q))
    }
    if (sortBy === 'Last updated') {
      out.sort((a, b) => (Date.parse(b.updated_at || b.date) || 0) - (Date.parse(a.updated_at || a.date) || 0))
    } else if (sortBy === 'Name') {
      out.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (sortBy === 'Status') {
      out.sort((a, b) => (a.status || '').localeCompare(b.status || ''))
    }
    return out
  }, [list, globalSearchQuery, sortBy, statusFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE))
  const currentPage = Math.min(page, totalPages)
  const visible = filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)

  const capture = useFlip(pageRef, [visible.map((r) => r.id).join()])
  useStaggerIn(pageRef, { selector: '[data-reveal], [data-row]', dependencies: [loadState === 'ready'] })

  const open = (req) => {
    const status = (req.status || 'Pending').toLowerCase()
    if (status === 'draft' || status === 'pending') {
      // Direct-companies requests use a dedicated workflow, not the ICP intake wizard.
      if (req.request_type === 'direct_companies') navigate(status === 'draft' ? `/request/${req.id}/companies` : `/request/${req.id}`)
      else navigate(`/request/${req.id}/intake`)
    } else {
      navigate(`/request/${req.id}`)
    }
  }

  const copyId = async (req) => {
    try {
      await navigator.clipboard.writeText(req.id)
      toast.push({ type: 'success', message: 'Request ID copied.' })
    } catch {
      toast.push({ type: 'error', message: 'Could not copy the request ID.' })
    }
  }

  const confirmDelete = async () => {
    if (!toDelete || deleting) return
    setDeleting(true)
    capture()
    try {
      await deleteRequest(toDelete.id)
      toast.push({ type: 'success', message: `Deleted "${toDelete.title || 'Untitled'}".` })
    } catch (err) {
      toast.push({ type: 'error', message: err?.isNetworkError ? "Couldn't reach Quarry, so the request was not deleted." : err?.message || 'Could not delete the request.' })
    } finally {
      setDeleting(false)
      setToDelete(null)
    }
  }

  const clearFilters = () => {
    capture()
    setStatusFilter('All')
    setGlobalSearchQuery('')
    setPage(1)
  }

  const toggleFilter = (value) => {
    capture()
    setStatusFilter((prev) => (prev === value ? 'All' : value))
    setPage(1)
  }

  const showSkeleton = loadState === 'loading' && list.length === 0
  const showError = loadState === 'error' && list.length === 0

  return (
    <div ref={pageRef} id="lead-requests-page" className="page-container h-full overflow-y-auto pb-12">
      <PageHeader
        title="Requests"
        description="Every lead search you have started, and how each one is doing."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {FILTERS.map((f) => (
          <Tile key={f.value} Icon={f.Icon} tile={f.tile} label={f.label} value={counts[f.value]} pressed={statusFilter === f.value} onClick={() => toggleFilter(f.value)} />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[14rem] flex-1 sm:max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="lead-search"
            type="search"
            aria-label="Search requests"
            placeholder="Search requests"
            value={globalSearchQuery || ''}
            onChange={(e) => {
              capture()
              setGlobalSearchQuery(e.target.value)
              setPage(1)
            }}
            className="input pl-9"
          />
        </div>
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => {
            capture()
            setStatusFilter(e.target.value)
            setPage(1)
          }}
          className="input w-auto"
        >
          <option value="All">All statuses</option>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort by" value={sortBy} onChange={(e) => {
            capture()
            setSortBy(e.target.value)
          }} className="input w-auto">
          {SORTS.map((s) => (
            <option key={s} value={s}>
              Sort: {s}
            </option>
          ))}
        </select>
      </div>

      {loadState === 'error' && list.length > 0 && (
        <p role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          Couldn&apos;t refresh the list, so this may be out of date.
          <button type="button" onClick={load} className="font-semibold underline">
            Try again
          </button>
        </p>
      )}

      <div className="card ring-1 ring-primary-500/5">
        {showSkeleton ? (
          <ListSkeleton />
        ) : showError ? (
          <ErrorState title="Couldn't load your requests" message="Check your connection and try again." onRetry={load} />
        ) : list.length === 0 ? (
          <EmptyState title="No requests yet" description="Describe your product once and Quarry finds matching companies and the people to contact." action={{ label: 'New request', onClick: () => navigate('/new-request') }} />
        ) : filtered.length === 0 ? (
          <EmptyState title="No requests match" description="Nothing fits the current search and filter." action={{ label: 'Clear filters', onClick: clearFilters }} />
        ) : (
          <>
            <div aria-hidden="true" className={clsx(GRID, 'hidden border-b border-line bg-gradient-to-r from-head to-primary-50/60 px-4 py-2.5 text-xs dark:to-primary-950/30 font-semibold uppercase tracking-wide text-muted')}>
              <span>Request</span>
              <span>Status</span>
              <span className="text-right">Companies</span>
              <span className="text-right">Contacts</span>
              <span className="text-right">ICP match</span>
              <span>Updated</span>
              <span />
            </div>
            <ul>
              {visible.map((req, i) => {
                const note = describe(req)
                const title = req.title || 'Untitled'
                return (
                  <li key={req.id} data-flip-id={req.id} data-row className={clsx(GRID, 'flex flex-col gap-2 px-4 py-3 transition-[background-color,box-shadow] duration-200 hover:bg-primary-50/60 hover:shadow-soft dark:hover:bg-primary-950/30 lg:py-3', i > 0 && 'border-t border-line')}>
                    <div className="min-w-0">
                      <button type="button" title={title} onClick={() => open(req)} className="block w-full min-w-0 truncate rounded text-left text-sm font-bold tracking-tight text-ink hover:text-primary-700 dark:hover:text-primary-300">
                        {title}
                      </button>
                      {note.text && (
                        <p
                          title={note.text}
                          className={clsx('mt-0.5 text-xs lg:line-clamp-2', note.tone === 'bad' && 'font-medium text-bad', note.tone === 'warn' && 'text-warn', note.tone !== 'bad' && note.tone !== 'warn' && 'text-muted', 'break-words')}
                        >
                          {note.text}
                        </p>
                      )}
                    </div>
                    <div>
                      <StatusBadge status={badgeStatus(req.status)} />
                    </div>
                    <p className="text-xs text-muted tabular-nums lg:hidden">
                      {[
                        Number(req.companies_count) > 0 && `${num(req.companies_count)} companies`,
                        Number(req.contacts_count) > 0 && `${num(req.contacts_count)} contacts`,
                        req.icp_match_score != null && `${req.icp_match_score}% ICP match`,
                        req.updated_at || req.date,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <span className="hidden text-right text-sm tabular-nums text-ink lg:block">{num(req.companies_count)}</span>
                    <span className="hidden text-right text-sm tabular-nums text-ink lg:block">{num(req.contacts_count)}</span>
                    <span className="hidden text-right text-sm text-ink lg:block">
                      <ScorePill score={req.icp_match_score} />
                    </span>
                    <span className="hidden text-xs text-muted lg:block">{req.updated_at || req.date || '—'}</span>
                    <div className="flex items-center gap-1 lg:justify-end">
                      <button type="button" aria-label={`Open ${title}`} title="Open" onClick={() => open(req)} className={ICON_BUTTON}>
                        <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Copy ID of ${title}`} title="Copy ID" onClick={() => copyId(req)} className={ICON_BUTTON}>
                        <Copy aria-hidden="true" className="h-4 w-4" />
                      </button>
                      <button type="button" aria-label={`Delete ${title}`} title="Delete" onClick={() => setToDelete(req)} className={clsx(ICON_BUTTON, 'hover:bg-bad-soft hover:text-bad')}>
                        <Trash2 aria-hidden="true" className="h-4 w-4" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {totalPages > 1 && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
                <span className="text-xs tabular-nums text-muted">
                  {(currentPage - 1) * ITEMS_PER_PAGE + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" aria-label="Previous page" disabled={currentPage === 1} onClick={() => {
                      capture()
                      setPage(currentPage - 1)
                    }} className={ICON_BUTTON}>
                    <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  </button>
                  <span className="px-2 text-xs tabular-nums text-muted">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button type="button" aria-label="Next page" disabled={currentPage === totalPages} onClick={() => {
                      capture()
                      setPage(currentPage + 1)
                    }} className={ICON_BUTTON}>
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <SharedWork kind="requests" excludeIds={list.map((r) => r.id)} />

      <ConfirmDialog
        open={!!toDelete}
        destructive
        loading={deleting}
        title="Delete request?"
        description={toDelete ? `"${toDelete.title || 'Untitled'}" and everything found for it will be permanently deleted. This cannot be undone.` : ''}
        confirmLabel="Delete request"
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </div>
  )
}
