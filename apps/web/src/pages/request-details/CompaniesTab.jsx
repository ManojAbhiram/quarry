import { useEffect, useRef, useState } from 'react'
import { Inbox, List, SlidersHorizontal, ThumbsDown, ThumbsUp, Users } from 'lucide-react'
import { api } from '../../api'
import { watchApi } from '../../api.p3'
import { groupByDomain } from './signals'
import Reveal from '../../components/motion/Reveal'
import { useFlip } from '../../components/motion/useFlip'
import { Button, EmptyState, Menu, Skeleton } from '../../components/kit'
import { defaultFilters, filterLeads, leadKey, PAGE_SIZE, pageSlice } from './leadHelpers'
import { SearchInput, SelectFilter, TabBar } from './ui'
import ExportMenu from './ExportMenu'
import LeadsTable from './LeadsTable'
import ListPicker from './ListPicker'
import ManualAdds from './ManualAdds'

const SUB_TABS = ['Recommended', 'Saved', 'Excluded', 'Valid', 'Invalid', 'Manual Adds']
const SUB_LABEL = { 'Manual Adds': 'Manual adds' }
const EMPTY_COPY = {
  Recommended: ['No companies left here', 'Every company has been saved, excluded or marked. Check the other tabs.'],
  Saved: ['Nothing saved yet', 'Save a company from its row menu to keep it here.'],
  Excluded: ['Nothing excluded', 'Excluded companies are listed here so you can bring them back.'],
  Valid: ['No valid leads marked', 'Mark good fits as valid from the row menu.'],
  Invalid: ['No invalid leads marked', 'Mark poor fits as invalid from the row menu.'],
}

const GEO = [{ value: 'All', label: 'Any region' }, { value: 'US', label: 'United States' }, 'Europe', 'Canada', { value: 'UK', label: 'United Kingdom' }, 'Asia']
const HEADCOUNT = [{ value: 'All', label: 'Any headcount' }, '10-50', '50-200', '200-500', '500-1000', '1000+']
const SIGNALS = [{ value: 'All', label: 'Any signal' }, 'Hiring', 'Funding', 'Expanding', 'Jobs', 'Tech', 'Events']
const GROWTH = [{ value: 'All', label: 'Any growth' }, { value: '+10%+', label: 'Growth over 10%' }, { value: '+25%+', label: 'Growth over 25%' }, { value: '+50%+', label: 'Growth over 50%' }]

/** The companies in a run: list tabs, search and filters, the results table in pages of 25, and bulk actions. */
export default function CompaniesTab({ leads, lists, manualAdds, onManualChange, onToggleFlag, onBulkMark, onOpen, onEdit, onViewDecisionMakers, runState, requestId, isDirect, globalSearch }) {
  const [filters, setFilters] = useState(defaultFilters)
  const [subTab, setSubTab] = useState('Recommended')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(() => new Set())

  // Detected hiring/funding/tech signals for every company the user watches, fetched once and matched by domain.
  const [signals, setSignals] = useState({ state: 'loading', byDomain: {} })
  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => watchApi.signals())
      .then((res) => alive && setSignals({ state: 'ready', byDomain: groupByDomain(res?.signals) }))
      .catch(() => alive && setSignals({ state: 'error', byDomain: {} }))
    return () => { alive = false }
  }, [requestId])

  const effective = { ...filters, search: filters.search || globalSearch || '' }
  const filtered = filterLeads(leads, effective, lists, subTab)
  const { visible, remaining } = pageSlice(filtered, page)

  // Rows glide to their new place when the list changes. capture() runs before each state change below.
  const listRef = useRef(null)
  const capture = useFlip(listRef, [subTab, visible.map((l) => l._originalIndex).join(',')])

  const industries = ['All', ...new Set(leads.map((l) => l.industry).filter(Boolean))]
  const fundingStages = ['All', ...new Set(leads.map((l) => l.funding_stage).filter(Boolean))]
  const activeFilters = ['industry', 'funding', 'geo', 'headcount', 'signals', 'growth'].filter((k) => filters[k] !== 'All').length + (filters.techStack ? 1 : 0)
  const anyFilter = activeFilters > 0 || Boolean(effective.search)

  const set = (patch) => { capture(); setFilters({ ...filters, ...patch }); setPage(1) }
  const clearFilters = () => { capture(); setFilters(defaultFilters); setPage(1) }
  const flagsFor = (name) => ({ saved: lists.saved.includes(name), excluded: lists.excluded.includes(name), valid: lists.valid.includes(name), invalid: lists.invalid.includes(name) })

  const recommendedCount = leads.filter((l) => { const k = leadKey(l); return !lists.saved.includes(k) && !lists.excluded.includes(k) && !lists.valid.includes(k) && !lists.invalid.includes(k) }).length
  const counts = { Recommended: recommendedCount, Saved: lists.saved.length, Excluded: lists.excluded.length, Valid: lists.valid.length, Invalid: lists.invalid.length, 'Manual Adds': manualAdds.length }

  const toggleSelect = (name) => setSelected((prev) => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next })
  const toggleAll = (on) => setSelected((prev) => { const next = new Set(prev); visible.forEach((l) => (on ? next.add(leadKey(l)) : next.delete(leadKey(l)))); return next })
  const selectedLeads = leads.filter((l) => selected.has(leadKey(l)))
  const bulk = (kind) => { capture(); onBulkMark([...selected], kind); setSelected(new Set()) }

  const empty = leads.length === 0
  const running = runState === 'running'

  let body
  if (subTab === 'Manual Adds') {
    body = <ManualAdds items={manualAdds} onChange={onManualChange} />
  } else if (empty && running) {
    body = (
      <div role="status" aria-label="Searching for companies" className="card space-y-2 p-4">
        {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-10" />)}
        <p className="pt-2 text-center text-sm text-muted">Searching and scoring companies. They appear here as they are found.</p>
      </div>
    )
  } else if (empty && runState === 'empty') {
    body = (
      <div className="card">
        <EmptyState
          title="No companies matched this profile"
          description="The run finished but nothing fit. Try a wider location, a broader industry or looser size limits, then run it again."
          action={{ label: 'Edit request', onClick: onEdit }}
        />
      </div>
    )
  } else if (empty) {
    body = <div className="card"><EmptyState icon={Inbox} title="No companies in this run" description="This run did not save any companies." /></div>
  } else if (filtered.length === 0) {
    const [title, description] = anyFilter ? ['No companies match', 'Try a different search or clear the filters.'] : EMPTY_COPY[subTab]
    body = (
      <div className="card">
        <EmptyState title={title} description={description} action={anyFilter ? { label: 'Clear filters', onClick: clearFilters } : undefined} />
      </div>
    )
  } else {
    body = (
      <>
        <LeadsTable signalsByDomain={signals.byDomain} signalState={signals.state} leads={visible} selected={selected} onToggleSelect={toggleSelect} onToggleAll={toggleAll} onOpen={onOpen} flagsFor={flagsFor} onToggleFlag={(name, kind) => { capture(); onToggleFlag(name, kind) }} />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted" aria-live="polite">Showing <span className="tabular-nums font-semibold text-ink">{visible.length}</span> of <span className="tabular-nums font-semibold text-ink">{filtered.length}</span> companies</p>
          {remaining > 0 && <Button variant="secondary" onClick={() => { capture(); setPage(page + 1) }}>Show {Math.min(PAGE_SIZE, remaining)} more</Button>}
        </div>
      </>
    )
  }

  return (
    <Reveal selector="[data-reveal-row]">
    <div ref={listRef}>
      <TabBar
        label="Company lists"
        layoutId="company-lists-underline"
        size="sm"
        active={subTab}
        onSelect={(tab) => { capture(); setSubTab(tab); setPage(1) }}
        tabs={SUB_TABS.map((tab) => ({ id: tab, label: SUB_LABEL[tab] || tab, count: counts[tab] }))}
      />

      {subTab !== 'Manual Adds' && !empty && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <SearchInput value={filters.search} onChange={(search) => set({ search })} placeholder="Search companies, contacts, locations" className="min-w-[12rem] flex-1 sm:max-w-sm" />
            <Button variant="secondary" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(!filtersOpen)}>
              <SlidersHorizontal aria-hidden="true" className="h-4 w-4" />
              Filters{activeFilters > 0 && <span className="tabular-nums"> ({activeFilters})</span>}
            </Button>
            {anyFilter && <Button variant="ghost" onClick={clearFilters}>Clear</Button>}
            <div className="ml-auto"><ExportMenu exporter={(format) => api.exportCompanies(requestId, format)} disabled={empty} /></div>
          </div>
          {filtersOpen && (
            <div className="mb-3 grid grid-cols-2 gap-2 card p-3 md:grid-cols-4 overflow-visible">
              <SelectFilter label="Industry" value={filters.industry} onChange={(industry) => set({ industry })} options={industries.map((i) => (i === 'All' ? { value: 'All', label: 'Any industry' } : i))} />
              <SelectFilter label="Headcount" value={filters.headcount} onChange={(headcount) => set({ headcount })} options={HEADCOUNT} />
              <SelectFilter label="Funding" value={filters.funding} onChange={(funding) => set({ funding })} options={fundingStages.map((f) => (f === 'All' ? { value: 'All', label: 'Any funding' } : f))} />
              <SelectFilter label="Region" value={filters.geo} onChange={(geo) => set({ geo })} options={GEO} />
              <SelectFilter label="Signals" value={filters.signals} onChange={(signals) => set({ signals })} options={SIGNALS} />
              <SelectFilter label="Growth" value={filters.growth} onChange={(growth) => set({ growth })} options={GROWTH} />
              <input type="search" aria-label="Technology" placeholder="Technology" value={filters.techStack} onChange={(e) => set({ techStack: e.target.value })} className="input col-span-2" />
            </div>
          )}
        </>
      )}

      {selected.size > 0 && subTab !== 'Manual Adds' && (
        <div role="region" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-2 card !overflow-visible px-3 py-2 ring-1 ring-primary-500/40">
          <span className="mr-auto text-sm font-semibold text-ink tabular-nums">{selected.size} selected</span>
          <Button variant="secondary" size="sm" onClick={() => bulk('valid')}><ThumbsUp aria-hidden="true" className="h-3.5 w-3.5" />Mark valid</Button>
          <Button variant="secondary" size="sm" onClick={() => bulk('invalid')}><ThumbsDown aria-hidden="true" className="h-3.5 w-3.5" />Mark invalid</Button>
          <Menu
            label="Add selected to list"
            buttonClassName="inline-flex h-8 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-head"
            button={<><List aria-hidden="true" className="h-3.5 w-3.5" />Add to list</>}
            align="left"
          >
            {({ close }) => <ListPicker leadIds={selectedLeads.map((l) => l._id || l.id)} onDone={() => { close(); setSelected(new Set()) }} />}
          </Menu>
          <Button size="sm" onClick={() => onViewDecisionMakers(leadKey(selectedLeads[0] || leads[0]))}><Users aria-hidden="true" className="h-3.5 w-3.5" />Decision makers</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear selection</Button>
        </div>
      )}

      {body}
      {isDirect && subTab === 'Recommended' && !empty && <p className="mt-3 text-xs text-muted">These are the companies you provided, with their decision makers.</p>}
    </div>
    </Reveal>
  )
}
