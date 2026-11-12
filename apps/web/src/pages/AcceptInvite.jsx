import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { api } from '../api'
import { STORAGE_KEYS } from '../config/constants'
import { useAuth } from '../context/AuthContext'
import { useOrg } from '../context/OrgContext'
import { Button, ErrorState } from '../components/kit'
import BrandLogo from '../components/BrandLogo'

/** Landing page for an invite link. Signed-out visitors sign in first; the token is kept until they do. */
export default function AcceptInvite() {
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const { user } = useAuth()
  const { refresh, switchOrg } = useOrg()
  const navigate = useNavigate()
  const [state, setState] = useState({ status: 'idle', error: '' }) // idle | joining | error

  useEffect(() => {
    if (!user && token) {
      try {
        localStorage.setItem(STORAGE_KEYS.PENDING_INVITE, token)
      } catch {
        /* without storage the user can reopen the link after signing in */
      }
    }
  }, [user, token])

  const accept = async () => {
    setState({ status: 'joining', error: '' })
    try {
      const org = await api.post('/orgs/invites/accept', { token })
      await refresh()
      switchOrg(org.id)
      navigate('/team')
    } catch (err) {
      setState({ status: 'error', error: err.message || 'Could not accept the invite.' })
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-app px-4 font-sans text-ink">
      <div className="card w-full max-w-md p-8 text-center">
        <BrandLogo className="mx-auto mb-5 h-12 w-12" />
        {!token ? (
          <ErrorState title="Invite link incomplete" message="This link is missing its token. Ask for a new invite." className="py-4" />
        ) : (
          <>
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
              <MailCheck aria-hidden="true" className="h-6 w-6" />
            </span>
            <h1 className="text-2xl font-black tracking-tight">Join your team on Quarry</h1>
            {user ? (
              <>
                <p className="mt-2 text-sm text-muted">Signed in as {user.email}. The invite must have been sent to this address.</p>
                {state.status === 'error' && <p role="alert" className="mt-4 rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">{state.error}</p>}
                <Button className="mt-6 w-full" loading={state.status === 'joining'} onClick={accept}>Accept invitation</Button>
              </>
            ) : (
              <>
                <p className="mt-2 text-sm text-muted">Sign in or create an account with the email address that received the invite. You will join automatically.</p>
                <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                  <Link to="/login" className="btn-primary flex-1">Sign in</Link>
                  <Link to="/register" className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-semibold hover:bg-head">Create account</Link>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </main>
  )
}
