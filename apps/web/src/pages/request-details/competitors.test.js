import { describe, it, expect } from 'vitest'
import { normalizeCompetitor, filterCompetitors, defaultCompetitorFilters } from './competitors'

describe('normalizeCompetitor', () => {
  it('derives a name from the website when none is given', () => {
    expect(normalizeCompetitor({ company_website: 'https://www.rivalco.io/pricing' }).name).toBe('Rivalco')
  })

  it('assigns a tier from the overlap score when the API gives none', () => {
    expect(normalizeCompetitor({ company_name: 'A', overlap_score: 90 }).tier).toBe('Direct')
    expect(normalizeCompetitor({ company_name: 'A', overlap_score: 60 }).tier).toBe('Adjacent')
    expect(normalizeCompetitor({ company_name: 'A', overlap_score: 10 }).tier).toBe('DIY/Build')
  })

  it('keeps a zero rating instead of treating it as missing', () => {
    expect(normalizeCompetitor({ company_name: 'A', g2_rating: 0 }).g2_rating).toBe(0)
    expect(normalizeCompetitor({ company_name: 'A' }).g2_rating).toBe('--')
  })
})

describe('filterCompetitors', () => {
  const rows = ['Direct', 'Adjacent', 'DIY/Build'].map((tier, i) => normalizeCompetitor({ company_name: `C${i}`, tier, overlap_score: 90 - i * 30 }))

  it('filters by tier and by minimum overlap', () => {
    expect(filterCompetitors(rows, { ...defaultCompetitorFilters, tier: 'DIY' })).toHaveLength(1)
    expect(filterCompetitors(rows, { ...defaultCompetitorFilters, overlap: 50 })).toHaveLength(2)
  })

  it('searches by name', () => {
    expect(filterCompetitors(rows, { ...defaultCompetitorFilters, search: 'c1' })[0].name).toBe('C1')
  })
})
