import { useEffect, useRef, useState } from 'react'
import { Check, Palette } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'
import { PALETTES, swatches } from '../config/palettes'

function Swatch({ id, size = 'w-5 h-5' }) {
  const [a, b, c] = swatches(id)
  return (
    <span className="flex -space-x-1.5 shrink-0" aria-hidden="true">
      {[a, b, c].map((hex, i) => (
        <span key={i} className={`${size} rounded-full ring-2 ring-white dark:ring-slate-900`} style={{ backgroundColor: hex }} />
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
        title="Colour palette"
        className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:border-primary-300 dark:hover:border-primary-700 transition-all duration-300"
      >
        <Palette className="w-4 h-4" />
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-2 w-64 z-50 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-primary-900/10 p-2 animate-fade-in`}
        >
          <p className="px-3 pt-2 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Colour palette</p>
          {PALETTES.map((p) => {
            const active = p.id === palette
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { setPalette(p.id); setOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left transition-colors ${active ? 'bg-primary-50 dark:bg-primary-500/10' : 'hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
              >
                <Swatch id={p.id} />
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-bold text-slate-800 dark:text-slate-100">{p.name}</span>
                  <span className="block text-[10px] text-slate-400 dark:text-slate-500">{p.note}</span>
                </span>
                {active && <Check className="w-4 h-4 text-primary-600 dark:text-primary-400 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
