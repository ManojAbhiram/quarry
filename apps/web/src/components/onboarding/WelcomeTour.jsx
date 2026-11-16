import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { api } from '../../api'
import { Button } from '../kit'

const endpoint = '/users/me/onboarding'
const terminal = (tour) => !tour || ['ineligible', 'completed', 'dismissed'].includes(tour.state)
const steps = [
  ['Your workspace', 'Requests tracks your discovery runs. Dashboard brings together workspace activity and results.', ['/lead-requests', '/dashboard']],
  ['Find companies and people', 'Create a request from your ideal customer profile or a company list. Open a request to follow progress and review companies, decision makers and enrichment.', ['/lead-requests']],
  ['Organize your leads', 'Review your results, save leads into Lead lists and export them when you are ready.', ['/lead-lists']],
  ['Follow up and monitor', 'Outreach holds your follow-up work. Watch monitors saved targets and signals.', ['/outreach', '/watch']],
  ['Connect your tools', 'Integrations and CRM integrations connect external tools. In Account, add your Serper and AI provider keys and choose models before work that needs them.', ['/integrations', '/integrations/crm', '/profile']],
  ['Manage your workspace', 'Team manages membership, Billing shows plan and usage, and Compliance provides privacy controls.', ['/team', '/billing', '/compliance']],
]

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
  const persist = useCallback(async (state, step, close = false) => {
    if (busy) return false
    if (close) { setOpen(false); sessionStorage.setItem(sessionKey, 'closed') }
    setBusy(true); setFailure(null)
    try {
      const next = await api.put(endpoint, { state, step, revision: tourRef.current?.revision || 0 })
      if (account.current !== userId || !active.current) return false
      if (close && !terminal(next)) throw new Error('Terminal state was not saved')
      accept(next)
      channel.current?.postMessage({ changed: true })
      return true
    } catch {
      if (account.current === userId && active.current) setFailure({ state, step, close })
      return false
    } finally { if (account.current === userId && active.current) setBusy(false) }
  }, [accept, busy, sessionKey, userId])
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
  dismiss.current = () => persist('dismissed', tourRef.current?.step || 0, true)
  useEffect(() => {
    if (!open) return undefined
    const previous = document.activeElement
    dialog.current?.focus()
    const handleKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); dismiss.current?.(); return }
      if (event.key !== 'Tab') return
      const items = [...(dialog.current?.querySelectorAll('button:not([disabled]), a[href]') || [])]
      const first = items[0], last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', handleKey)
    return () => { document.removeEventListener('keydown', handleKey); if (previous?.isConnected) previous.focus() }
  }, [open])
  const step = Math.max(0, Math.min(5, tour?.step || 0))
  useEffect(() => {
    if (!open) return undefined
    const targets = steps[step][2].flatMap((path) => [...document.querySelectorAll(`a[data-nav-link][href="${path}"]`)])
    targets.forEach((element) => element.classList.add('ring-2', 'ring-primary-500'))
    return () => targets.forEach((element) => element.classList.remove('ring-2', 'ring-primary-500'))
  }, [open, step])
  const finish = async (path) => { if (await persist('completed', step, true)) { if (path) navigate(path) } }
  return <>
    {failure && <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border border-line bg-surface p-4 text-sm text-ink shadow-lg">
      Your tour progress was not saved. {failure.close && 'The tour is closed for this session.'}
      <Button variant="ghost" disabled={busy} onClick={() => persist(failure.state, failure.step, failure.close)}>Retry saving progress</Button>
    </div>}
    {!open && !terminal(tour) && !failure && sessionStorage.getItem(sessionKey) !== 'closed' && <button type="button" className="fixed bottom-4 right-4 z-40 rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink shadow" onClick={async () => {
      try {
        const next = await api.get(endpoint)
        if (account.current !== userId || !active.current || !accept(next)) return
        if (!terminal(next)) { sessionStorage.setItem(sessionKey, 'active'); setOpen(true) }
      } catch { if (account.current === userId && active.current) setFailure({ state: 'in_progress', step, close: false }) }
    }}>Resume introduction</button>}
    {open && createPortal(<div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="quarry-tour-title" aria-describedby="quarry-tour-copy" className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl border border-line bg-surface p-6 text-ink shadow-xl outline-none">
        <p className="text-sm text-muted" aria-live="polite">Welcome to Quarry · {step + 1} of 6</p>
        <h2 id="quarry-tour-title" className="mt-3 text-xl font-semibold">{steps[step][0]}</h2>
        <p id="quarry-tour-copy" className="mt-3 text-sm leading-relaxed text-muted">{steps[step][1]}</p>
        <p className="mt-4 text-xs text-muted">You can explore without connecting services. Nothing runs during this introduction.</p>
        {step === 4 && <Button className="mt-4" variant="secondary" disabled={busy} onClick={() => finish('/profile')}>Open settings</Button>}
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <Button variant="ghost" disabled={busy} onClick={() => persist('dismissed', step, true)}>Skip tour</Button>
          <div className="flex flex-wrap gap-2">
            {step > 0 && <Button variant="secondary" disabled={busy} onClick={() => persist('in_progress', step - 1)}>Back</Button>}
            {step < 5 ? <Button disabled={busy} onClick={() => persist('in_progress', step + 1)}>Next</Button> : <>
              <Button variant="secondary" disabled={busy} onClick={() => finish()}>Explore Quarry</Button>
              <Button disabled={busy} onClick={() => finish('/new-request')}>Create a request</Button>
            </>}
          </div>
        </div>
      </div>
    </div>, document.body)}
  </>
}
