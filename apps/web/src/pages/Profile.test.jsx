import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../components/kit'

const auth = {}
vi.mock('../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../api', () => ({
  api: { getSerperKey: vi.fn(), setSerperKey: vi.fn(), deleteSerperKey: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}))

import { api } from '../api'
import Profile from './Profile'

const setup = () => render(<ToastProvider><Profile /></ToastProvider>)

describe('Profile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(auth, {
      user: { name: 'Dana Demo', email: 'dana@acme.io', company: '', job_title: '', phone: '' },
      logout: vi.fn(),
      updateUser: vi.fn(),
    })
    api.getSerperKey.mockResolvedValue({ has_key: false, masked: null })
  })

  it('shows who you are and disables save until something changes', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Dana Demo')
    expect(screen.getByLabelText(/email address/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    await user.type(screen.getByLabelText(/company/i), 'Acme')
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('validates name and phone inline and does not call the API', async () => {
    const user = userEvent.setup()
    setup()
    await user.clear(screen.getByLabelText(/full name/i))
    await user.type(screen.getByLabelText(/phone/i), 'call me')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(screen.getByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText(/digits, spaces/i)).toBeInTheDocument()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('saves the profile and updates the user', async () => {
    const user = userEvent.setup()
    api.put.mockResolvedValue({ name: 'Dana Demo', company: 'Acme' })
    setup()
    await user.type(screen.getByLabelText(/company/i), 'Acme')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/users/me', expect.objectContaining({ company: 'Acme', job_title: null })))
    expect(auth.updateUser).toHaveBeenCalled()
    expect(await screen.findByText('Profile saved.')).toBeInTheDocument()
  })

  it('shows a save error from the server', async () => {
    const user = userEvent.setup()
    api.put.mockRejectedValue(new Error('Email already in use'))
    setup()
    await user.type(screen.getByLabelText(/company/i), 'Acme')
    await user.click(screen.getByRole('button', { name: /save changes/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already in use')
  })

  it('shows key status from has_key, and a retry when the lookup fails', async () => {
    const user = userEvent.setup()
    api.getSerperKey.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ has_key: true, masked: 'abcd…wxyz' })
    setup()
    expect(await screen.findByText('Could not check your key.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('abcd…wxyz')).toBeInTheDocument()
  })

  it('validates the key, saves it, and shows the rejected-key message', async () => {
    const user = userEvent.setup()
    api.setSerperKey.mockRejectedValueOnce(new Error('That Serper API key was rejected.')).mockResolvedValueOnce({ has_key: true, masked: 'k…y' })
    setup()
    expect(await screen.findByText(/not set/i)).toBeInTheDocument()
    await user.type(screen.getByLabelText(/serper api key/i), 'bad key')
    await user.click(screen.getByRole('button', { name: /save key/i }))
    expect(screen.getByText(/no spaces/i)).toBeInTheDocument()
    expect(api.setSerperKey).not.toHaveBeenCalled()
    await user.clear(screen.getByLabelText(/serper api key/i))
    await user.type(screen.getByLabelText(/serper api key/i), 'badkey')
    await user.click(screen.getByRole('button', { name: /save key/i }))
    expect(await screen.findByText('That Serper API key was rejected.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /save key/i }))
    expect(await screen.findByText('Connected')).toBeInTheDocument()
    expect(screen.getByLabelText(/serper api key/i)).toHaveValue('')
  })

  it('asks before removing the key, then clears it', async () => {
    const user = userEvent.setup()
    api.getSerperKey.mockResolvedValue({ has_key: true, masked: 'k…y' })
    api.deleteSerperKey.mockResolvedValue({ has_key: false, masked: null })
    setup()
    await user.click(await screen.findByRole('button', { name: /remove key/i }))
    expect(api.deleteSerperKey).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove key' }))
    expect(await screen.findByText(/not set/i)).toBeInTheDocument()
  })

  it('asks before deleting the account and signs out after', async () => {
    const user = userEvent.setup()
    api.delete.mockResolvedValue(null)
    setup()
    await user.click(screen.getByRole('button', { name: /delete account/i }))
    const dialog = screen.getByRole('dialog')
    expect(api.delete).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete account' }))
    await waitFor(() => expect(auth.logout).toHaveBeenCalled())
  })

  it('keeps the account when deletion fails', async () => {
    const user = userEvent.setup()
    api.delete.mockRejectedValue(new Error('Server error'))
    setup()
    await user.click(screen.getByRole('button', { name: /delete account/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete account' }))
    expect(await screen.findByText('Server error')).toBeInTheDocument()
    expect(auth.logout).not.toHaveBeenCalled()
  })

  it('sends a password reset link and confirms it', async () => {
    const user = userEvent.setup()
    api.post.mockResolvedValue({})
    setup()
    await user.click(screen.getByRole('button', { name: /email me a reset link/i }))
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'dana@acme.io' })
    expect(await screen.findByText(/link is on its way/i)).toBeInTheDocument()
  })
})
