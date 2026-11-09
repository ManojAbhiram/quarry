import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import { Download, Loader2, RefreshCw, Users } from 'lucide-react'
import { api } from '../../api'
import { decorateDecisionMakerContacts } from '../../utils/decisionMakers'
import { Button, EmptyState, ErrorState } from '../../components/kit'
import { leadKey, matchScore, PAGE_SIZE, pageSlice } from './leadHelpers'
import { Dash, EmailStatusBadge, ExtLink, ScoreBar, SearchInput, SelectFilter, Tag } from './ui'
import Provenance from '../../components/Provenance'
import ExportMenu from './ExportMenu'
import { EnrollDialog } from '../Outreach'
import { outreachApi } from '../../api.p3'

const SENIORITY = {
  'C-Level': (t) => /chief|cxo|\bceo\b|\bcto\b|\bcro\b|\bcfo\b|\bcoo\b/.test(t),
  VP: (t) => /\bvp\b|vice president/.test(t),
  Director: (t) => t.includes('director'),
  Manager: (t) => t.includes('manager'),
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** Decision makers for one company at a time, with filters, a local CSV export and the full server export. */
export default function DecisionMakersPanel({ leads, dmDataMap, dmLoading, dmError, onRefresh, company: selectedCompany, onSelectCompany, personaOptions, requestId, isRunning }) {
  const [search, setSearch] = useState('')
  const [companySearch, setCompanySearch] = useState('')
  const [seniority, setSeniority] = useState('All')
  const [persona, setPersona] = useState('All')
  const [withEmail, setWithEmail] = useState(false)
  const [selected, setSelected] = useState([])
  const [page, setPage] = useState(1)
  const [enrollOpen, setEnrollOpen] = useState(false)
  const [sequences, setSequences] = useState([])
  useEffect(() => {
    if (!enrollOpen) return
    outreachApi.sequences().then((r) => setSequences(r?.sequences || [])).catch(() => setSequences([]))
  }, [enrollOpen])

  const hasServerData = Object.keys(dmDataMap).length > 0
  const lead = leads.find((l) => leadKey(l) === selectedCompany) || leads[0]
  const company = lead ? leadKey(lead) : selectedCompany

  const contacts = useMemo(
    () => decorateDecisionMakerContacts((hasServerData ? dmDataMap[company] : null) ?? lead?.decision_makers ?? [], { leadMatchScore: lead?.match_score, personaOptions }),
    [hasServerData, dmDataMap, company, lead, personaOptions],
  )

  const countFor = (l) => (hasServerData ? dmDataMap[leadKey(l)]?.length : null) ?? l.decision_makers?.length ?? 0
  const total = hasServerData ? Object.values(dmDataMap).reduce((n, dms) => n + dms.length, 0) : leads.reduce((n, l) => n + (l.decision_makers?.length || 0), 0)

  const term = search.toLowerCase()
  const shown = contacts.filter((c) => {
    const title = (c.title || '').toLowerCase()
    if (term && !(c.name || '').toLowerCase().includes(term) && !title.includes(term)) return false
    if (seniority !== 'All' && !SENIORITY[seniority](title)) return false
    if (persona !== 'All' && (c.persona_label || 'Influencer') !== persona) return false
    if (withEmail && !c.email) return false
    return true
  })
  const { visible, remaining } = pageSlice(shown, page)
  const reset = (fn) => (v) => { fn(v); setPage(1) }

  const companyList = leads.filter((l) => leadKey(l).toLowerCase().includes(companySearch.toLowerCase()))
  const toggle = (name) => setSelected(selected.includes(name) ? selected.filter((n) => n !== name) : [...selected, name])
  const allSelected = visible.length > 0 && visible.every((c) => selected.includes(c.name))

  const outreachContacts = contacts
    .filter((c) => selected.includes(c.name) && c.email)
    .map((c) => ({ email: c.email, name: c.name, title: c.title, company: lead?.title || company, lead_id: lead?.id || lead?._id }))

  const exportCsv = () => {
    if (contacts.length === 0) return
    const header = 'Name,Title,Email,LinkedIn URL,Company\n'
    const rows = contacts.map((c) => [c.name, c.title, c.email, c.linkedin_url, company].map(csvCell).join(',')).join('\n')
    const url = window.URL.createObjectURL(new Blob([header + rows], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${company || 'contacts'}_decision_makers.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  if (leads.length === 0) {
    return isRunning ? (
      <div role="status" className="flex flex-col items-center rounded-lg border border-line bg-surface px-6 py-14 text-center">
        <Loader2 aria-hidden="true" className="mb-3 h-6 w-6 animate-spin text-primary-700 dark:text-primary-300" />
        <h2 className="text-base font-semibold text-ink">Waiting for companies</h2>
        <p className="mt-1 max-w-sm text-sm text-muted">Decision makers appear once companies have been found.</p>
      </div>
    ) : (
      <div className="rounded-lg border border-line bg-surface"><EmptyState icon={Users} title="No decision makers" description="This run has no companies, so there are no contacts to show." /></div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted"><span className="tabular-nums font-semibold text-ink">{total}</span> contacts across <span className="tabular-nums font-semibold text-ink">{leads.length}</span> companies</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" loading={dmLoading} onClick={onRefresh}>
            {!dmLoading && <RefreshCw aria-hidden="true" className="h-4 w-4" />}
            Refresh
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={contacts.length === 0}>
            <Download aria-hidden="true" className="h-4 w-4" />
            This company (CSV)
          </Button>
          <ExportMenu label="Export all" exporter={(format) => api.exportDecisionMakers(requestId, format)} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <div>
          <label className="lg:hidden">
            <span className="mb-1 block text-xs text-muted">Company</span>
            <SelectFilter label="Company" value={company || ''} onChange={(v) => { onSelectCompany(v); setPage(1) }} options={leads.map((l) => ({ value: leadKey(l), label: `${leadKey(l)} (${countFor(l)})` }))} className="w-full" />
          </label>
          <div className="hidden rounded-lg border border-line bg-surface lg:block">
            <div className="border-b border-line p-2">
              <SearchInput value={companySearch} onChange={setCompanySearch} placeholder="Search companies" />
            </div>
            <ul className="max-h-[32rem] overflow-y-auto p-1">
              {companyList.map((l) => {
                const name = leadKey(l)
                const active = name === company
                return (
                  <li key={l._originalIndex}>
                    <button type="button" aria-current={active || undefined} onClick={() => { onSelectCompany(name); setPage(1) }} className={clsx('flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm', active ? 'bg-primary-50 font-semibold text-primary-800 dark:bg-primary-950/60 dark:text-primary-300' : 'text-ink hover:bg-head')}>
                      <span className="min-w-0 break-words">{name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">{countFor(l)} · {Math.round(matchScore(l))}</span>
                    </button>
                  </li>
                )
              })}
              {companyList.length === 0 && <li className="px-2.5 py-3 text-sm text-muted">No companies match.</li>}
            </ul>
          </div>
        </div>

        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={reset(setSearch)} placeholder="Search contacts" className="min-w-[12rem] flex-1 sm:max-w-xs" />
            <SelectFilter label="Seniority" value={seniority} onChange={reset(setSeniority)} options={[{ value: 'All', label: 'Any seniority' }, ...Object.keys(SENIORITY)]} />
            <SelectFilter label="Persona" value={persona} onChange={reset(setPersona)} options={[{ value: 'All', label: 'Any persona' }, ...personaOptions]} />
            <label className="flex h-10 items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={withEmail} onChange={(e) => reset(setWithEmail)(e.target.checked)} className="h-4 w-4 accent-primary-600" />
              With email only
            </label>
          </div>

          {dmError ? (
            <div className="rounded-lg border border-line bg-surface"><ErrorState title="Could not load decision makers" message={dmError} onRetry={onRefresh} /></div>
          ) : dmLoading && contacts.length === 0 ? (
            <div role="status" className="flex items-center justify-center gap-2 rounded-lg border border-line bg-surface py-14 text-sm text-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Loading contacts</div>
          ) : contacts.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface"><EmptyState icon={Users} title="No contacts for this company" description="No decision makers were found for it in this run." /></div>
          ) : shown.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface"><EmptyState title="No contacts match" description="Try clearing a filter." /></div>
          ) : (
            <>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted" aria-live="polite">
                <span>Showing <span className="tabular-nums">{visible.length}</span> of <span className="tabular-nums">{shown.length}</span> contacts at {company}, most relevant first</span>
                <label className="flex h-10 items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? selected.filter((n) => !visible.some((c) => c.name === n)) : [...new Set([...selected, ...visible.map((c) => c.name)])])} className="h-4 w-4 accent-primary-600" />
                  Select all shown
                </label>
              </div>
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                {visible.map((c, i) => {
                  const email = c.email
                  return (
                    <li key={`${c.name}-${i}`} className="flex items-start gap-1 px-2 py-2.5 sm:px-3">
                      <label className="flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center md:h-8 md:w-8">
                        <input type="checkbox" checked={selected.includes(c.name)} onChange={() => toggle(c.name)} aria-label={`Select ${c.name}`} className="h-4 w-4 accent-primary-600" />
                      </label>
                      <div className="grid min-w-0 flex-1 gap-x-4 gap-y-1 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-ink break-words">{c.name}</p>
                          <p className="text-xs text-muted break-words">{c.title || <Dash />}</p>
                          <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                            {email ? <a href={`mailto:${email}`} className="break-all text-primary-700 hover:underline dark:text-primary-300">{email}</a> : <span className="text-muted">No email</span>}
                            <ExtLink href={c.linkedin_url}>LinkedIn</ExtLink>
                          </p>
                          {email && (
                            <p className="mt-1 flex flex-wrap items-center gap-1">
                              <EmailStatusBadge lead={{ ...c, email }} showDate />
                              <Provenance provenance={c.provenance} field="email" label={`${c.name}'s email`} />
                            </p>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2"><Tag>{c.persona_label || 'Influencer'}</Tag><span className="text-xs text-muted">{c.confidence_label} confidence</span></div>
                        <ScoreBar value={c.relevance_score ?? 0} label="Relevance" />
                      </div>
                    </li>
                  )
                })}
              </ul>
              {remaining > 0 && (
                <div className="mt-4 flex justify-center">
                  <Button variant="secondary" onClick={() => setPage(page + 1)}>Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} left)</Button>
                </div>
              )}
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <span className="text-sm text-muted tabular-nums">{selected.length === 0 ? 'No contacts selected' : `${selected.length} ${selected.length === 1 ? 'contact' : 'contacts'} selected`}</span>
            <Button disabled={outreachContacts.length === 0} title={outreachContacts.length === 0 ? 'Select contacts that have an email to add them to a sequence.' : undefined} onClick={() => setEnrollOpen(true)}>Add to sequence{outreachContacts.length > 0 ? ` (${outreachContacts.length})` : ''}</Button>
            <EnrollDialog open={enrollOpen} onClose={() => setEnrollOpen(false)} contacts={outreachContacts} sequences={sequences} onDone={() => setSelected([])} />
          </div>
        </div>
      </div>
    </div>
  )
}
