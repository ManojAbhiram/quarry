import { useState } from 'react'
import { Ban, Bookmark, List, MoreHorizontal, ThumbsDown, ThumbsUp } from 'lucide-react'
import { Menu } from '../../components/kit'
import ListPicker from './ListPicker'

/** The menu items for one lead; each reflects the current state ("Remove from saved" vs "Save"). */
export function actionItems(flags) {
  return [
    { kind: 'valid', label: flags.valid ? 'Remove valid mark' : 'Mark as valid', Icon: ThumbsUp },
    { kind: 'invalid', label: flags.invalid ? 'Remove invalid mark' : 'Mark as invalid', Icon: ThumbsDown },
    { kind: 'saved', label: flags.saved ? 'Remove from saved' : 'Save company', Icon: Bookmark },
    { kind: 'excluded', label: flags.excluded ? 'Remove from excluded' : 'Exclude company', Icon: Ban },
  ]
}

function Panel({ flags, onToggle, leadIds, close }) {
  const [view, setView] = useState('actions')
  if (view === 'lists') return <ListPicker leadIds={leadIds} onDone={close} />
  return (
    <div className="w-56 py-1" role="group" aria-label="Lead actions">
      {actionItems(flags).map(({ kind, label, Icon }) => (
        <button key={kind} type="button" onClick={() => { onToggle(kind); close() }} className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-head">
          <Icon aria-hidden="true" className="h-4 w-4 text-muted" />
          {label}
        </button>
      ))}
      <button type="button" onClick={() => setView('lists')} className="flex h-10 w-full items-center gap-2 border-t border-line px-3 text-left text-sm text-ink hover:bg-head">
        <List aria-hidden="true" className="h-4 w-4 text-muted" />
        Add to list…
      </button>
    </div>
  )
}

/** A "more actions" menu for one lead row. */
export default function LeadActionsMenu({ name, flags, onToggle, leadIds }) {
  return (
    <Menu
      label={`Actions for ${name}`}
      buttonClassName="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-head hover:text-ink md:h-8 md:w-8"
      button={<MoreHorizontal aria-hidden="true" className="h-4 w-4" />}
    >
      {({ close }) => <Panel flags={flags} onToggle={onToggle} leadIds={leadIds} close={close} />}
    </Menu>
  )
}

/** The four list marks as short text tags, so state is readable without colour. */
export function FlagTags({ flags }) {
  const tags = [
    flags.saved && 'Saved',
    flags.excluded && 'Excluded',
    flags.valid && 'Valid',
    flags.invalid && 'Invalid',
  ].filter(Boolean)
  if (tags.length === 0) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((t) => (
        <span key={t} className="rounded-md border border-line px-1.5 py-0.5 text-xs font-medium text-muted">{t}</span>
      ))}
    </span>
  )
}
