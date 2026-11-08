import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { api } from '../../api'
import { ErrorState, useToast } from '../../components/kit'

/**
 * Shows the user's lead lists; picking one adds `leadIds` to it. Loads the lists when it mounts, blocks a second
 * pick while one is saving, and reports the result with a toast.
 */
export default function ListPicker({ leadIds, onDone }) {
  const toast = useToast()
  const [lists, setLists] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [savingId, setSavingId] = useState(null)

  const load = useCallback(async () => {
    setLoadError(false)
    try {
      const res = await api.getLists()
      setLists(res.lists || [])
    } catch (err) {
      console.error('Failed to load lists:', err)
      setLoadError(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const add = async (list) => {
    if (savingId) return
    const ids = leadIds.map(String).filter(Boolean)
    if (ids.length === 0) {
      toast.push({ type: 'error', message: 'These leads cannot be added to a list yet.' })
      return
    }
    setSavingId(list._id)
    try {
      await api.addLeadsToList(list._id, ids)
      toast.push({ type: 'success', message: `Added ${ids.length} ${ids.length === 1 ? 'lead' : 'leads'} to "${list.name}".` })
      onDone?.()
    } catch (err) {
      console.error('Failed to add to list:', err)
      toast.push({ type: 'error', message: `Could not add to "${list.name}". Please try again.` })
      setSavingId(null)
    }
  }

  return (
    <div className="w-64 max-w-[calc(100vw-2rem)]">
      <p className="border-b border-line px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted">Add to list</p>
      {loadError ? (
        <ErrorState className="py-6" title="Could not load lists" onRetry={load} />
      ) : lists === null ? (
        <div role="status" className="flex items-center gap-2 px-3 py-3 text-sm text-muted">
          <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> Loading lists
        </div>
      ) : lists.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">
          No lists yet. <Link to="/lead-lists" className="font-semibold text-primary-700 underline dark:text-primary-300">Create one</Link>
        </p>
      ) : (
        <ul className="max-h-60 overflow-y-auto py-1">
          {lists.map((list) => (
            <li key={list._id}>
              <button type="button" disabled={Boolean(savingId)} onClick={() => add(list)} className="flex h-10 w-full items-center gap-2 px-3 text-left text-sm text-ink hover:bg-head disabled:opacity-60">
                <span className="min-w-0 flex-1 truncate">{list.name}</span>
                {savingId === list._id ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <span className="text-xs tabular-nums text-muted">{(list.lead_ids || []).length}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
