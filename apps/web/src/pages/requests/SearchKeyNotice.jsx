import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import { api } from '../../api'

/**
 * Whether the account has a Serper search key, read from GET /users/me/serper-key ({ has_key }).
 * Launching a search needs one, and the server only says so at the last step, so we ask early.
 * 'unknown' means the lookup failed: we then say nothing rather than guess.
 */
export function useSearchKey() {
  const [state, setState] = useState('loading') // loading | present | missing | unknown
  useEffect(() => {
    let alive = true
    Promise.resolve()
      .then(() => api.getSerperKey())
      .then((status) => alive && setState(status?.has_key ? 'present' : 'missing'))
      .catch(() => alive && setState('unknown'))
    return () => {
      alive = false
    }
  }, [])
  return state
}

/** An inline notice with a link to Account settings. Renders nothing unless the key is known to be missing. */
export default function SearchKeyNotice({ state, className }) {
  if (state !== 'missing') return null
  return (
    <div role="status" className={`flex items-start gap-3 rounded-md border border-line bg-warn-soft p-3 text-sm text-warn ${className || ''}`}>
      <KeyRound aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="min-w-0">
        <span className="font-semibold">No search key on your account.</span> Finding companies uses your own Serper key, so you can fill this in now but will need one before you launch.{' '}
        <Link to="/profile" className="font-semibold underline">
          Add it in Account settings
        </Link>
      </p>
    </div>
  )
}
