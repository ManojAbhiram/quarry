import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../api', () => ({
  api: {
    getSuppressions: vi.fn(),
    addSuppression: vi.fn(),
    removeSuppression: vi.fn(),
    makeOptOutLink: vi.fn(),
    erasePerson: vi.fn(),
    getAuditLog: vi.fn(),
    runRetention: vi.fn(),
  },
}))

import { api } from '../api'
import { ToastProvider } from '../components/kit'
import Compliance from './Compliance'

const setup = () => render(<MemoryRouter><ToastProvider><Compliance /></ToastProvider></MemoryRouter>)
const item = { id: 's1', value: 'jane@acme.com', kind: 'email', reason: 'asked', source: 'opt_out', created_at: '2026-01-02T10:00:00' }

describe('Compliance page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getSuppressions.mockResolvedValue({ items: [item], total: 1 })
    api.getAuditLog.mockResolvedValue({ items: [] })
  })

  it('lists suppressed addresses with their source', async () => {
    setup()
    expect(await screen.findByText('jane@acme.com')).toBeInTheDocument()
    expect(screen.getByText(/Source: opt out/)).toBeInTheDocument()
    expect(await screen.findByText('No actions yet')).toBeInTheDocument()
  })

  it('shows an empty state and an error state with retry', async () => {
    api.getSuppressions.mockResolvedValueOnce({ items: [], total: 0 })
    const { unmount } = setup()
    expect(await screen.findByText('Nothing suppressed yet')).toBeInTheDocument()
    unmount()
    api.getSuppressions.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ items: [item], total: 1 })
    setup()
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByText('jane@acme.com')).toBeInTheDocument()
  })

  it('adds an entry and reloads; shows the server error inline', async () => {
    const user = userEvent.setup()
    api.addSuppression.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('That does not look like a domain'))
    setup()
    await screen.findByText('jane@acme.com')
    await user.type(screen.getByLabelText(/email or domain/i), 'acme.com')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(api.addSuppression).toHaveBeenCalledWith('acme.com', ''))
    await waitFor(() => expect(api.getSuppressions).toHaveBeenCalledTimes(2))
    await user.type(screen.getByLabelText(/email or domain/i), 'bad')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(await screen.findByText(/does not look like a domain/i)).toBeInTheDocument()
  })

  it('removes an entry', async () => {
    const user = userEvent.setup()
    api.removeSuppression.mockResolvedValue(null)
    setup()
    await user.click(await screen.findByRole('button', { name: /remove jane@acme.com/i }))
    await waitFor(() => expect(api.removeSuppression).toHaveBeenCalledWith('jane@acme.com'))
    await waitFor(() => expect(screen.queryByText('jane@acme.com')).not.toBeInTheDocument())
  })

  it('makes an opt-out link only for a full email address', async () => {
    const user = userEvent.setup()
    api.makeOptOutLink.mockResolvedValue({ url: 'http://x/opt-out?token=abc' })
    setup()
    await screen.findByText('jane@acme.com')
    await user.type(screen.getByLabelText(/email or domain/i), 'acme.com')
    await user.click(screen.getByRole('button', { name: /opt-out link/i }))
    expect(await screen.findByText(/full email address/i)).toBeInTheDocument()
    await user.clear(screen.getByLabelText(/email or domain/i))
    await user.type(screen.getByLabelText(/email or domain/i), 'jane@acme.com')
    await user.click(screen.getByRole('button', { name: /opt-out link/i }))
    expect(await screen.findByText('http://x/opt-out?token=abc')).toBeInTheDocument()
  })

  it('erases a person only after confirmation and reports what was deleted', async () => {
    const user = userEvent.setup()
    api.erasePerson.mockResolvedValue({ decision_makers_deleted: 2, leads_email_cleared: 1 })
    setup()
    await screen.findByText('jane@acme.com')
    await user.type(screen.getByLabelText(/^email address$/i), 'not-an-email')
    await user.click(screen.getByRole('button', { name: /erase data/i }))
    expect(await screen.findByText(/full email address/i)).toBeInTheDocument()
    expect(api.erasePerson).not.toHaveBeenCalled()

    await user.clear(screen.getByLabelText(/^email address$/i))
    await user.type(screen.getByLabelText(/^email address$/i), 'bob@acme.com')
    await user.click(screen.getByRole('button', { name: /erase data/i }))
    const dialog = await screen.findByRole('dialog')
    expect(api.erasePerson).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: /^erase$/i }))
    await waitFor(() => expect(api.erasePerson).toHaveBeenCalledWith('bob@acme.com', true))
    expect(await screen.findByText(/Deleted 2 contacts/)).toBeInTheDocument()
  })

  it('shows audit entries without a raw address and runs the retention purge', async () => {
    const user = userEvent.setup()
    api.getAuditLog.mockResolvedValue({ items: [{ id: 'a1', action: 'erase_person', created_at: '2026-01-02T10:00:00', details: { subject_masked: 'j***@acme.com', decision_makers_deleted: 1, leads_email_cleared: 0 } }] })
    api.runRetention.mockResolvedValue({ leads_deleted: 3 })
    setup()
    expect(await screen.findByText(/Erased a person: j\*\*\*@acme.com/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /delete expired leads now/i }))
    await waitFor(() => expect(api.runRetention).toHaveBeenCalledWith(false))
    expect(await screen.findByText('3 expired leads deleted.')).toBeInTheDocument()
  })
})
