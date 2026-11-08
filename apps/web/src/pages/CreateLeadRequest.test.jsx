import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

vi.mock('../api', () => ({ api: { createLeadRequest: vi.fn(), getSerperKey: vi.fn() } }))
const leads = { requests: [], refreshRequests: vi.fn(() => Promise.resolve()) }
vi.mock('../context/LeadContext', () => ({ useLeads: () => leads }))

import { api } from '../api'
import CreateLeadRequest from './CreateLeadRequest'

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function setup(requests = []) {
  leads.requests = requests
  return render(
    <MemoryRouter initialEntries={['/new-request']}>
      <Routes>
        <Route path="/new-request" element={<CreateLeadRequest />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CreateLeadRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leads.refreshRequests = vi.fn(() => Promise.resolve())
    api.getSerperKey.mockResolvedValue({ has_key: true, masked: 'abcd' })
  })

  it('tells the user early, with a link to Account settings, that a search key is missing', async () => {
    api.getSerperKey.mockResolvedValue({ has_key: false, masked: null })
    setup()
    const note = await screen.findByText(/no search key on your account/i)
    expect(note.closest('[role="status"]').querySelector('a')).toHaveAttribute('href', '/profile')
  })

  it('has a single h1 and a first-request heading for a new account', () => {
    setup([])
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Create your first request')
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeInTheDocument()
  })

  it('offers Cancel once the account has requests', () => {
    setup([{ id: 'x' }])
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('shows an inline error on the name field and does not call the API when the name is empty', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    const name = screen.getByLabelText(/request name/i)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent(/name is required/i)
    expect(api.createLeadRequest).not.toHaveBeenCalled()
  })

  it('clears the name error once the user types', async () => {
    setup()
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    await userEvent.type(screen.getByLabelText(/request name/i), 'Q3')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('creates an ICP request and goes to the intake wizard', async () => {
    api.createLeadRequest.mockResolvedValue({ id: 'new1' })
    setup()
    await userEvent.type(screen.getByLabelText(/request name/i), '  Q3 outreach ')
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/request/new1/intake'))
    expect(api.createLeadRequest).toHaveBeenCalledWith(expect.objectContaining({ name: 'Q3 outreach', request_type: 'icp', description: null }))
    expect(leads.refreshRequests).toHaveBeenCalled()
  })

  it('sends the direct-companies flow to its own workflow', async () => {
    api.createLeadRequest.mockResolvedValue({ id: 'd9' })
    setup()
    await userEvent.click(screen.getByRole('radio', { name: /already have companies/i }))
    await userEvent.type(screen.getByLabelText(/request name/i), 'List')
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/request/d9/companies'))
    expect(api.createLeadRequest).toHaveBeenCalledWith(expect.objectContaining({ request_type: 'direct_companies' }))
  })

  it('shows a loading state and blocks a second submit while creating', async () => {
    let finish
    api.createLeadRequest.mockReturnValue(new Promise((r) => (finish = r)))
    setup()
    await userEvent.type(screen.getByLabelText(/request name/i), 'Slow')
    const button = screen.getByRole('button', { name: /create request/i })
    await userEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(api.createLeadRequest).toHaveBeenCalledTimes(1)
    await act(async () => finish({ id: 's1' }))
  })

  it('shows the server error and lets the user retry', async () => {
    api.createLeadRequest.mockRejectedValueOnce(Object.assign(new Error('Name already used'), { status: 409 })).mockResolvedValueOnce({ id: 'ok1' })
    setup()
    await userEvent.type(screen.getByLabelText(/request name/i), 'Dup')
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Name already used')
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/request/ok1/intake'))
  })

  it('says the server could not be reached on a network error', async () => {
    api.createLeadRequest.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { isNetworkError: true }))
    setup()
    await userEvent.type(screen.getByLabelText(/request name/i), 'Offline')
    await userEvent.click(screen.getByRole('button', { name: /create request/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t reach quarry/i)
  })

  it('hides goal and team size for the direct-companies flow', async () => {
    setup()
    expect(screen.getByLabelText(/primary goal/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /already have companies/i }))
    expect(screen.queryByLabelText(/primary goal/i)).not.toBeInTheDocument()
  })
})
