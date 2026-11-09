import clsx from 'clsx'
import { X } from 'lucide-react'

/** Removable pills. Each has a stable `data-flip-id` (its text) so a parent `useFlip` can glide them on removal. */
export default function ChipList({ items, label, onRemove, tone = 'neutral' }) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <li key={item} data-flip-id={item.toLowerCase()} className="max-w-full">
          <span
            className={clsx(
              'inline-flex max-w-full items-center gap-1 rounded-full py-1 pl-3 pr-1 text-xs font-semibold ring-1 ring-inset',
              tone === 'ok' ? 'bg-ok-soft text-ok ring-ok/25' : 'bg-head text-ink ring-line',
            )}
          >
            <span className="min-w-0 [overflow-wrap:anywhere]" title={item}>
              {item}
            </span>
            <button type="button" onClick={() => onRemove(i)} aria-label={`Remove ${item}`} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full opacity-80 hover:bg-bad-soft hover:text-bad hover:opacity-100">
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </span>
        </li>
      ))}
    </ul>
  )
}
