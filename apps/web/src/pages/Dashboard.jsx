import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UsageCard from '../components/UsageCard'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CheckCircle2, Clock, FileText, FileSearch, Sparkles, Target, TrendingUp, Users, XCircle, Zap } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useLeads } from '../context/LeadContext'
import { BentoGrid } from '../components/ui/bento-grid'
import { GlowingEffect } from '../components/ui/glowing-effect'
import { Spotlight } from '../components/ui/spotlight'
import { useStaggerIn } from '../components/motion/useStaggerIn'
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
    <div role="status" aria-label="Loading your overview" className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
      <Skeleton className="h-72 md:col-span-2 lg:row-span-2" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
      <Skeleton className="h-36" />
      <Skeleton className="h-64 md:col-span-2" />
      <Skeleton className="h-64 md:col-span-2" />
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { stats, requests, refreshRequests } = useLeads()
  const navigate = useNavigate()
  const pageRef = useRef(null)
  const hadData = useRef((requests || []).length > 0)
  // loading until the first refresh answers; error only when it failed and there is nothing to show.
  const [phase, setPhase] = useState(hadData.current ? 'ready' : 'loading')
  const [refreshFailed, setRefreshFailed] = useState(false)
  const list = useMemo(() => requests || [], [requests])

  useStaggerIn(pageRef, { dependencies: [phase] })

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

  const active = useMemo(() => list.find(isLive) || null, [list])
  const recent = list.slice(0, RECENT_COUNT)
  const finished = (stats?.completed || 0) + (stats?.failed || 0)
  const successRate = finished > 0 ? Math.round(((stats?.completed || 0) / finished) * 100) : null
  const goFilter = (filter) => navigate('/lead-requests', { state: { filter } })
  const name = user?.name || ''

  return (
    <div id="dashboard-page" ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <header id="dashboard-header" data-reveal className="mb-8">
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary-800 ring-1 ring-primary-200/70 dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-900/60">
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5" /> Overview
        </p>
        <h1 className="break-words text-3xl font-black tracking-tight text-ink sm:text-4xl">
          Welcome back{name && <>, <span className="text-gradient">{name}</span></>}
        </h1>
        <p className="mt-2 text-base text-muted">Here is where your lead generation stands today.</p>
      </header>

      {phase === 'loading' && <DashboardSkeleton />}

      {phase === 'error' && (
        <div className="card">
          <ErrorState title="Could not load your overview" message="Check your connection and try again." onRetry={load} />
        </div>
      )}

      {phase === 'ready' && (
        <>
          {refreshFailed && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-warn-soft p-3 text-sm text-warn">
              <span>Could not refresh. Showing the last figures we have.</span>
              <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
            </div>
          )}

          <BentoGrid className="mb-4 max-w-none gap-4 md:auto-rows-auto md:grid-cols-2 lg:grid-cols-4">
            {/* Hero: the one call to action */}
            <div data-reveal id="cta-card" className="md:col-span-2 lg:row-span-2">
              <div className="card relative flex h-full flex-col justify-between border-0 bg-gradient-to-br from-btn via-btn to-btn-hover p-7 text-white shadow-lift sm:p-8">
                <Spotlight className="-top-40 left-0 md:-top-20 md:left-40" fill="white" />
                <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accent-400/30 blur-3xl" />
                <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
                <GlowingEffect spread={50} glow disabled={false} proximity={80} inactiveZone={0.01} borderWidth={2} />
                <div className="relative z-10">
                  <p className="mb-5 flex items-center gap-3 text-xs font-bold uppercase tracking-widest text-white/90">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-sm">
                      <Zap aria-hidden="true" className="h-5 w-5" />
                    </span>
                    Lead generation
                  </p>
                  <h2 className="text-2xl font-black leading-tight tracking-tight sm:text-3xl">Ready to find your next customers?</h2>
                  <p className="mt-3 max-w-md text-sm leading-relaxed text-white/90">
                    Describe your product and Quarry builds an ideal customer profile, finds matching companies and the people to contact.
                  </p>
                  <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
                    {[
                      { Icon: Target, label: 'ICP builder' },
                      { Icon: Users, label: 'Decision makers' },
                      { Icon: TrendingUp, label: 'Match scoring' },
                    ].map(({ Icon, label }) => (
                      <li key={label} className="flex items-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold ring-1 ring-white/20">
                        <Icon aria-hidden="true" className="h-4 w-4 shrink-0" /> {label}
                      </li>
                    ))}
                  </ul>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/new-request')}
                  className="relative z-10 mt-7 inline-flex h-12 w-full items-center justify-center gap-2 self-start rounded-xl bg-white px-6 text-sm font-extrabold text-primary-900 shadow-xl shadow-black/20 transition-all duration-200 hover:shadow-2xl active:scale-95 sm:w-auto"
                >
                  Start lead generation <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>

            <StatTile id="summary-total" label="Total requests" value={stats?.totalLeads || 0} hint="All time" icon={FileText} gradient="from-primary-500 to-accent-600" onClick={() => goFilter('All')} />
            <StatTile id="summary-pending" label="In progress" value={stats?.pending || 0} hint="Running or waiting" icon={Clock} gradient="from-amber-400 to-orange-500" onClick={() => goFilter('Active')} />
            <StatTile id="summary-completed" label="Successful" value={stats?.completed || 0} hint={successRate === null ? 'No finished runs yet' : `${successRate}% of finished runs`} icon={CheckCircle2} gradient="from-emerald-500 to-teal-600" onClick={() => goFilter('Completed')} />
            <StatTile id="summary-failed" label="Failed" value={stats?.failed || 0} hint={stats?.failed ? 'Open to see why' : 'Nothing has failed'} icon={XCircle} gradient="from-rose-500 to-red-600" onClick={() => goFilter('Failed')} />
          </BentoGrid>

          <div id="workspace" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Active pipeline */}
            <section id="result-panel" data-reveal aria-labelledby="pipeline-title">
              <div className="card relative h-full p-6">
                <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
                <div className="relative z-10">
                  <div className="mb-5 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 text-white shadow-md ring-1 ring-white/30">
                      <FileSearch aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div>
                      <h2 id="pipeline-title" className="text-base font-bold tracking-tight text-ink">Active pipeline</h2>
                      <p className="text-sm text-muted">The request running right now.</p>
                    </div>
                  </div>
                  {active ? (
                    <div id="result-content" className="space-y-4">
                      <div className="rounded-2xl border border-line bg-head/60 p-4 ring-1 ring-primary-200/40 dark:ring-primary-900/40">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <StatusBadge status={badgeStatus(active.status)} />
                          <span className="rounded-md bg-surface px-2 py-1 font-mono text-xs text-muted ring-1 ring-line">{String(requestId(active)).slice(0, 8)}</span>
                        </div>
                        <p className="mt-3 break-words text-base font-semibold text-ink" title={active.title}>{active.title || 'Untitled request'}</p>
                        <p className="mt-1 text-sm text-muted">Extracting and enriching lead data. This page updates when it finishes.</p>
                      </div>
                      <Button className="w-full" onClick={() => navigate(openPath(active))}>
                        Follow progress <ArrowRight aria-hidden="true" className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div id="result-empty">
                      <EmptyState
                        className="py-8"
                        icon={Zap}
                        title="No active pipeline"
                        description="Nothing is running. Start a new generation and you can follow it here."
                        action={{ label: 'Start now', onClick: () => navigate('/new-request') }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>

            {/* Recent requests */}
            <section data-reveal aria-labelledby="recent-title">
              <div className="card h-full p-6">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h2 id="recent-title" className="text-base font-bold tracking-tight text-ink">Recent requests</h2>
                  {list.length > 0 && (
                    <button type="button" onClick={() => navigate('/lead-requests')} className="inline-flex h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-primary-800 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/60">
                      View all <ArrowRight aria-hidden="true" className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {recent.length === 0 ? (
                  <EmptyState className="py-8" title="No requests yet" description="Your latest requests will show up here." action={{ label: 'New request', onClick: () => navigate('/new-request') }} />
                ) : (
                  <ul className="space-y-2">
                    {recent.map((r) => (
                      <li key={requestId(r)}>
                        <button
                          type="button"
                          onClick={() => navigate(openPath(r))}
                          className="flex min-h-[3rem] w-full items-center justify-between gap-3 rounded-xl border border-transparent px-3 py-2 text-left transition-colors hover:border-line hover:bg-head/70"
                        >
                          <span className="min-w-0 truncate text-sm font-semibold text-ink" title={r.title}>{r.title || 'Untitled request'}</span>
                          <StatusBadge status={badgeStatus(r.status)} className="shrink-0" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
            <div data-reveal className="lg:col-span-2"><UsageCard /></div>
          </div>
        </>
      )}
    </div>
  )
}
