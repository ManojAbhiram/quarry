import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api'
import { Button } from '../kit'
import WelcomeTourDialog, { steps } from './WelcomeTourDialog'

const endpoint = '/users/me/onboarding'
const terminal = (tour) => !tour || ['ineligible', 'completed', 'dismissed'].includes(tour.state)

export default function WelcomeTour() {
  const { user, updateUser } = useAuth()
  const navigate = useNavigate()
  const [tour, setTour] = useState(user?.onboarding)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const dialog = useRef(null)
  const active = useRef(false)
  const tourRef = useRef(tour)
  tourRef.current = tour
  const updateRef = useRef(updateUser)
  updateRef.current = updateUser
  const userId = user?.id
  const account = useRef(userId)
  account.current = userId
  const sessionKey = `quarry:tour:${userId}`
  const channel = useRef(null)
  const accept = useCallback((next) => {
    if ((tourRef.current?.revision || 0) > (next?.revision || 0)) return false
    if (['completed', 'dismissed'].includes(tourRef.current?.state) && !terminal(next)) return false
    tourRef.current = next
    setTour(next)
    updateRef.current?.({ onboarding: next })
    if (terminal(next)) setOpen(false)
    return true
  }, [])
  const persist = async ({ state, step, destination }) => {
    if (busy) return false
    const close = state !== 'in_progress'
    if (close) { setOpen(false); sessionStorage.setItem(sessionKey, 'closed') }
    setBusy(true); setFailure(null)
    try {
      const next = await api.put(endpoint, { state, step, revision: tourRef.current?.revision || 0 })
      if (account.current !== userId || !active.current) return false
      if (close && !terminal(next)) throw new Error('Terminal state was not saved')
      accept(next)
      channel.current?.postMessage({ changed: true })
      if (destination) navigate(destination)
      return true
    } catch {
      if (account.current === userId && active.current) setFailure({ state, step, destination })
      return false
    } finally { if (account.current === userId && active.current) setBusy(false) }
  }
  useEffect(() => {
    let live = true
    active.current = true
    const initial = user?.onboarding
    setTour(initial); tourRef.current = initial; setOpen(false); setBusy(false); setFailure(null)
    if (!terminal(initial)) {
      const check = async () => {
        try {
          const next = await api.get(endpoint)
          if (!live) return
          if (!accept(next)) return
          const session = sessionStorage.getItem(sessionKey)
          if (session === 'closed' || terminal(next)) return
          if (next.state === 'eligible') {
            sessionStorage.setItem(sessionKey, 'active')
            const started = await api.put(endpoint, { state: 'in_progress', step: 0, revision: next.revision })
            if (live && accept(started)) setOpen(!terminal(started))
          } else if (session === 'active') setOpen(true)
        } catch { /* A failed eligibility check never opens an unconfirmed overlay. */ }
      }
      check()
    }
    return () => { live = false; active.current = false }
  // Initialize per account, not every time local progress updates the auth context.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, accept, sessionKey])
  useEffect(() => {
    let live = true
    const sync = async () => {
      try { const next = await api.get(endpoint); if (live) accept(next) } catch { /* retry on focus */ }
    }
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel(`quarry-tour-${userId}`)
      channel.current.onmessage = sync
    }
    window.addEventListener('focus', sync)
    return () => { live = false; window.removeEventListener('focus', sync); channel.current?.close(); channel.current = null }
  }, [userId, accept])
  const dismiss = useRef(null)
  dismiss.current = () => persist({ state: 'dismissed', step: tourRef.current?.step || 0 })
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    const app = document.getElementById('root')
    const wasInert = app?.inert
    if (app) app.inert = true
    dialog.current?.focus()
    const handleKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss.current?.(); return }
      if (event.key !== 'Tab') return
      const items = [...(dialog.current?.querySelectorAll('button:not([disabled]), a[href]') || [])]
      const first = items[0], last = items[items.length - 1]
      const outside = !items.includes(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); (last || dialog.current)?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); (first || dialog.current)?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('keydown', handleKey)
      if (app) app.inert = wasInert
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  const step = Math.max(0, Math.min(steps.length - 1, tour?.step || 0))
  const resume = async () => {
    if (busy) return
    setBusy(true); setFailure(null)
    try {
      const next = await api.get(endpoint)
      if (account.current !== userId || !active.current || !accept(next) || terminal(next)) return
      sessionStorage.setItem(sessionKey, 'active')
      const started = next.state === 'eligible'
        ? await api.put(endpoint, { state: 'in_progress', step: 0, revision: next.revision })
        : next
      if (account.current === userId && active.current && accept(started) && !terminal(started)) setOpen(true)
    } catch {
      if (account.current === userId && active.current) setFailure({ resume: true })
    } finally {
      if (account.current === userId && active.current) setBusy(false)
    }
  }
  const retry = () => failure.resume ? resume() : persist(failure)

  return <>
    {!open && failure && <div className="fixed bottom-4 right-4 z-50 ml-4 max-w-sm rounded-lg border border-line bg-surface p-4 text-sm text-ink shadow-lg">
      <p role="alert">{failure.resume ? 'The introduction could not be loaded.' : 'Your tour progress was not saved. The tour is closed for this session.'}</p>
      <Button variant="ghost" size="sm" className="mt-2" disabled={busy} onClick={retry}>{failure.resume ? 'Try again' : 'Retry saving progress'}</Button>
    </div>}
    {!open && !terminal(tour) && !failure && sessionStorage.getItem(sessionKey) !== 'closed' && (
      <Button variant="secondary" className="fixed bottom-4 right-4 z-40" disabled={busy} onClick={resume}>
        Resume introduction <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Button>
    )}
    {open && <WelcomeTourDialog dialog={dialog} step={step} busy={busy} failure={failure} onRetry={retry}
      onMove={(step) => persist({ state: 'in_progress', step })}
      onDismiss={() => dismiss.current()}
      onFinish={(destination) => persist({ state: 'completed', step, destination })}
    />}
  </>
}
