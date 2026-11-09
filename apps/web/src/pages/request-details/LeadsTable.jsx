import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { IntentScoreBadge } from '../../components/intent/IntentPanel'
import { contactOf, leadKey, matchScore } from './leadHelpers'
import CompanyLogo from '../../components/CompanyLogo'
import { Dash, EmailStatusBadge, ExtLink, ScoreBar } from './ui'
import LeadActionsMenu, { FlagTags } from './LeadActions'

const LONG_EXPLANATION = 70
const WIDE = '(min-width: 768px)'

/** True from the md breakpoint up. Only the layout that is on screen gets flip ids, so row moves are measured once. */
function useWide() {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(WIDE).matches
  const [wide, setWide] = useState(query)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(WIDE)
    const on = () => setWide(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return wide
}

function Explanation({ text }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  const long = text.length > LONG_EXPLANATION
  if (!long) return <p className="text-xs text-muted">{text}</p>
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? 'Collapse match explanation' : 'Expand match explanation'}
      onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
      className="flex min-h-10 w-full items-start gap-1 py-1 text-left text-xs text-muted hover:text-ink md:min-h-0 md:py-0"
    >
      <span className={clsx('min-w-0 flex-1', !open && 'line-clamp-1 break-all md:break-normal')}>{text}</span>
      <ChevronRight aria-hidden="true" className={clsx('mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
    </button>
  )
}

function SelectBox({ checked, onChange, label }) {
  return (
    <label className="flex h-10 w-10 cursor-pointer items-center justify-center md:h-8 md:w-8" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={checked} onChange={onChange} aria-label={label} className="h-4 w-4 cursor-pointer rounded border-line accent-primary-600" />
    </label>
  )
}

function IntentCell({ lead }) {
  if (lead.intent_score == null) return <span className="text-xs text-muted">Not analysed</span>
  return <IntentScoreBadge score={lead.intent_score} band={lead.intent_band} small />
}

function EmailCell({ lead }) {
  const email = lead.email || lead.contact_email
  return (
    <div className="min-w-0">
      {email ? <p className="break-all text-sm text-ink">{email}</p> : <Dash />}
      <EmailStatusBadge lead={lead} className="mt-1" />
    </div>
  )
}

export default function LeadsTable({ leads, selected, onToggleSelect, onToggleAll, onOpen, flagsFor, onToggleFlag }) {
  const wide = useWide()
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(leadKey(l)))
  const rowProps = (lead) => {
    const name = leadKey(lead)
    return { lead, name, contact: contactOf(lead), flags: flagsFor(name), isSelected: selected.has(name) }
  }

  return (
    <>
      {/* Phones: stacked cards */}
      <ul className="space-y-3 md:hidden">
        {leads.map((lead, i) => {
          const { name, contact, flags, isSelected } = rowProps(lead)
          return (
            <li key={lead._originalIndex} data-flip-id={wide ? undefined : `m-${lead._originalIndex}`} data-reveal-row={i < 8 ? '' : undefined}>
             <div className="card card-hover !overflow-visible p-3">
              <div className="flex items-start gap-1">
                <SelectBox checked={isSelected} onChange={() => onToggleSelect(name)} label={`Select ${name}`} />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => onOpen(lead)} className="flex min-h-10 w-full items-center text-left text-sm font-semibold text-ink break-words hover:underline">
                    {name}
                  </button>
                  <p className="text-xs text-muted break-words">{[lead.industry, lead.location].filter(Boolean).join(' · ') || 'No industry or location'}</p>
                </div>
                <LeadActionsMenu name={name} flags={flags} onToggle={(kind) => onToggleFlag(name, kind)} leadIds={[lead._id || lead.id]} />
              </div>
              <dl className="mt-2 grid grid-cols-[5.5rem_1fr] items-center gap-x-3 gap-y-2 text-sm">
                <dt className="text-xs text-muted">Match</dt>
                <dd><ScoreBar value={matchScore(lead)} className="justify-start" /></dd>
                <dt className="text-xs text-muted">Decision maker</dt>
                <dd className="min-w-0">
                  {contact.name ? (
                    <>
                      <p className="break-words text-ink">{contact.name}</p>
                      {contact.title && <p className="break-words text-xs text-muted">{contact.title}</p>}
                    </>
                  ) : <Dash />}
                </dd>
                <dt className="text-xs text-muted">Email</dt>
                <dd className="min-w-0"><EmailCell lead={lead} /></dd>
                <dt className="text-xs text-muted">Intent</dt>
                <dd><IntentCell lead={lead} /></dd>
              </dl>
              <div className="mt-1"><Explanation text={lead.match_explanation} /></div>
              <div className="mt-1"><FlagTags flags={flags} /></div>
             </div>
            </li>
          )
        })}
      </ul>

      {/* Tablet and up: table */}
      <div className="card hidden !overflow-visible md:block">
        <table className="w-full table-fixed text-left text-sm">
          <caption className="sr-only">Companies found by this run, best match first</caption>
          <thead>
            <tr className="bg-gradient-to-r from-head to-head/40 text-xs font-bold uppercase tracking-wider text-muted">
              <th scope="col" className="w-12 rounded-tl-2xl px-2 py-2.5">
                <SelectBox checked={allSelected} onChange={() => onToggleAll(!allSelected)} label="Select all shown companies" />
              </th>
              <th scope="col" className="w-[31%] px-3 py-2.5">Company</th>
              <th scope="col" className="w-[16%] px-3 py-2.5">Decision maker</th>
              <th scope="col" className="w-[26%] px-3 py-2.5">Email</th>
              <th scope="col" className="w-[12%] px-3 py-2.5">Match</th>
              <th scope="col" className="w-[9%] px-3 py-2.5">Intent</th>
              <th scope="col" className="w-12 rounded-tr-2xl px-2 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead, i) => {
              const { name, contact, flags, isSelected } = rowProps(lead)
              return (
                <tr key={lead._originalIndex} data-flip-id={wide ? `d-${lead._originalIndex}` : undefined} data-reveal-row={i < 8 ? '' : undefined} onClick={() => onOpen(lead)} className={clsx('cursor-pointer border-t border-line align-top bg-surface/0 hover:bg-primary-50/70 hover:shadow-[inset_3px_0_0_rgb(var(--p-500))] dark:hover:bg-primary-950/30', isSelected && 'bg-primary-50/60 dark:bg-primary-950/30')}>
                  <td className="px-2 py-2.5"><SelectBox checked={isSelected} onChange={() => onToggleSelect(name)} label={`Select ${name}`} /></td>
                  <td className="min-w-0 px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <CompanyLogo name={name} website={lead.url} size="h-10 w-10" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(lead) }} className="max-w-full text-left text-sm font-semibold text-ink break-words hover:text-primary-700 hover:underline dark:hover:text-primary-300">
                          {name}
                        </button>
                        <p className="text-xs text-muted break-words">{[lead.industry, lead.location].filter(Boolean).join(' · ')}</p>
                        <Explanation text={lead.match_explanation} />
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <ExtLink href={lead.url}>Website</ExtLink>
                          <ExtLink href={lead.linkedin_url}>LinkedIn</ExtLink>
                          <FlagTags flags={flags} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="min-w-0 px-3 py-2.5">
                    {contact.name ? (
                      <>
                        <p className="break-words text-ink">{contact.name}</p>
                        {contact.title && <p className="break-words text-xs text-muted">{contact.title}</p>}
                      </>
                    ) : <Dash />}
                  </td>
                  <td className="min-w-0 px-3 py-2.5"><EmailCell lead={lead} /></td>
                  <td className="px-3 py-2.5"><ScoreBar value={matchScore(lead)} /></td>
                  <td className="px-3 py-2.5"><IntentCell lead={lead} /></td>
                  <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                    <LeadActionsMenu name={name} flags={flags} onToggle={(kind) => onToggleFlag(name, kind)} leadIds={[lead._id || lead.id]} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
