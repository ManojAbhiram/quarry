import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle2, MailX } from 'lucide-react'
import { api } from '../api'
import { Button, ErrorState, Skeleton } from '../components/kit'

/** Public page behind the opt-out link in an email footer. Needs no account. */
export default function OptOut() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [state, setState] = useState({ status: token ? 'loading' : 'invalid', email: '', already: false, error: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (!token) return
    let live = true
    api
      .getOptOut(token)
      .then((d) => live && setState({ status: 'ready', email: d.email_masked, already: d.already_opted_out, error: '' }))
      .catch((err) => live && setState({ status: err.status === 400 ? 'invalid' : 'error', email: '', already: false, error: err.message }))
    return () => {
      live = false
    }
  }, [token])

  const confirm = async () => {
    setBusy(true)
    setActionError('')
    try {
      await api.confirmOptOut(token)
      setDone(true)
    } catch (err) {
      setActionError(err.message || 'Could not complete that. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center bg-app px-4 font-sans text-ink">
      <div className="card w-full max-w-md p-6 text-center sm:p-8">
        {state.status === 'loading' && <div role="status" aria-label="Checking your link"><Skeleton className="h-24 w-full" /></div>}
        {state.status === 'invalid' && (
          <ErrorState title="This link is not valid" message="It may be incomplete or have expired. Reply to the message you received and ask to be removed." />
        )}
        {state.status === 'error' && <ErrorState title="Something went wrong" message={state.error} onRetry={() => window.location.reload()} />}
        {state.status === 'ready' && (done || state.already) && (
          <div role="status">
            <CheckCircle2 aria-hidden="true" className="mx-auto mb-3 h-10 w-10 text-ok" />
            <h1 className="text-xl font-black tracking-tight">You have opted out</h1>
            <p className="mt-2 text-sm text-muted"><strong className="break-all text-ink">{state.email}</strong> will not be contacted again by this sender.</p>
          </div>
        )}
        {state.status === 'ready' && !done && !state.already && (
          <>
            <MailX aria-hidden="true" className="mx-auto mb-3 h-10 w-10 text-primary-600 dark:text-primary-400" />
            <h1 className="text-xl font-black tracking-tight">Stop receiving messages?</h1>
            <p className="mt-2 text-sm text-muted">Confirm to stop all messages to <strong className="break-all text-ink">{state.email}</strong> from this sender.</p>
            {actionError && <p role="alert" className="mt-3 text-sm font-medium text-bad">{actionError}</p>}
            <Button className="mt-5 w-full" loading={busy} onClick={confirm}>Opt out</Button>
          </>
        )}
        <p className="mt-6 text-xs text-muted"><Link to="/privacy" className="underline">How we handle personal data</Link></p>
      </div>
    </main>
  )
}
