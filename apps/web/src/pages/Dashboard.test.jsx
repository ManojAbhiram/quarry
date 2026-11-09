import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const leads = {}
vi.mock('../context/LeadContext', () => ({ useLeads: () => leads }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Dana Demo' } }) }))

import Dashboard from './Dashboard'

const REQS = [
  { id: 'r1', title: 'Healthy run', status: 'Completed' },
  { id: 'r2', title: 'Going now', status: 'Active' },
  { id: 'r3', title: 'Broken', status: 'Failed' },
]

function Where() {
  const loc = useLocation()
  return <p data-testid="where">{loc.pathname + (loc.state?.filter ? `|${loc.state.filter}` : '')}</p>
}

function setup(over = {}) {
  Object.assign(leads, {
    requests: REQS,
    stats: { totalLeads: 3, pending: 1, completed: 1, failed: 1 },
    refreshRequests: vi.fn(() => Promise.resolve(REQS)),
    ...over,
  })
  return render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Dashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows the figures from the API stats and a link to each filter', async () => {
    const user = userEvent.setup()
    setup()
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Dana Demo')
    const failed = document.getElementById('summary-failed')
    expect(failed).toHaveTextContent('1')
    await user.click(failed)
    expect(screen.getByTestId('where')).toHaveTextContent('/lead-requests|Failed')
  })

  it('shows the running request in the pipeline panel and opens it', async () => {
    const user = userEvent.setup()
    setup()
    const panel = await screen.findByRole('region', { name: /active pipeline/i })
    expect(panel).toHaveTextContent('Going now')
    expect(panel).toHaveTextContent('Running')
    await user.click(screen.getByRole('button', { name: /follow progress/i }))
    expect(screen.getByTestId('where')).toHaveTextContent('/request/r2')
  })

  it('says so when nothing is running, and when there are no requests at all', async () => {
    setup({ requests: [], refreshRequests: vi.fn(() => Promise.resolve([])), stats: { totalLeads: 0, pending: 0, completed: 0, failed: 0 } })
    expect(await screen.findByText('No active pipeline')).toBeInTheDocument()
    expect(screen.getByText('No requests yet')).toBeInTheDocument()
    expect(screen.getByText('No finished runs yet')).toBeInTheDocument()
  })

  it('shows a loading state, then an error with a working retry', async () => {
    const user = userEvent.setup()
    const refresh = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce(REQS)
    setup({ requests: [], refreshRequests: refresh })
    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your overview')
    await user.click(screen.getByRole('button', { name: /try again/i }))
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('No active pipeline')).toBeInTheDocument()
  })

  it('keeps showing the last figures, with a notice, when a refresh fails', async () => {
    setup({ refreshRequests: vi.fn(() => Promise.resolve(undefined)) })
    expect(await screen.findByText(/could not refresh/i)).toBeInTheDocument()
    expect(screen.getByText('Healthy run')).toBeInTheDocument()
  })

  it('handles a very long request title without losing the status', async () => {
    const long = 'M'.repeat(200)
    setup({ requests: [{ id: 'x', title: long, status: 'Pending' }] })
    const panel = await screen.findByRole('region', { name: /active pipeline/i })
    expect(panel).toHaveTextContent(long)
    expect(panel).toHaveTextContent('Pending')
  })
})
