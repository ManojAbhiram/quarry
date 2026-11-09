import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Button, ErrorState } from '../components/kit'

/** OAuth return URL: exchanges the `code` HubSpot sent back, then goes to the integrations page. */
export default function HubspotCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const code = params.get('code')
    if (!code) {
      setError(params.get('error_description') || 'HubSpot did not return an authorization code.')
      return
    }
    api.post('/integrations/hubspot/oauth/callback', { code, state: params.get('state') })
      .then(() => navigate('/integrations', { replace: true }))
      .catch((e) => setError(e.message || 'Could not finish connecting HubSpot.'))
  }, [params, navigate])

  if (error) {
    return (
      <div className="page-container">
        <ErrorState title="HubSpot connection failed" message={error} />
        <div className="text-center"><Button variant="secondary" onClick={() => navigate('/integrations')}>Back to integrations</Button></div>
      </div>
    )
  }
  return <p role="status" className="p-10 text-center text-sm text-muted">Connecting HubSpot…</p>
}
