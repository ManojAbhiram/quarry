import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { AlertTriangle, ArrowLeft, Building2, Gauge, Loader2, Pencil, Terminal, Users, XCircle } from 'lucide-react'
import { Button, StatusBadge } from '../../components/kit'
import { GlowingEffect } from '@/components/ui/glowing-effect'
import { contactOf, matchScore } from './leadHelpers'

const GLOW = {
  completed: 'bg-ok/30',
  partial: 'bg-warn/30',
  failed: 'bg-bad/30',
  running: 'bg-primary-500/40',
}

/** The numbers of a run at a glance: companies, contacts and the average match. */
export function summarize(leads) {
  const scored = leads.filter((l) => !Number.isNaN(parseFloat(l?.match_score)))
  const contacts = leads.filter((l) => contactOf(l).name).length
  const average = scored.length ? Math.round(scored.reduce((sum, l) => sum + matchScore(l), 0) / scored.length) : null
  return { companies: leads.length, contacts, average }
}

function StatCard({ icon: Icon, label, value, hint, tile }) {
  return (
    <li data-reveal className="relative">
      <div className="card card-hover relative h-full p-4">
        <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
        <div className="relative flex items-center gap-3">
          <span className={clsx('flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white shadow-lg ring-1 ring-white/30', tile)}>
            <Icon aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">{label}</p>
            <p className="text-2xl font-black tabular-nums tracking-tight text-ink">{value ?? <span aria-label="not available">&mdash;</span>}</p>
          </div>
        </div>
        {hint && <p className="relative mt-2 text-xs text-muted">{hint}</p>}
      </div>
    </li>
  )
}

/** Title, glowing status chip, page-level actions and a stat strip for a run. */
export default function RunHeader({ request, runState, leads = [], isDirect, onEdit, onToggleDetails, detailsOpen, actions }) {
  const status = runState === 'partial' ? 'partial' : String(request.status || '').toLowerCase() === 'active' ? 'running' : request.status
  const glow = GLOW[String(status || '').toLowerCase()]
  const meta = [request.business_type, request.location].filter(Boolean)
  const stats = summarize(leads)
  return (
    <header className="mb-5">
      <div data-reveal>
        <Link to="/lead-requests" className="mb-3 inline-flex h-10 items-center gap-1.5 rounded-lg text-sm font-medium text-muted transition-colors hover:text-ink sm:h-8">
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Lead requests
        </Link>
      </div>
      <div data-reveal>
      <div className="card relative p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-gradient-to-br from-primary-400/25 to-accent-400/20 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-24 -left-10 h-48 w-48 rounded-full bg-accent-400/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="relative inline-flex">
                {glow && <span aria-hidden="true" className={clsx('absolute inset-0 rounded-full blur-md', glow, runState === 'running' && 'animate-pulse')} />}
                <StatusBadge status={status} className="relative" />
              </span>
              {isDirect && <span className="rounded-full bg-head px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-inset ring-line">Direct companies</span>}
              {meta.length > 0 && <span className="break-words text-xs font-medium text-muted">{meta.join(' · ')}</span>}
            </div>
            <h1 className="mt-3 text-3xl font-black tracking-tight text-ink break-words">{request.title || 'Untitled request'}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isDirect && (
              <Button variant="secondary" aria-pressed={detailsOpen} onClick={onToggleDetails}>
                <Terminal aria-hidden="true" className="h-4 w-4" />
                Run details
              </Button>
            )}
            <Button variant="secondary" onClick={onEdit}>
              <Pencil aria-hidden="true" className="h-4 w-4" />
              Edit request
            </Button>
            {actions}
          </div>
        </div>
      </div>
      </div>
      <ul aria-label="Run summary" className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={Building2} label="Companies" value={stats.companies} hint="found by this run" tile="bg-gradient-to-br from-primary-500 to-primary-700 shadow-primary-600/30" />
        <StatCard icon={Users} label="Contacts" value={stats.contacts} hint={stats.companies > 0 ? `with a named decision maker` : undefined} tile="bg-gradient-to-br from-accent-500 to-accent-700 shadow-accent-600/30" />
        <StatCard icon={Gauge} label="Average match" value={stats.average} hint={stats.average != null ? 'out of 100' : 'no match scores yet'} tile="bg-gradient-to-br from-primary-500 to-accent-600 shadow-primary-600/30" />
      </ul>
    </header>
  )
}

/** Explains the run: in progress, stopped early (partial), failed. Renders nothing for a healthy completed run. */
export function RunBanner({ runState, request, leadCount, onEdit }) {
  if (runState === 'running') {
    return (
      <div role="status" className="card mb-5 flex items-start gap-3 p-4 ring-1 ring-primary-500/20">
        <Loader2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary-700 dark:text-primary-300" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Run in progress</p>
          <p className="mt-0.5 text-sm text-muted">
            {leadCount > 0 ? `${leadCount} ${leadCount === 1 ? 'company' : 'companies'} found so far. ` : 'Searching and scoring companies. '}
            This page updates by itself; you can leave and come back.
          </p>
        </div>
      </div>
    )
  }
  if (runState === 'partial') {
    return (
      <div role="alert" className="mb-5 rounded-2xl border border-line border-l-4 border-l-warn bg-warn-soft p-4 shadow-soft">
        <div className="flex items-start gap-3">
          <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-warn" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">Run stopped early, {leadCount} {leadCount === 1 ? 'lead was' : 'leads were'} kept</p>
            <p className="mt-0.5 text-sm text-ink break-words">{request.failure_reason || 'No further details were recorded.'}</p>
            <p className="mt-1.5 text-sm text-muted">Use or export what was found. To find more, fix the cause above and start a new run.</p>
          </div>
        </div>
      </div>
    )
  }
  if (runState === 'failed') {
    return (
      <div role="alert" className="mb-5 rounded-2xl border border-line border-l-4 border-l-bad bg-bad-soft p-4 shadow-soft">
        <div className="flex items-start gap-3">
          <XCircle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-ink">This run failed and found no leads</p>
            <p className="mt-0.5 text-sm text-ink break-words">{request.failure_reason || 'No further details were recorded.'}</p>
            <p className="mt-1.5 text-sm text-muted">
              Fix the cause above{/key|quota|limit/i.test(request.failure_reason || '') && <> (keys and usage live in <Link to="/profile" className="font-semibold text-primary-700 underline dark:text-primary-300">Account settings</Link>)</>}, then edit the request and start a new run.
            </p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={onEdit}>Edit request</Button>
          </div>
        </div>
      </div>
    )
  }
  return null
}
