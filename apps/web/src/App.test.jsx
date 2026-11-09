import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal()),
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    logout: vi.fn(() => Promise.resolve()),
  },
}))

import { api } from './api'
import App from './App'

const networkError = () => Object.assign(new Error('Failed to fetch'), { isNetworkError: true })

describe('App routing and boot', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.pushState({}, '', '/')
  })

  it('shows a 404 page for an unknown URL instead of silently redirecting', async () => {
    window.history.pushState({}, '', '/this-does-not-exist')
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })

  it('shows a labelled loading state while the saved session is being checked', async () => {
    localStorage.setItem('session', '1')
    api.get.mockReturnValue(new Promise(() => {})) // never answers
    render(<App />)
    expect(await screen.findByRole('status')).toHaveTextContent('Loading')
  })

  it('shows an error with a retry when the server cannot be reached, and keeps the user signed in', async () => {
    localStorage.setItem('session', '1')
    api.get.mockRejectedValueOnce(networkError())
    render(<App />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Quarry")
    expect(localStorage.getItem('session')).toBe('1')

    api.get.mockImplementation((path) => Promise.resolve(path === '/users/me' ? { name: 'Asha', email: 'a@b.co' } : []))
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Can't reach Quarry")).not.toBeInTheDocument())
    expect(api.get.mock.calls.filter(([path]) => path === '/users/me')).toHaveLength(2) // the retry asked the server again
  })

  it('sends a signed-out visitor from the app root to the login page', async () => {
    render(<App />)
    expect(await screen.findByText(/welcome back/i)).toBeInTheDocument()
  })
})
