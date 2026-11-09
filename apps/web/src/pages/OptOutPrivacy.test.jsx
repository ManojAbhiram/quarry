import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({ api: { getOptOut: vi.fn(), confirmOptOut: vi.fn() } }))

import { api } from '../api'
import OptOut from './OptOut'
import Privacy from './Privacy'

const at = (url) => render(<MemoryRouter initialEntries={[url]}><OptOut /></MemoryRouter>)

describe('OptOut page', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows an invalid-link message when there is no token', () => {
    at('/opt-out')
    expect(screen.getByText('This link is not valid')).toBeInTheDocument()
    expect(api.getOptOut).not.toHaveBeenCalled()
  })

  it('shows an invalid-link message when the server rejects the token', async () => {
    api.getOptOut.mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }))
    at('/opt-out?token=abc')
    expect(await screen.findByText('This link is not valid')).toBeInTheDocument()
  })

  it('asks to confirm, then confirms the opt-out', async () => {
    const user = userEvent.setup()
    api.getOptOut.mockResolvedValue({ email_masked: 'j***@acme.com', already_opted_out: false })
    api.confirmOptOut.mockResolvedValue({ opted_out: true })
    at('/opt-out?token=abc')
    expect(await screen.findByText('j***@acme.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /opt out/i }))
    await waitFor(() => expect(api.confirmOptOut).toHaveBeenCalledWith('abc'))
    expect(await screen.findByText('You have opted out')).toBeInTheDocument()
  })

  it('shows the confirmation straight away when already opted out, and an error if confirming fails', async () => {
    api.getOptOut.mockResolvedValue({ email_masked: 'j***@acme.com', already_opted_out: true })
    const { unmount } = at('/opt-out?token=abc')
    expect(await screen.findByText('You have opted out')).toBeInTheDocument()
    unmount()

    const user = userEvent.setup()
    api.getOptOut.mockResolvedValue({ email_masked: 'j***@acme.com', already_opted_out: false })
    api.confirmOptOut.mockRejectedValue(new Error('Try later'))
    at('/opt-out?token=abc')
    await user.click(await screen.findByRole('button', { name: /opt out/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Try later')
  })
})

describe('Privacy page', () => {
  it('explains collection, retention and the regional rules without sign-in', () => {
    render(<MemoryRouter><Privacy /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Privacy notice', level: 1 })).toBeInTheDocument()
    expect(screen.getByText(/30 days/)).toBeInTheDocument()
    for (const r of ['EU / EEA', 'United Kingdom', 'Canada', 'India']) expect(screen.getByText(r)).toBeInTheDocument()
  })
})
