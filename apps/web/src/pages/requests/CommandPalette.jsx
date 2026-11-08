import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Search } from 'lucide-react'
import { StatusBadge } from '../../components/kit'

/** Ctrl/Cmd+K quick switcher between requests. Focus moves to the search box and returns on close. */
export default function CommandPalette({ open, query, onQuery, requests, onPick, onClose }) {
  const inputRef = useRef(null)
  const returnTo = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    returnTo.current = document.activeElement
    inputRef.current?.focus()
    return () => {
      const el = returnTo.current
      if (el && document.contains(el)) el.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-20">
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Switch request" className="relative w-full max-w-lg overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={inputRef}
            type="search"
            aria-label="Search requests"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search requests, goals or descriptions"
            className="h-12 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/80"
          />
        </div>
        <ul className="max-h-80 overflow-y-auto p-2">
          {requests.length > 0 ? (
            requests.map((r) => (
              <li key={r.id || r._id}>
                <button type="button" onClick={() => onPick(r)} className="flex min-h-[2.75rem] w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-head">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ink" title={r.title || r.name}>
                      {r.title || r.name || 'Untitled request'}
                    </span>
                    {r.description && <span className="block truncate text-xs text-muted">{r.description}</span>}
                  </span>
                  <StatusBadge status={r.status === 'Active' ? 'running' : r.status} />
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-8 text-center text-sm text-muted">No matching requests.</li>
          )}
        </ul>
      </div>
    </div>,
    document.body,
  )
}
