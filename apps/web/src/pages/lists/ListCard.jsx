import { useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronRight, Edit3, Trash2, Users, X } from 'lucide-react'
import { GlowingEffect } from '../../components/ui/glowing-effect'

export const DEFAULT_COLOR = '#6366f1'
export const NAME_MAX = 80

export function formatDate(value) {
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString()
}

const ICON_BTN = 'inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted transition-colors hover:bg-head hover:text-ink'

/**
 * A glass card for one list. The whole body opens the list (a real button); rename and delete are separate
 * buttons beside it. `data-reveal` is on the inner card, `data-flip-id` stays on the parent <li> in the page.
 */
export default function ListCard({ list, active, existingNames, onSelect, onDelete, onRename }) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(list.name)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const color = list.color || DEFAULT_COLOR
  const count = (list.lead_ids || []).length

  const startRename = () => {
    setName(list.name)
    setError('')
    setRenaming(true)
  }

  const submit = async (e) => {
    e.preventDefault()
    const next = name.trim()
    if (!next) return setError('Give the list a name.')
    if (next.length > NAME_MAX) return setError(`Keep it under ${NAME_MAX} characters.`)
    if (next !== list.name && existingNames.includes(next.toLowerCase())) return setError('You already have a list with that name.')
    if (next === list.name) return setRenaming(false)
    setSaving(true)
    const ok = await onRename(list._id, next)
    setSaving(false)
    if (ok) setRenaming(false)
    else setError('Could not rename. Try again.')
  }

  return (
    <div data-reveal>
      <div
        className={clsx(
          'card card-hover group relative overflow-visible p-5 pt-6',
          active && 'ring-2 ring-primary-400/70 shadow-lift',
        )}
      >
        <GlowingEffect spread={36} glow disabled={false} proximity={56} inactiveZone={0.01} borderWidth={2} />
        <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1.5 rounded-t-2xl" style={{ background: `linear-gradient(90deg, ${color}, ${color}66)` }} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
          <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-20 blur-2xl transition-opacity duration-500 group-hover:opacity-40" style={{ background: color }} />
        </div>

        {renaming ? (
          <form onSubmit={submit} noValidate className="relative z-10">
            <label htmlFor={`rename-${list._id}`} className="sr-only">
              List name
            </label>
            <input
              id={`rename-${list._id}`}
              autoFocus
              value={name}
              disabled={saving}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={error ? `rename-${list._id}-err` : undefined}
              onChange={(e) => {
                setName(e.target.value)
                setError('')
              }}
              onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              className="input"
            />
            {error && (
              <p id={`rename-${list._id}-err`} role="alert" className="mt-1.5 text-xs font-medium text-bad">
                {error}
              </p>
            )}
            <div className="mt-2 flex gap-2">
              <button type="submit" disabled={saving} className={clsx(ICON_BTN, 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300')} aria-label="Save name">
                <Check aria-hidden="true" className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setRenaming(false)} className={ICON_BTN} aria-label="Cancel rename">
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </form>
        ) : (
          <div className="relative z-10 flex items-start gap-1">
            <button type="button" onClick={() => onSelect(list._id)} aria-pressed={active} className="min-w-0 flex-1 rounded-lg text-left">
              <span className="block break-words text-base font-bold tracking-tight text-ink line-clamp-2" title={list.name}>
                {list.name}
              </span>
              {list.description && (
                <span className="mt-1 block break-words text-xs text-muted line-clamp-2" title={list.description}>
                  {list.description}
                </span>
              )}
            </button>
            <button type="button" onClick={startRename} className={ICON_BTN} aria-label={`Rename ${list.name}`}>
              <Edit3 aria-hidden="true" className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => onDelete(list)} className={clsx(ICON_BTN, 'hover:bg-bad-soft hover:text-bad')} aria-label={`Delete ${list.name}`}>
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="relative z-10 mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted">
          <span className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-head px-2.5 py-1 text-xs font-semibold text-ink ring-1 ring-inset ring-line">
            <Users aria-hidden="true" className="h-3.5 w-3.5" />
            {count} {count === 1 ? 'lead' : 'leads'}
          </span>
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
          {formatDate(list.created_at) && <span className="whitespace-nowrap text-xs">Created {formatDate(list.created_at)}</span>}
          <ChevronRight aria-hidden="true" className="ml-auto h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </div>
  )
}
