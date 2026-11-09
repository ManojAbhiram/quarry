import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api', () => ({
  api: { get: vi.fn(), post: vi.fn(), logout: vi.fn(() => Promise.resolve()) },
}))

import { api } from '../api'
import { AuthProvider, useAuth } from './AuthContext'

function Probe() {
  const { user, loading, bootError, retry } = useAuth()
  return (
    <div>
      <p data-testid="state">{loading ? 'loading' : user ? `user:${user.name}` : 'anonymous'}</p>
      {bootError && <p role="alert">{bootError.message}</p>}
      {bootError && <button onClick={retry}>Try again</button>}
    </div>
  )
}

const renderAuth = () =>
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  )

const serverError = (status, message = 'x') => Object.assign(new Error(message), { status })
const networkError = () => Object.assign(new Error('Failed to fetch'), { isNetworkError: true })

describe('AuthProvider bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is anonymous and not loading when there is no session hint', async () => {
    renderAuth()
    expect(screen.getByTestId('state')).toHaveTextContent('anonymous')
    expect(api.get).not.toHaveBeenCalled()
  })

  it('loads the user when the session is valid', async () => {
    localStorage.setItem('session', '1')
    api.get.mockResolvedValueOnce({ name: 'Asha' })
    renderAuth()
    expect(screen.getByTestId('state')).toHaveTextContent('loading')
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('user:Asha'))
  })

  it('signs out when the server rejects the session (401)', async () => {
    localStorage.setItem('session', '1')
    localStorage.setItem('token', 'legacy')
    localStorage.setItem('refresh_token', 'legacy')
    api.get.mockRejectedValueOnce(serverError(401, 'Invalid token'))
    renderAuth()
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('anonymous'))
    expect(localStorage.getItem('session')).toBeNull()
    expect(localStorage.getItem('token')).toBeNull() // legacy tokens are wiped too
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })

  it('keeps the session when the network is down, and lets the user retry', async () => {
    localStorage.setItem('session', '1')
    api.get.mockRejectedValueOnce(networkError())
    renderAuth()

    expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch')
    expect(localStorage.getItem('session')).toBe('1')
    expect(screen.getByTestId('state')).not.toHaveTextContent('loading')

    api.get.mockResolvedValueOnce({ name: 'Asha' })
    await act(async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('user:Asha'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps the session on a server error (503) instead of signing the user out', async () => {
    localStorage.setItem('session', '1')
    api.get.mockRejectedValueOnce(serverError(503, 'Service unavailable'))
    renderAuth()
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable')
    expect(localStorage.getItem('session')).toBe('1')
  })
})
