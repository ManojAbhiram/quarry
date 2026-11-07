const BROAD_PERSONAS = ['Economic Buyer', 'Technical Champion', 'Influencer']

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s+-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function getSectionText(section) {
  if (!section) return ''
  if (typeof section === 'string') return section
  if (typeof section === 'object' && section !== null) {
    return section.value || section.text || section.summary || ''
  }
  return ''
}

function splitTitleCandidates(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap(line => {
      const payload = line.replace(/^[•\-\*\d\.\s]+/, '').trim()
      const pieces = payload.split(/,|\/|;|\band\b|\bor\b|\||&/i)
      return pieces.map(piece => piece.trim()).filter(Boolean)
    })
}

function cleanPersonaTitle(title) {
  return String(title || '')
    .replace(/^(decision makers?|buyer titles?|target titles?|target roles?|personas?|roles?|titles?)\s*:\s*/i, '')
    .replace(/^(for|from)\s+(the\s+)?(team structure|icp)\s*:\s*/i, '')
    .replace(/^[•\-\*\d\.\s]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function looksLikeGenericLabel(text) {
  return /^(team|people|roles|persona|personas|buyers?|contacts?|targets?|users?|influencers?|champions?)$/i.test(text)
}

function isBroadPersona(label) {
  return BROAD_PERSONAS.includes(label)
}

export function extractPersonaOptions(icpDimensions) {
  const teamStructureText = getSectionText(icpDimensions?.team_structure)
  const explicitLines = teamStructureText
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /decision maker|buyer title|target title|target role|persona|role|champion|influencer|user/i.test(line))

  const rawCandidates = [
    ...splitTitleCandidates(explicitLines.join('\n')),
    ...splitTitleCandidates(teamStructureText),
  ]

  const normalized = []
  const seen = new Set()
  for (const candidate of rawCandidates) {
    const cleaned = cleanPersonaTitle(candidate)
    if (!cleaned || looksLikeGenericLabel(cleaned)) continue
    const key = normalizeText(cleaned)
    if (seen.has(key)) continue
    seen.add(key)
    normalized.push(cleaned)
  }

  return normalized.length > 0 ? normalized.slice(0, 8) : BROAD_PERSONAS
}

export function classifyPersonaLabel(title, personaOptions = []) {
  const titleText = normalizeText(title)
  if (!titleText) return 'Influencer'

  const explicitOptions = personaOptions.filter(option => !isBroadPersona(option))
  for (const option of explicitOptions) {
    const optionText = normalizeText(option)
    if (!optionText) continue
    if (titleText.includes(optionText) || optionText.includes(titleText)) {
      return option
    }
  }

  if (
    /founder|owner|ceo|chief executive|president|cfo|cro|coo|revenue|sales|general manager|managing director/.test(titleText)
  ) {
    return 'Economic Buyer'
  }

  if (
    /cto|cio|vp engineering|vice president engineering|head of engineering|engineer|architect|data|it|security|devops|platform|product/.test(titleText)
  ) {
    return 'Technical Champion'
  }

  if (explicitOptions.length > 0) {
    return explicitOptions[0]
  }

  return 'Influencer'
}

export function getPersonaBadgeClass(label) {
  if (!label) {
    return 'bg-slate-50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-400 border border-slate-200/60 dark:border-slate-800/60'
  }

  const normalized = normalizeText(label)
  if (normalized.includes('economic buyer')) {
    return 'bg-fuchsia-50 dark:bg-fuchsia-950/20 text-fuchsia-700 dark:text-fuchsia-400 border border-fuchsia-100/60 dark:border-fuchsia-900/30'
  }
  if (normalized.includes('technical champion')) {
    return 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border border-indigo-100/60 dark:border-indigo-900/30'
  }
  if (normalized.includes('influencer')) {
    return 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100/60 dark:border-emerald-900/30'
  }
  return 'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-400 border border-violet-100/60 dark:border-violet-900/30'
}

export function getConfidenceBadgeMeta(contact) {
  let score = 35
  if (contact?.linkedin_url) score += 25
  if (contact?.email) score += 10
  if (contact?.snippet) score += 10
  if (contact?.recent_activity_summary) score += 15
  if (Array.isArray(contact?.recent_posts) && contact.recent_posts.length > 0) score += 5

  score = clamp(score, 0, 100)

  if (score >= 85) {
    return {
      label: 'Verified',
      className: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-100/50',
      score,
    }
  }

  if (score >= 70) {
    return {
      label: 'High',
      className: 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 border border-indigo-100/50',
      score,
    }
  }

  if (score >= 55) {
    return {
      label: 'Medium',
      className: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100/50',
      score,
    }
  }

  return {
    label: 'Review',
    className: 'bg-slate-50 dark:bg-slate-950/30 text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-slate-800/50',
    score,
  }
}

export function getRelevanceScore(contact, leadMatchScore, personaLabel, index = 0) {
  let score = Number(leadMatchScore) || 70

  if (contact?.recent_activity_summary) score += 8
  else if (contact?.snippet) score += 4
  if (contact?.linkedin_url) score += 2
  if (contact?.email) score += 2

  const titleText = normalizeText(contact?.title)
  const personaText = normalizeText(personaLabel)
  if (titleText && personaText && titleText.includes(personaText)) {
    score += 8
  }

  score -= Math.min(index * 2, 12)
  return clamp(Math.round(score), 0, 100)
}

export function decorateDecisionMakerContacts(contacts, { leadMatchScore = 0, personaOptions = [] } = {}) {
  return (contacts || [])
    .map((contact, index) => {
      const personaLabel = classifyPersonaLabel(contact?.title, personaOptions)
      const confidenceMeta = getConfidenceBadgeMeta(contact)
      const relevanceScore = getRelevanceScore(contact, leadMatchScore, personaLabel, index)
      return {
        ...contact,
        persona_label: personaLabel,
        confidence_label: confidenceMeta.label,
        confidence_className: confidenceMeta.className,
        confidence_score: confidenceMeta.score,
        relevance_score: relevanceScore,
      }
    })
    .sort((a, b) => (b.relevance_score || 0) - (a.relevance_score || 0))
}
