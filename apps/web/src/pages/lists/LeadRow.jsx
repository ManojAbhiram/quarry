import { useState } from 'react'
import clsx from 'clsx'
import { BookmarkCheck, Check, ExternalLink, Loader2, Trash2, X } from 'lucide-react'
import { api } from '../../api'
import { useToast } from '../../components/kit'

function EmailBadge({ verified, confidence }) {
  if (verified === null || verified === undefined) return null
  if (!verified) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-2 py-0.5 text-xs font-semibold text-bad">
        <X aria-hidden="true" className="h-3 w-3" /> Invalid
      </span>
    )
  }
  const high = confidence === 'high'
  return (
    <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold', high ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn')}>
      <Check aria-hidden="true" className="h-3 w-3" />
      {high ? 'Verified' : 'Likely valid'}
    </span>
  )
}

const ICON_BTN = 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-head hover:text-ink disabled:opacity-50'

/** One lead inside a list: a real checkbox, title and email (long ones wrap), match score and actions. */
export default function LeadRow({ lead, selected, onToggleSelect, onRemove }) {
  const toast = useToast()
  const [verifying, setVerifying] = useState(false)
  const [verif, setVerif] = useState({ verified: lead.email_verified ?? null, confidence: lead.email_confidence ?? null })
  const label = lead.title || lead.url || 'Untitled lead'

  const handleVerify = async () => {
    if (!lead.id) return
    setVerifying(true)
    try {
      const res = await api.verifyAndSaveLeadEmail(lead.id)
      setVerif({ verified: res.verified, confidence: res.confidence })
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not verify that email.' })
    } finally {
      setVerifying(false)
    }
  }

  return (
    <li data-flip-id={lead.id}>
      <div
        className={clsx(
          'flex items-center gap-2 rounded-xl border p-2 pl-3 transition-colors',
          selected ? 'border-primary-300 bg-primary-50 dark:border-primary-700 dark:bg-primary-950/40' : 'border-transparent hover:border-line hover:bg-head/70',
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(lead.id)}
          aria-label={`Select ${label}`}
          className="h-5 w-5 shrink-0 cursor-pointer rounded accent-primary-600"
        />
        <div className="min-w-0 flex-1 px-1">
          <p className="break-words text-sm font-semibold text-ink line-clamp-2" title={label}>
            {label}
          </p>
          {lead.email && (
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="break-all text-xs text-muted">{lead.email}</span>
              <EmailBadge verified={verif.verified} confidence={verif.confidence} />
            </div>
          )}
        </div>
        {lead.match_score !== null && lead.match_score !== undefined && !Number.isNaN(Number(lead.match_score)) && (
          <span className="hidden shrink-0 rounded-full bg-primary-50 px-2.5 py-1 text-xs font-bold text-primary-800 ring-1 ring-primary-200/70 sm:inline dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-900/60">
            {Math.round(Number(lead.match_score))}%
          </span>
        )}
        {lead.email && (
          <button type="button" onClick={handleVerify} disabled={verifying} aria-label={`Verify email for ${label}`} className={ICON_BTN}>
            {verifying ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <BookmarkCheck aria-hidden="true" className="h-4 w-4" />}
          </button>
        )}
        {lead.url && (
          <a href={lead.url} target="_blank" rel="noreferrer" aria-label={`Open ${label}`} className={ICON_BTN}>
            <ExternalLink aria-hidden="true" className="h-4 w-4" />
          </a>
        )}
        <button type="button" onClick={() => onRemove(lead)} aria-label={`Remove ${label} from list`} className={clsx(ICON_BTN, 'hover:bg-bad-soft hover:text-bad')}>
          <Trash2 aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
    </li>
  )
}
