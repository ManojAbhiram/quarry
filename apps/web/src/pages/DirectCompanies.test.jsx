import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const leads = {}
vi.mock('../context/LeadContext', () => ({ useLeads: () => leads }))
vi.mock('../api', () => ({
  api: { launchDirectCompanies: vi.fn(), parseCompaniesCsv: vi.fn(), getSerperKey: vi.fn() },
}))

import { api } from '../api'
import DirectCompanies from './DirectCompanies'

const setup = () =>
  render(
    <MemoryRouter initialEntries={['/request/abc/companies']}>
      <Routes>
        <Route path="/request/:id/companies" element={<DirectCompanies />} />
        <Route path="/lead-requests" element={<p>Requests page</p>} />
        <Route path="/new-request" element={<p>New request page</p>} />
      </Routes>
    </MemoryRouter>,
  )

describe('DirectCompanies', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(leads, { requests: [{ id: 'abc', title: 'My direct list' }], refreshRequests: vi.fn(() => Promise.resolve([])) })
    api.getSerperKey.mockResolvedValue({ has_key: true })
  })
  afterEach(() => vi.useRealTimers())

  it('adds companies from a comma list, skips duplicates, and removes one', async () => {
    const user = userEvent.setup()
    setup()
    await user.type(screen.getByLabelText(/company names or domains/i), 'Acme Inc, globex.com, acme inc{Enter}')
    expect(screen.getByText('2 companies added')).toBeInTheDocument()
    expect(screen.getByText('1 already in the list, skipped.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Remove globex.com' }))
    expect(screen.getByText('1 company added')).toBeInTheDocument()
  })

  it('refuses to launch without companies and tells the user why', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /find decision makers/i }))
    expect(screen.getByRole('alert')).toHaveTextContent('Add at least one company.')
    expect(api.launchDirectCompanies).not.toHaveBeenCalled()
  })

  it('says so when adding an empty input or an over-long name', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByText('Type a company name or domain first.')).toBeInTheDocument()
    await user.click(screen.getByLabelText(/company names or domains/i))
    await user.paste('x'.repeat(201))
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    expect(screen.getByText(/under 200 characters/i)).toBeInTheDocument()
  })

  it('adds role suggestions and typed roles without duplicates', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(screen.getByRole('button', { name: /^\+?\s*CEO$/ }))
    expect(screen.getByRole('list', { name: 'Roles selected' })).toHaveTextContent('CEO')
    expect(screen.queryByRole('button', { name: /^\+?\s*CEO$/ })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Add a role'), 'ceo{Enter}')
    expect(screen.getAllByText('CEO')).toHaveLength(1)
  })

  it('launches with the request title, roles and draft id, then shows the success state and redirects', async () => {
    const user = userEvent.setup()
    api.launchDirectCompanies.mockResolvedValue({})
    setup()
    await user.type(screen.getByLabelText(/company names or domains/i), 'Acme{Enter}')
    await user.click(screen.getByRole('button', { name: /^\+?\s*Founder$/ }))
    await user.click(screen.getByRole('button', { name: /find decision makers/i }))
    await waitFor(() => expect(api.launchDirectCompanies).toHaveBeenCalledWith({ title: 'My direct list', companies: ['Acme'], target_roles: ['Founder'] }, 'abc'))
    expect(await screen.findByRole('heading', { name: 'Request launched' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /view requests/i }))
    expect(screen.getByText('Requests page')).toBeInTheDocument()
  })

  it('shows a launch error with a link to account settings when the key is the problem', async () => {
    const user = userEvent.setup()
    api.launchDirectCompanies.mockRejectedValue(new Error('Add your Serper API key first'))
    setup()
    await user.type(screen.getByLabelText(/company names or domains/i), 'Acme{Enter}')
    await user.click(screen.getByRole('button', { name: /find decision makers/i }))
    const alert = await screen.findByText(/serper api key first/i)
    expect(alert.closest('[role="alert"]')).toHaveTextContent('Go to Account settings')
    expect(screen.getByRole('button', { name: /find decision makers/i })).toBeEnabled()
  })

  it('merges a parsed CSV, and reports empty, wrong-type and failed files', async () => {
    const user = userEvent.setup({ applyAccept: false })
    setup()
    const input = screen.getByLabelText('Upload a CSV of companies')
    api.parseCompaniesCsv.mockResolvedValueOnce({ companies: ['Initech', 'Hooli'] })
    await user.upload(input, new File(['company_name\nInitech'], 'c.csv', { type: 'text/csv' }))
    expect(await screen.findByText('2 companies added')).toBeInTheDocument()
    api.parseCompaniesCsv.mockResolvedValueOnce({ companies: [] })
    await user.upload(input, new File(['x'], 'empty.csv', { type: 'text/csv' }))
    expect(await screen.findByText(/no company names found/i)).toBeInTheDocument()
    await user.upload(input, new File(['x'], 'notes.txt', { type: 'text/plain' }))
    expect(screen.getByText('Choose a .csv file.')).toBeInTheDocument()
    api.parseCompaniesCsv.mockRejectedValueOnce(new Error('Bad CSV'))
    await user.upload(input, new File(['x'], 'bad.csv', { type: 'text/csv' }))
    expect(await screen.findByText('Bad CSV')).toBeInTheDocument()
  })

  it('warns early when the account has no search key', async () => {
    api.getSerperKey.mockResolvedValue({ has_key: false })
    setup()
    expect(await screen.findByText(/no search key on your account/i)).toBeInTheDocument()
  })
})
