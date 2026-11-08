// Pure helpers for the request details screen (kept free of React so they are easy to test).

export const PAGE_SIZE = 25

/** Name used to identify a lead in the saved / excluded / valid / invalid lists. */
export function leadKey(lead) {
  return lead?.company_name || lead?.name || lead?.title || 'Unknown company'
}

/** The match score as a number from 0 to 100 (the API sends it as a string such as "92.0"). */
export function matchScore(lead) {
  const n = parseFloat(lead?.match_score)
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(100, n))
}

/** The lead's decision maker: the contact on the lead, else the first listed decision maker. */
export function contactOf(lead) {
  if (lead?.contact_name) return { name: lead.contact_name, title: lead.contact_title || '' }
  const first = lead?.decision_makers?.[0]
  if (first?.name) return { name: first.name, title: first.title || '' }
  return { name: '', title: '' }
}

export const defaultFilters = {
  search: '',
  industry: 'All',
  funding: 'All',
  geo: 'All',
  headcount: 'All',
  techStack: '',
  signals: 'All',
  growth: 'All',
}

const HEADCOUNT = {
  '10-50': (n) => n >= 10 && n <= 50,
  '50-200': (n) => n > 50 && n <= 200,
  '200-500': (n) => n > 200 && n <= 500,
  '500-1000': (n) => n > 500 && n <= 1000,
  '1000+': (n) => n > 1000,
}

const GROWTH = { '+10%+': 10, '+25%+': 25, '+50%+': 50 }

/** Does the lead pass the dropdown/search filters (everything except the list tab)? */
export function matchesFilters(lead, f) {
  const contact = contactOf(lead)
  const term = (f.search || '').toLowerCase()
  if (term) {
    const haystack = [leadKey(lead), lead.industry, lead.location, contact.name, contact.title, lead.email].filter(Boolean).join(' ').toLowerCase()
    if (!haystack.includes(term)) return false
  }
  if (f.industry !== 'All' && lead.industry !== f.industry) return false
  if (f.funding !== 'All' && lead.funding_stage !== f.funding) return false
  if (f.geo !== 'All') {
    const inLocation = lead.location && lead.location.includes(f.geo)
    const inUrl = lead.url && lead.url.toLowerCase().includes(f.geo.toLowerCase())
    if (!inLocation && !inUrl) return false
  }
  if (f.headcount !== 'All') {
    const n = parseInt(lead.employee_size_estimate)
    if (Number.isNaN(n) || !HEADCOUNT[f.headcount]?.(n)) return false
  }
  if (f.techStack) {
    const tech = (lead.tech_stack || []).join(' ').toLowerCase()
    if (!tech.includes(f.techStack.toLowerCase())) return false
  }
  if (f.signals !== 'All') {
    const signalText = ((lead.signals || []).join(' ') + ' ' + (lead.intent_signals || []).map((s) => `${s.type} ${s.title} ${s.summary}`).join(' ')).toLowerCase()
    if (!signalText.includes(f.signals.toLowerCase())) return false
  }
  if (f.growth !== 'All') {
    const g = parseFloat(lead.growth)
    if (Number.isNaN(g) || g < GROWTH[f.growth]) return false
  }
  return true
}

/** Leads that pass the filters and belong to the chosen list tab, best match first. */
export function filterLeads(leads, filters, lists, subTab) {
  if (subTab === 'Manual Adds') return []
  return leads
    .filter((lead) => {
      if (!matchesFilters(lead, filters)) return false
      const key = leadKey(lead)
      const saved = lists.saved.includes(key)
      const excluded = lists.excluded.includes(key)
      const valid = lists.valid.includes(key)
      const invalid = lists.invalid.includes(key)
      if (subTab === 'Recommended') return !saved && !excluded && !valid && !invalid
      if (subTab === 'Saved') return saved
      if (subTab === 'Excluded') return excluded
      if (subTab === 'Valid') return valid
      if (subTab === 'Invalid') return invalid
      return true
    })
    .sort((a, b) => matchScore(b) - matchScore(a))
}

/** How the four lists change when a company is toggled in one of them. */
export function toggleMembership(lists, name, kind) {
  const without = (arr) => arr.filter((n) => n !== name)
  const has = lists[kind].includes(name)
  if (has) return { ...lists, [kind]: without(lists[kind]) }
  const next = { ...lists, [kind]: [...lists[kind], name] }
  const clears = { valid: ['invalid', 'saved', 'excluded'], invalid: ['valid', 'saved', 'excluded'], saved: ['excluded'], excluded: ['saved'] }[kind]
  for (const other of clears) next[other] = without(next[other])
  return next
}

/** Apply the same list change to several companies at once (bulk Mark valid / Mark invalid). */
export function bulkMark(lists, names, kind) {
  const other = kind === 'valid' ? 'invalid' : 'valid'
  const drop = (arr) => arr.filter((n) => !names.includes(n))
  return { ...lists, [kind]: [...new Set([...lists[kind], ...names])], [other]: drop(lists[other]), saved: drop(lists.saved), excluded: drop(lists.excluded) }
}

/**
 * The state of the run, from the request status and how many leads exist:
 * running | failed | partial (failed midway, leads kept) | empty (completed, nothing matched) | completed.
 */
export function deriveRunState(status, leadCount) {
  const s = String(status || '').toLowerCase()
  if (s === 'pending' || s === 'active') return 'running'
  if (s === 'failed') return leadCount > 0 ? 'partial' : 'failed'
  if (leadCount === 0) return 'empty'
  return 'completed'
}

/** The first `page * PAGE_SIZE` rows, and how many are still hidden. */
export function pageSlice(rows, page) {
  const visible = rows.slice(0, page * PAGE_SIZE)
  return { visible, remaining: rows.length - visible.length }
}
