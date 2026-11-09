import { useState } from 'react'
import clsx from 'clsx'
import { Compass, Loader2 } from 'lucide-react'
import { Button, EmptyState, useToast } from '../../components/kit'
import CompanyLogo from '../../components/CompanyLogo'
import { defaultCompetitorFilters, filterCompetitors } from './competitors'
import { PAGE_SIZE, pageSlice } from './leadHelpers'
import { Dash, Drawer, ExtLink, ScoreBar, SearchInput, SelectFilter, Tag } from './ui'
import ExportMenu from './ExportMenu'
import { api } from '../../api'

const TIERS = [
  { id: 'All', label: 'All' },
  { id: 'Direct', label: 'Direct' },
  { id: 'Adjacent', label: 'Adjacent' },
  { id: 'DIY', label: 'DIY / build' },
]
const MAX_COMPARE = 3
const show = (v) => (v && v !== '--' ? v : null)

function CompareDrawer({ list, onClose, onReset }) {
  const rows = [
    ['Overlap', (c) => `${c.overlap_score}%`],
    ['Tier', (c) => c.tier],
    ['Headquarters', (c) => show(c.headquarters)],
    ['Employees', (c) => show(c.employee_count)],
    ['Industry', (c) => show(c.industry)],
    ['G2 rating', (c) => show(String(c.g2_rating))],
    ['Capterra rating', (c) => show(String(c.capterra_rating))],
  ]
  return (
    <Drawer
      open
      onClose={onClose}
      title="Compare competitors"
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" onClick={onReset}>Clear list</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      }
    >
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[480px] text-left text-sm">
          <thead>
            <tr className="bg-head text-xs font-semibold uppercase tracking-wide text-muted">
              <th scope="col" className="px-3 py-2.5">Attribute</th>
              {list.map((c) => <th key={c.name} scope="col" className="px-3 py-2.5 normal-case text-ink break-words">{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, get]) => (
              <tr key={label} className="border-t border-line">
                <th scope="row" className="px-3 py-2.5 text-xs font-semibold text-muted">{label}</th>
                {list.map((c) => <td key={c.name} className="px-3 py-2.5 tabular-nums text-ink break-words">{get(c) || <Dash />}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  )
}

/** The competitor analysis: filter, browse in pages, pick up to three to compare. */
export default function CompetitorsPanel({ competitors, isRunning, requestId }) {
  const toast = useToast()
  const [filters, setFilters] = useState(defaultCompetitorFilters)
  const [page, setPage] = useState(1)
  const [compare, setCompare] = useState([])
  const [compareOpen, setCompareOpen] = useState(false)
  const set = (patch) => { setFilters({ ...filters, ...patch }); setPage(1) }

  const filtered = filterCompetitors(competitors, filters)
  const { visible, remaining } = pageSlice(filtered, page)
  const dirty = JSON.stringify(filters) !== JSON.stringify(defaultCompetitorFilters)

  const toggleCompare = (comp) => {
    if (compare.some((c) => c.name === comp.name)) return setCompare(compare.filter((c) => c.name !== comp.name))
    if (compare.length >= MAX_COMPARE) return toast.push({ type: 'info', message: `You can compare up to ${MAX_COMPARE} competitors at a time.` })
    setCompare([...compare, comp])
  }

  if (competitors.length === 0) {
    return isRunning ? (
      <div role="status" className="flex flex-col items-center rounded-lg border border-line bg-surface px-6 py-14 text-center">
        <Loader2 aria-hidden="true" className="mb-3 h-6 w-6 animate-spin text-primary-700 dark:text-primary-300" />
        <h2 className="text-base font-semibold text-ink">Mapping competitors</h2>
        <p className="mt-1 max-w-sm text-sm text-muted">Competitors appear here when the run finishes this step.</p>
      </div>
    ) : (
      <div className="rounded-lg border border-line bg-surface"><EmptyState icon={Compass} title="No competitors found" description="This run did not return a competitor analysis." /></div>
    )
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchInput value={filters.search} onChange={(search) => set({ search })} placeholder="Search competitors" className="min-w-[12rem] flex-1 sm:max-w-xs" />
        <SelectFilter label="Company size" value={filters.size} onChange={(size) => set({ size })} options={[{ value: 'All', label: 'Any size' }, { value: '10-50', label: '10 to 50' }, { value: '50-200', label: '50 to 200' }, { value: '200+', label: '200+' }]} />
        <SelectFilter label="G2 rating" value={filters.rating} onChange={(rating) => set({ rating })} options={[{ value: 'All', label: 'Any rating' }, { value: '4.0', label: '4.0+ on G2' }, { value: '4.5', label: '4.5+ on G2' }]} />
        <label className="flex h-10 items-center gap-2 text-sm text-muted">
          Min overlap
          <input type="range" min="0" max="100" step="5" value={filters.overlap} onChange={(e) => set({ overlap: parseInt(e.target.value) })} aria-label="Minimum overlap" className="w-28 accent-primary-600" />
          <span className="w-9 tabular-nums text-ink">{filters.overlap}%</span>
        </label>
        {dirty && <Button variant="ghost" size="sm" onClick={() => { setFilters(defaultCompetitorFilters); setPage(1) }}>Clear filters</Button>}
        <div className="ml-auto flex items-center gap-2">
          {compare.length > 0 && <Button variant="secondary" onClick={() => setCompareOpen(true)}>Compare ({compare.length})</Button>}
          <ExportMenu exporter={(format) => api.exportCompetitors(requestId, format)} />
        </div>
      </div>

      <div role="tablist" aria-label="Competitor type" className="mb-3 flex flex-wrap gap-1 border-b border-line">
        {TIERS.map((t) => (
          <button key={t.id} role="tab" aria-selected={filters.tier === t.id} type="button" onClick={() => set({ tier: t.id })} className={clsx('-mb-px h-10 border-b-2 px-3 text-sm font-medium', filters.tier === t.id ? 'border-primary-600 text-ink dark:border-primary-400' : 'border-transparent text-muted hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      <p className="mb-2 text-xs text-muted" aria-live="polite">Showing <span className="tabular-nums">{visible.length}</span> of <span className="tabular-nums">{filtered.length}</span> competitors</p>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState title="No competitors match" description="Try clearing a filter." action={{ label: 'Clear filters', onClick: () => { setFilters(defaultCompetitorFilters); setPage(1) } }} />
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((comp) => {
            const picked = compare.some((c) => c.name === comp.name)
            const tags = show(comp.specialties) ? comp.specialties.split(', ').filter(Boolean).slice(0, 5) : []
            return (
              <li key={comp.name + comp.website} className={clsx('rounded-lg border bg-surface p-4', picked ? 'border-primary-500' : 'border-line')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <CompanyLogo name={comp.name} website={show(comp.website) ? comp.website : ''} size="h-11 w-11" />
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-ink break-words">{comp.name}</h3>
                      <Tag>{comp.tier}</Tag>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs">
                      {show(comp.website) && <ExtLink href={comp.website}>{comp.website.replace(/^https?:\/\/(www\.)?/, '')}</ExtLink>}
                      {show(comp.linkedin_url) && <ExtLink href={comp.linkedin_url}>LinkedIn</ExtLink>}
                    </div>
                    </div>
                  </div>
                  <Button variant={picked ? 'primary' : 'secondary'} size="sm" aria-pressed={picked} onClick={() => toggleCompare(comp)} className="min-h-10 sm:min-h-0">
                    {picked ? 'Added to compare' : 'Compare'}
                  </Button>
                </div>
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  {[show(comp.headquarters), show(comp.employee_count) && `${comp.employee_count} employees`, show(comp.industry), show(comp.company_type), show(comp.founded) && `Est. ${comp.founded}`].filter(Boolean).map((t) => <span key={t}>{t}</span>)}
                </p>
                {show(comp.description) && <p className="mt-2 line-clamp-2 text-sm text-ink break-words">{comp.description}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted">
                  <span className="flex items-center gap-2">Overlap <ScoreBar value={comp.overlap_score} label="Overlap" /></span>
                  {show(String(comp.g2_rating)) && <span>G2 <span className="font-semibold tabular-nums text-ink">{comp.g2_rating}</span></span>}
                  {show(String(comp.capterra_rating)) && <span>Capterra <span className="font-semibold tabular-nums text-ink">{comp.capterra_rating}</span></span>}
                </div>
                {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>}
              </li>
            )
          })}
        </ul>
      )}

      {remaining > 0 && (
        <div className="mt-4 flex justify-center">
          <Button variant="secondary" onClick={() => setPage(page + 1)}>Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} left)</Button>
        </div>
      )}

      {compareOpen && compare.length > 0 && <CompareDrawer list={compare} onClose={() => setCompareOpen(false)} onReset={() => { setCompare([]); setCompareOpen(false) }} />}
    </div>
  )
}
