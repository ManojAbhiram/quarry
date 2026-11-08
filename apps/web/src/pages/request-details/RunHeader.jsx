import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Loader2, Pencil, Terminal, XCircle } from 'lucide-react'
import { Button, StatusBadge } from '../../components/kit'

/** Title, status and the page-level actions of a run. */
export default function RunHeader({ request, runState, leadCount, isDirect, onEdit, onToggleDetails, detailsOpen, actions }) {
  const status = runState === 'partial' ? 'partial' : String(request.status || '').toLowerCase() === 'active' ? 'running' : request.status
  const meta = [request.business_type, request.location].filter(Boolean)
  return (
    <header className="mb-5">
      <Link to="/lead-requests" className="mb-3 inline-flex h-10 items-center gap-1.5 text-sm font-medium text-muted hover:text-ink sm:h-8">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />
        Lead requests
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <h1 className="text-2xl font-bold tracking-tight text-ink break-words">{request.title || 'Untitled request'}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
            <StatusBadge status={status} />
            <span className="tabular-nums">{leadCount} {leadCount === 1 ? 'company' : 'companies'}</span>
            {meta.length > 0 && <span className="break-words">{meta.join(' · ')}</span>}
            {isDirect && <span>Direct companies</span>}
          </div>
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
    </header>
  )
}

/** Explains the run: in progress, stopped early (partial), failed. Renders nothing for a healthy completed run. */
export function RunBanner({ runState, request, leadCount, onEdit }) {
  if (runState === 'running') {
    return (
      <div role="status" className="mb-5 flex items-start gap-3 rounded-lg border border-line bg-surface p-4">
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
      <div role="alert" className="mb-5 rounded-lg border border-line border-l-4 border-l-warn bg-warn-soft p-4">
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
      <div role="alert" className="mb-5 rounded-lg border border-line border-l-4 border-l-bad bg-bad-soft p-4">
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
