import { describe, it, expect } from 'vitest'
import { leadKey, matchScore, contactOf, filterLeads, toggleMembership, deriveRunState, pageSlice, PAGE_SIZE, defaultFilters } from './leadHelpers'

const lead = (over = {}) => ({ company_name: 'Acme', industry: 'Software', match_score: '80.0', ...over })
const emptyLists = { saved: [], excluded: [], valid: [], invalid: [] }

describe('leadKey / matchScore / contactOf', () => {
  it('names a lead by company, then name, then title', () => {
    expect(leadKey({ company_name: 'A', name: 'B' })).toBe('A')
    expect(leadKey({ name: 'B', title: 'C' })).toBe('B')
    expect(leadKey({ title: 'C' })).toBe('C')
    expect(leadKey({})).toBe('Unknown company')
  })

  it('turns a string score into a clamped number', () => {
    expect(matchScore({ match_score: '92.0' })).toBe(92)
    expect(matchScore({ match_score: 140 })).toBe(100)
    expect(matchScore({ match_score: 'x' })).toBe(0)
    expect(matchScore({})).toBe(0)
  })

  it('reads the decision maker from the lead, falling back to the first listed contact', () => {
    expect(contactOf({ contact_name: 'Ann', contact_title: 'CEO' })).toEqual({ name: 'Ann', title: 'CEO' })
    expect(contactOf({ decision_makers: [{ name: 'Bo', title: 'CTO' }] })).toEqual({ name: 'Bo', title: 'CTO' })
    expect(contactOf({})).toEqual({ name: '', title: '' })
  })
})

describe('filterLeads', () => {
  const leads = [
    lead({ company_name: 'Alpha', industry: 'Software', match_score: '60', location: 'Berlin, Germany', contact_name: 'Zed Quill' }),
    lead({ company_name: 'Beta', industry: 'Retail', match_score: '90', funding_stage: 'Seed', employee_size_estimate: '120' }),
    lead({ company_name: 'Gamma', industry: 'Software', match_score: '75', tech_stack: ['React'] }),
  ]

  it('sorts by match score, highest first', () => {
    expect(filterLeads(leads, defaultFilters, emptyLists, 'Recommended').map(l => l.company_name)).toEqual(['Beta', 'Gamma', 'Alpha'])
  })

  it('searches across every row, including the contact name and location', () => {
    expect(filterLeads(leads, { ...defaultFilters, search: 'berlin' }, emptyLists, 'Recommended')).toHaveLength(1)
    expect(filterLeads(leads, { ...defaultFilters, search: 'quill' }, emptyLists, 'Recommended')[0].company_name).toBe('Alpha')
  })

  it('applies industry, funding, headcount and tech filters', () => {
    expect(filterLeads(leads, { ...defaultFilters, industry: 'Software' }, emptyLists, 'Recommended')).toHaveLength(2)
    expect(filterLeads(leads, { ...defaultFilters, funding: 'Seed' }, emptyLists, 'Recommended')[0].company_name).toBe('Beta')
    expect(filterLeads(leads, { ...defaultFilters, headcount: '50-200' }, emptyLists, 'Recommended')[0].company_name).toBe('Beta')
    expect(filterLeads(leads, { ...defaultFilters, techStack: 'react' }, emptyLists, 'Recommended')[0].company_name).toBe('Gamma')
  })

  it('keeps saved companies out of Recommended and shows them under Saved', () => {
    const lists = { ...emptyLists, saved: ['Alpha'] }
    expect(filterLeads(leads, defaultFilters, lists, 'Recommended').map(l => l.company_name)).not.toContain('Alpha')
    expect(filterLeads(leads, defaultFilters, lists, 'Saved').map(l => l.company_name)).toEqual(['Alpha'])
  })

  it('returns nothing for the Manual Adds tab', () => {
    expect(filterLeads(leads, defaultFilters, emptyLists, 'Manual Adds')).toEqual([])
  })
})

describe('toggleMembership', () => {
  it('marking valid removes the company from the other lists', () => {
    const next = toggleMembership({ saved: ['A'], excluded: ['A'], valid: [], invalid: ['A'] }, 'A', 'valid')
    expect(next).toEqual({ saved: [], excluded: [], valid: ['A'], invalid: [] })
  })

  it('toggling an already valid company clears only that list', () => {
    expect(toggleMembership({ saved: ['B'], excluded: [], valid: ['A'], invalid: [] }, 'A', 'valid')).toEqual({ saved: ['B'], excluded: [], valid: [], invalid: [] })
  })

  it('saving and excluding are mutually exclusive', () => {
    expect(toggleMembership({ saved: [], excluded: ['A'], valid: ['A'], invalid: [] }, 'A', 'saved')).toEqual({ saved: ['A'], excluded: [], valid: ['A'], invalid: [] })
    expect(toggleMembership({ saved: ['A'], excluded: [], valid: [], invalid: [] }, 'A', 'excluded')).toEqual({ saved: [], excluded: ['A'], valid: [], invalid: [] })
  })
})

describe('deriveRunState', () => {
  it.each([
    ['Pending', 0, 'running'],
    ['Active', 5, 'running'],
    ['Failed', 0, 'failed'],
    ['Failed', 6, 'partial'],
    ['Completed', 0, 'empty'],
    ['Completed', 14, 'completed'],
  ])('%s with %i leads is %s', (status, count, expected) => {
    expect(deriveRunState(status, count)).toBe(expected)
  })
})

describe('pageSlice', () => {
  it('shows 25 rows per page and reports how many remain', () => {
    const rows = Array.from({ length: 120 }, (_, i) => i)
    expect(PAGE_SIZE).toBe(25)
    expect(pageSlice(rows, 1).visible).toHaveLength(25)
    expect(pageSlice(rows, 1).remaining).toBe(95)
    expect(pageSlice(rows, 5).visible).toHaveLength(120)
    expect(pageSlice(rows, 5).remaining).toBe(0)
  })
})
