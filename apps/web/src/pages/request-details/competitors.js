// Competitor rows: normalising the API shape and filtering them. Pure, no React.

const present = (v) => v !== undefined && v !== null && v !== ''

export function normalizeCompetitor(result) {
  const website = result.company_website || result.website || '--'
  let name = result.company_name || '--'
  if (name === '--' && result.title) {
    const parts = result.title.split(/\s*[|—-]\s*/)
    const last = parts[parts.length - 1].trim()
    if (last) name = last
  }
  if (name === '--') {
    try {
      const domain = new URL(website).hostname.replace(/^www\./, '')
      const root = domain.split('.')[0]
      name = root.charAt(0).toUpperCase() + root.slice(1)
    } catch {
      name = '--'
    }
  }
  const score = typeof result.overlap_score === 'number' ? result.overlap_score : typeof result.match_score === 'number' ? result.match_score : 0
  const tier = result.tier || (score >= 80 ? 'Direct' : score >= 55 ? 'Adjacent' : 'DIY/Build')
  return {
    name,
    website,
    description: result.description || '--',
    tier,
    overlap_score: score,
    employee_count: result.company_size || result.employee_count || '--',
    headquarters: result.headquarters || result.location || '--',
    g2_rating: present(result.g2_rating) ? result.g2_rating : '--',
    capterra_rating: present(result.capterra_rating) ? result.capterra_rating : '--',
    reason: result.reason || '',
    linkedin_url: result.linkedin_url || '--',
    industry: result.industry || '--',
    company_type: result.company_type || '--',
    founded: result.founded || '--',
    specialties: result.specialties || '--',
  }
}

export const defaultCompetitorFilters = { search: '', tier: 'All', size: 'All', rating: 'All', overlap: 0 }

export function filterCompetitors(competitors, f) {
  const term = (f.search || '').toLowerCase()
  return competitors.filter((c) => {
    if (term && !c.name.toLowerCase().includes(term) && !c.description.toLowerCase().includes(term)) return false
    if (f.tier === 'Direct' && c.tier !== 'Direct') return false
    if (f.tier === 'Adjacent' && c.tier !== 'Adjacent') return false
    if (f.tier === 'DIY' && !c.tier.includes('DIY')) return false
    const n = parseInt(c.employee_count)
    if (f.size === '10-50' && !(n >= 10 && n <= 50)) return false
    if (f.size === '50-200' && !(n > 50 && n <= 200)) return false
    if (f.size === '200+' && !(n > 200)) return false
    if (f.rating !== 'All' && !(typeof c.g2_rating === 'number' && c.g2_rating >= parseFloat(f.rating))) return false
    return c.overlap_score >= f.overlap
  })
}
