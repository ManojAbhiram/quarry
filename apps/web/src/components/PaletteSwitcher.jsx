import { useEffect, useRef, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { PALETTES, swatches } from '../config/palettes'

function Swatch({ id, size = 'w-5 h-5' }) {
  const [a, b, c] = swatches(id)
  return (
    <span className="flex -space-x-1.5 shrink-0" aria-hidden="true">
      {[a, b, c].map((hex, i) => (
        <span key={i} className={`${size} rounded-full ring-2 ring-surface`} style={{ backgroundColor: hex }} />
      ))}
    </span>
  )
}

export default function PaletteSwitcher({ align = 'right' }) {
  const { palette, setPalette } = useTheme()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Colour palette"
        className="header-control flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface/80 text-muted shadow-sm transition-all duration-200 hover:bg-surface hover:text-ink hover:shadow-md active:scale-95"
      >
        <Palette aria-hidden="true" className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className={`palette-menu absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full z-50 mt-2 w-64 animate-pop-in ${align === 'right' ? 'origin-top-right' : 'origin-top-left'} rounded-2xl border border-white/60 bg-surface/95 p-2 shadow-2xl shadow-primary-900/10 ring-1 ring-line/50 backdrop-blur-xl dark:border-line`}
        >
          <p className="px-3 pb-1.5 pt-2 text-xs font-semibold uppercase tracking-wide text-muted">Colour palette</p>
          {PALETTES.map((p) => {
            const active = p.id === palette
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { setPalette(p.id); setOpen(false) }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${active ? 'bg-primary-50 dark:bg-primary-950/60' : 'hover:bg-head'}`}
              >
                <Swatch id={p.id} />
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-semibold text-ink">{p.name}</span>
                  <span className="block text-xs text-muted">{p.note}</span>
                </span>
                {active && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-700 dark:text-primary-300" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
