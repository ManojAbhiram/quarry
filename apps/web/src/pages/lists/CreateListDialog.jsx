import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { Button, Field } from '../../components/kit'
import { NAME_MAX } from './ListCard'

export const LIST_COLORS = [
  ['#6366f1', 'Indigo'], ['#8b5cf6', 'Violet'], ['#ec4899', 'Pink'], ['#f43f5e', 'Rose'], ['#f59e0b', 'Amber'],
  ['#10b981', 'Emerald'], ['#06b6d4', 'Cyan'], ['#3b82f6', 'Blue'], ['#84cc16', 'Lime'], ['#f97316', 'Orange'],
]
const DESC_MAX = 200
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled])'

/** The "new list" form in an accessible modal: focus moves in and is kept inside, Escape cancels, focus returns. */
export default function CreateListDialog({ open, existingNames, onCreate, onClose }) {
  const titleId = useId()
  const ref = useRef(null)
  const returnTo = useRef(null)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [color, setColor] = useState(LIST_COLORS[0][0])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const busy = useRef(false)
  busy.current = saving

  useEffect(() => {
    if (!open) return undefined
    returnTo.current = document.activeElement
    setName('')
    setDesc('')
    setColor(LIST_COLORS[0][0])
    setErrors({})
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (!busy.current) closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !ref.current) return
      const items = [...ref.current.querySelectorAll(FOCUSABLE)]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const el = returnTo.current
      if (el && document.contains(el)) el.focus()
    }
  }, [open])

  if (!open) return null

  const submit = async (e) => {
    e.preventDefault()
    const next = {}
    const trimmed = name.trim()
    if (!trimmed) next.name = 'Give the list a name.'
    else if (trimmed.length > NAME_MAX) next.name = `Keep it under ${NAME_MAX} characters.`
    else if (existingNames.includes(trimmed.toLowerCase())) next.name = 'You already have a list with that name.'
    if (desc.length > DESC_MAX) next.desc = `Keep it under ${DESC_MAX} characters.`
    setErrors(next)
    if (Object.keys(next).length) return
    setSaving(true)
    const error = await onCreate({ name: trimmed, color, description: desc.trim() || null })
    setSaving(false)
    if (error) setErrors({ submit: error })
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div aria-hidden="true" className="absolute inset-0 bg-ink/50 backdrop-blur-sm" onClick={() => !saving && onClose()} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} className="glass relative w-full max-w-md rounded-2xl bg-surface/95 p-6 shadow-lift animate-fade-in">
        <h2 id={titleId} className="text-lg font-black tracking-tight text-ink">
          Create a new list
        </h2>
        <form onSubmit={submit} noValidate className="mt-4 space-y-4">
          <Field
            id="new-list-name"
            label="List name"
            required
            autoFocus
            value={name}
            disabled={saving}
            placeholder="e.g. Enterprise accounts Q3"
            error={errors.name}
            onChange={(e) => {
              setName(e.target.value)
              if (errors.name) setErrors((x) => ({ ...x, name: null }))
            }}
          />
          <Field
            id="new-list-desc"
            label="Description"
            value={desc}
            disabled={saving}
            placeholder="Hot leads to follow up this week"
            hint="Optional."
            error={errors.desc}
            onChange={(e) => {
              setDesc(e.target.value)
              if (errors.desc) setErrors((x) => ({ ...x, desc: null }))
            }}
          />
          <fieldset>
            <legend className="label">Colour</legend>
            <div className="flex flex-wrap gap-1">
              {LIST_COLORS.map(([value, colorName]) => (
                <button
                  key={value}
                  type="button"
                  aria-label={colorName}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                  className="flex h-10 w-10 items-center justify-center rounded-full"
                >
                  <span className={clsx('h-7 w-7 rounded-full shadow-sm transition-transform', color === value ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'hover:scale-110')} style={{ background: value }} />
                </button>
              ))}
            </div>
          </fieldset>
          <div className="flex items-center gap-3 rounded-xl border-2 border-dashed border-line p-3">
            <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} aria-hidden="true" />
            <span className="min-w-0 break-words text-sm font-medium text-ink line-clamp-1">{name || 'Your list name'}</span>
          </div>
          {errors.submit && (
            <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">
              {errors.submit}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button id="submit-create-list" type="submit" loading={saving}>
              {!saving && <Plus aria-hidden="true" className="h-4 w-4" />}
              Create list
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  )
}
