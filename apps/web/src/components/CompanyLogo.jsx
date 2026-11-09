import { useState } from 'react'
import clsx from 'clsx'

/** Bare hostname from a URL or domain string ("https://www.acme.io/x" -> "acme.io"); '' if unusable. */
export function domainOf(value) {
  if (!value || typeof value !== 'string') return ''
  const raw = value.trim()
  if (!raw || /^(n\/?a|none|null|unknown|-)$/i.test(raw)) return ''
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, '')
    return host.includes('.') ? host : ''
  } catch {
    return ''
  }
}

/** Logo sources tried in order. The first returns a 404 when a site has no icon, so we fall through cleanly. */
const sources = (domain) => [
  `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=128`,
  `https://icons.duckduckgo.com/ip3/${domain}.ico`,
]

// Domains whose logos failed everywhere this session, so list re-renders do not refetch them.
const failed = new Set()

const GRADIENTS = [
  'from-sky-500 to-indigo-600',
  'from-emerald-500 to-teal-600',
  'from-violet-500 to-fuchsia-600',
  'from-amber-500 to-orange-600',
  'from-rose-500 to-pink-600',
  'from-cyan-500 to-blue-600',
  'from-lime-500 to-green-600',
  'from-indigo-500 to-purple-600',
]

function hash(str) {
  let h = 0
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

function initialsOf(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/**
 * Company logo from the website's domain, with a deterministic gradient monogram when no logo exists.
 * `size` is the Tailwind box (e.g. "h-9 w-9"); decorative, so the name stays the accessible label elsewhere.
 */
export default function CompanyLogo({ name, website, size = 'h-9 w-9', className }) {
  const domain = domainOf(website)
  const [attempt, setAttempt] = useState(() => (domain && failed.has(domain) ? 99 : 0))
  const list = domain ? sources(domain) : []
  const src = list[attempt]

  const next = () => {
    if (attempt + 1 >= list.length) failed.add(domain)
    setAttempt((a) => a + 1)
  }

  // A 16px default favicon blown up to the box looks blurry, so treat tiny images as "no logo".
  const onLoad = (e) => {
    if (e.currentTarget.naturalWidth < 24) next()
  }

  const box = clsx('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-xl', size, className)

  if (src) {
    return (
      <span className={clsx(box, 'bg-white ring-1 ring-line')}>
        <img
          key={src}
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          draggable="false"
          onError={next}
          onLoad={onLoad}
          className="h-full w-full object-contain p-1"
        />
      </span>
    )
  }

  const label = initialsOf(name)
  return (
    <span aria-hidden="true" className={clsx(box, 'bg-gradient-to-br font-bold tracking-tight text-white shadow-sm', GRADIENTS[hash(name || domain || '?') % GRADIENTS.length])}>
      <span className="text-[0.8em] leading-none">{label}</span>
    </span>
  )
}
