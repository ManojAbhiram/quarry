// Helpers for the hiring / funding / tech signals the watch scanner detects (GET /watch/signals).

export const SIGNAL_KINDS = {
  hiring: 'Hiring',
  funding: 'Funding',
  tech: 'Tech change',
}

export const signalLabel = (kind) => SIGNAL_KINDS[kind] || (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Signal')

/** Same normalisation as the API (app.watch.signals.domain_of): lower-case host without a leading www. */
export function domainOf(url) {
  if (!url || typeof url !== 'string') return ''
  try {
    const host = new URL(url.includes('//') ? url : `//${url}`, 'http://x').hostname.toLowerCase()
    return host.startsWith('www.') ? host.slice(4) : host
  } catch {
    return ''
  }
}

/** "Nov 9" style date, or '' when missing or invalid. */
export function signalDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Newest first, then grouped by domain. */
export function groupByDomain(signals) {
  const out = {}
  const sorted = [...(signals || [])].sort((a, b) => String(b.detected_at || '').localeCompare(String(a.detected_at || '')))
  for (const s of sorted) {
    if (!s.domain) continue
    ;(out[s.domain] ||= []).push(s)
  }
  return out
}
