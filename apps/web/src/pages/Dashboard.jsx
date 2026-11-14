import { useCallback, useEffect, useState } from 'react'
import UsageCard from '../components/UsageCard'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileSearch } from 'lucide-react'
import { useLeads } from '../context/LeadContext'
import { Button, EmptyState, ErrorState, Skeleton, StatusBadge } from '../components/kit'
import StatTile from './dashboard/StatTile'

const RECENT_COUNT = 5

const isLive = (r) => ['pending', 'active'].includes(String(r?.status || '').toLowerCase())
const badgeStatus = (status) => (String(status).toLowerCase() === 'active' ? 'running' : status)
const requestId = (r) => r.id || r._id

/** Where a request opens: drafts go back to their wizard, everything else to its details. */
function openPath(r) {
  const draft = String(r.status).toLowerCase() === 'draft'
  if (r.request_type === 'direct_companies') return draft ? `/request/${requestId(r)}/companies` : `/request/${requestId(r)}`
  return draft ? `/request/${requestId(r)}/intake` : `/request/${requestId(r)}`
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-label="Loading your overview" className="space-y-6">
      <Skeleton className="h-44" />
      <Skeleton className="h-32" />
      <div className="grid gap-6 xl:grid-cols-2">
        <Skeleton className="h-80" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-40" />
    </div>
  )
}

export default function Dashboard() {
  const { stats, requests, refreshRequests } = useLeads()
  const navigate = useNavigate()
  // loading until the first refresh answers; error only when it failed and there is nothing to show.
  const [phase, setPhase] = useState(() => (requests || []).length > 0 ? 'ready' : 'loading')
  const [refreshFailed, setRefreshFailed] = useState(false)
  const list = requests || []

  const load = useCallback(async () => {
    setPhase((p) => (p === 'error' ? 'loading' : p))
    setRefreshFailed(false)
    // refreshRequests resolves to the list on success and to undefined when the fetch failed.
    const result = await refreshRequests()
    if (result === undefined) {
      setRefreshFailed(true)
      setPhase((p) => (p === 'loading' ? 'error' : p))
    } else {
      setPhase('ready')
    }
  }, [refreshRequests])

  useEffect(() => {
    load()
  }, [load])

  const active = list.find(isLive) || null
  const recent = list.slice(0, RECENT_COUNT)
  const finished = (stats?.completed || 0) + (stats?.failed || 0)
  const successRate = finished > 0 ? Math.round(((stats?.completed || 0) / finished) * 100) : null
  const goFilter = (filter) => navigate('/lead-requests', { state: { filter } })
  const created = active?.created_at ? new Date(active.created_at) : null
  const createdLabel = created && !Number.isNaN(created.getTime())
    ? created.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    : null

  return (
    <div id="dashboard-page" className="h-full overflow-y-auto pb-12 page-container">
      <header id="dashboard-header" className="mb-8">
        <p className="dashboard-kicker mb-2 text-xs font-medium text-muted">
          Workspace
        </p>
        <h1 className="break-words text-3xl font-medium leading-tight text-ink sm:text-4xl">
          Dashboard
        </h1>
        <p className="mt-2 text-sm leading-6 text-muted">Your company searches, results, and contact research</p>
      </header>

      {phase === 'loading' && <DashboardSkeleton />}

      {phase === 'error' && (
        <div className="card">
          <ErrorState title="Could not load your overview" message="Check your connection and try again" onRetry={load} />
        </div>
      )}

      {phase === 'ready' && (
        <>
          {refreshFailed && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-warn-soft p-3 text-sm text-warn">
              <span>Could not refresh; showing the last available figures</span>
              <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
            </div>
          )}

          <section id="cta-card" aria-labelledby="cta-title" className="dashboard-cta card">
            <div className="min-w-0">
              <p className="dashboard-kicker mb-2 text-xs font-medium text-muted">Company research</p>
              <h2 id="cta-title" className="text-2xl font-medium leading-8 text-ink">Find companies that fit</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
                Describe your product to build a customer profile, find matching companies, and identify the people to contact
              </p>
              <ul className="dashboard-capabilities mt-4 text-xs text-muted">
                {['Customer profile', 'Decision makers', 'Match scoring'].map((label) => <li key={label}>{label}</li>)}
              </ul>
            </div>
            <button type="button" onClick={() => navigate('/new-request')} className="dashboard-primary">
              New request <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </section>

          <section aria-label="Request summary" className="dashboard-summary card">
            <StatTile id="summary-total" label="Total requests" value={stats?.totalLeads || 0} hint="All time" onClick={() => goFilter('All')} />
            <StatTile id="summary-pending" label="In progress" value={stats?.pending || 0} hint="Running or queued" onClick={() => goFilter('Active')} />
            <StatTile id="summary-completed" label="Completed" value={stats?.completed || 0} hint={successRate === null ? 'No finished runs yet' : `${successRate}% of finished runs`} onClick={() => goFilter('Completed')} />
            <StatTile id="summary-failed" label="Failed" value={stats?.failed || 0} hint={stats?.failed ? 'Review failed requests' : 'No failed requests'} onClick={() => goFilter('Failed')} />
          </section>

          <div id="workspace" className="dashboard-workspace">
            <section id="result-panel" aria-labelledby="pipeline-title" className="dashboard-panel card">
              <div className="mb-6">
                <h2 id="pipeline-title" className="text-base font-medium text-ink">Active pipeline</h2>
                <p className="mt-1 text-sm text-muted">The request currently running or queued</p>
              </div>
              {active ? (
                <div id="result-content" className="flex flex-1 flex-col gap-6">
                  <div className="dashboard-dossier">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusBadge status={badgeStatus(active.status)} />
                      <span className="request-reference font-mono text-xs" aria-label={`Request reference ${requestId(active)}`} title={String(requestId(active))}>
                        QR / {String(requestId(active)).slice(0, 8)}
                      </span>
                    </div>
                    <p className="dashboard-request-title" title={active.title}>{active.title || 'Untitled request'}</p>
                    <p className="mt-3 text-sm leading-6 text-muted">
                      {String(active.status).toLowerCase() === 'pending'
                        ? 'Waiting to start. This page updates when the request finishes.'
                        : 'Researching companies and enriching contact details. This page updates when the request finishes.'}
                    </p>
                  </div>
                  <div className="mt-auto flex flex-wrap items-center gap-4">
                    <Button variant="secondary" onClick={() => navigate(openPath(active))}>
                      Follow progress <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </Button>
                    {createdLabel && <time dateTime={created.toISOString()} className="text-xs tabular-nums text-muted">Created {createdLabel}</time>}
                  </div>
                </div>
              ) : (
                <div id="result-empty">
                  <EmptyState
                    icon={FileSearch}
                    title="No active pipeline"
                    description="Start a request to research companies and contacts"
                    action={{ label: 'New request', onClick: () => navigate('/new-request') }}
                  />
                </div>
              )}
            </section>

            <section aria-labelledby="recent-title" className="dashboard-panel card">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 id="recent-title" className="text-base font-medium text-ink">Recent requests</h2>
                {list.length > 0 && (
                  <button type="button" onClick={() => navigate('/lead-requests')} className="dashboard-text-button">
                    View all <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
              {recent.length === 0 ? (
                <EmptyState title="No requests yet" description="Your latest requests will appear here" action={{ label: 'New request', onClick: () => navigate('/new-request') }} />
              ) : (
                <ul className="dashboard-recent-list">
                  {recent.map((r) => (
                    <li key={requestId(r)}>
                      <button type="button" onClick={() => navigate(openPath(r))} className="dashboard-request-row">
                        <span className="min-w-0 truncate text-sm text-ink" title={r.title}>{r.title || 'Untitled request'}</span>
                        <StatusBadge status={badgeStatus(r.status)} className="shrink-0" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <div className="dashboard-usage"><UsageCard dashboard /></div>
          </div>
        </>
      )}
    </div>
  )
}
