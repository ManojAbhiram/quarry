import { useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'
import { motion, useReducedMotion } from 'motion/react'
import { Link2 } from 'lucide-react'

const METHODS = {
  page_scrape: 'Read from the company page',
  linkedin_search: 'Found through a LinkedIn search',
  market_signals: 'Found through funding and hiring searches',
  site_probe: 'Detected from the website',
}

function formatWhen(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** The first field in `fields` that has a recorded source. */
export function pickProvenance(provenance, fields) {
  for (const f of [].concat(fields)) {
    const info = provenance?.[f]
    if (info?.source_url) return info
  }
  return null
}

/**
 * A small source marker beside a value. Hover, focus or click opens a popover with where the value came from and
 * when it was retrieved. Renders nothing when no source was recorded for the field(s).
 */
export default function Provenance({ provenance, field, label = 'this value', className }) {
  const info = pickProvenance(provenance, field)
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapRef = useRef(null)
  const id = useId()
  const reduce = useReducedMotion()

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setOpen(false)
        setPinned(false)
      }
    }
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open])

  if (!info) return null
  const when = formatWhen(info.retrieved_at)
  let host = info.source_url
  try {
    host = new URL(info.source_url).hostname.replace(/^www\./, '')
  } catch {
    /* keep the raw value */
  }

  return (
    <span
      ref={wrapRef}
      className={clsx('relative inline-flex align-middle', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => !pinned && setOpen(false)}
    >
      <button
        type="button"
        aria-label={`Where ${label} came from`}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setPinned(!pinned)
          setOpen(!pinned)
        }}
        onFocus={() => setOpen(true)}
        onBlur={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget) && !pinned) setOpen(false)
        }}
        data-provenance={Array.isArray(field) ? field[0] : field}
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-head hover:text-primary-700 focus-visible:text-primary-700 dark:hover:text-primary-300"
      >
        <Link2 aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {open && (
        <motion.div
          id={id}
          role="dialog"
          aria-label={`Source for ${label}`}
          initial={reduce ? false : { opacity: 0, y: 4, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.15 }}
          className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-line bg-surface p-3 text-left shadow-lift"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Source</p>
          <a href={info.source_url} target="_blank" rel="noopener noreferrer" className="mt-0.5 block break-all text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">
            {host}
          </a>
          <p className="break-all text-xs text-muted">{info.source_url}</p>
          <p className="mt-2 text-xs text-ink">{METHODS[info.method] || 'Collected from a public page'}</p>
          {when && <p className="text-xs text-muted">Retrieved {when}</p>}
        </motion.div>
      )}
    </span>
  )
}
