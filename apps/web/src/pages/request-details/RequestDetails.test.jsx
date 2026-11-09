import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const leadsContext = { requests: [], getResults: vi.fn(), refreshRequests: vi.fn(() => Promise.resolve()), globalSearchQuery: '' }
vi.mock('../../context/LeadContext', () => ({ useLeads: () => leadsContext }))
vi.mock('../../api', () => ({
  api: {
    findCompetitors: vi.fn(() => Promise.resolve({ results: [], status: 'completed' })),
    getDecisionMakers: vi.fn(() => Promise.resolve({ decision_makers: [] })),
    updateRequestLists: vi.fn(() => Promise.resolve()),
    getLists: vi.fn(() => Promise.resolve({ lists: [] })),
    exportCompanies: vi.fn(() => Promise.resolve()),
    analyzeIntent: vi.fn(),
    verifyAndSaveLeadEmail: vi.fn(),
  },
}))

import { ToastProvider } from '../../components/kit'
import RequestDetails from '../RequestDetails'

const makeLeads = (n) =>
  Array.from({ length: n }, (_, i) => ({
    _id: `id-${i}`,
    company_name: `Company ${String(i).padStart(3, '0')}`,
    industry: i % 2 ? 'Software' : 'Retail',
    match_score: String(100 - (i % 50)),
    contact_name: `Person ${i}`,
    contact_title: 'CEO',
    email: `p${i}@c${i}.example`,
    email_verified: true,
    email_confidence: i % 2 ? 'high' : 'medium',
    match_explanation: 'Short reason.',
  }))

function renderPage(request, leads, { keepMock = false } = {}) {
  leadsContext.requests = request ? [{ id: 'r1', title: 'Test run', business_type: 'Agencies', ...request }] : []
  if (!keepMock) leadsContext.getResults.mockResolvedValue({ leads, competitors: [], queries: [] })
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/request/r1']}>
        <Routes>
          <Route path="/request/:id" element={<RequestDetails />} />
          <Route path="/request/:id/intake" element={<p>Intake page</p>} />
        </Routes>
      </MemoryRouter>
    </ToastProvider>,
  )
}

describe('RequestDetails', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a loading state, then the companies with a text email status', async () => {
    renderPage({ status: 'Completed' }, makeLeads(3))
    expect(screen.getByRole('status', { name: 'Loading results' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Test run', level: 1 })).toBeInTheDocument()
    const table = screen.getByRole('table')
    expect(within(table).getAllByText('Verified').length).toBeGreaterThan(0)
    expect(within(table).getAllByText('Likely').length).toBeGreaterThan(0)
  })

  it('shows an in-progress banner while the run is active', async () => {
    renderPage({ status: 'Active' }, [])
    expect(await screen.findByText('Run in progress')).toBeInTheDocument()
  })

  it('shows the failure reason and what to do next when a run failed with no leads', async () => {
    renderPage({ status: 'Failed', failure_reason: 'Your Serper key was rejected (401).' }, [])
    expect(await screen.findByText('Your Serper key was rejected (401).')).toBeInTheDocument()
    expect(screen.getByText(/start a new run/i)).toBeInTheDocument()
  })

  it('treats a failed run that kept leads as partial: banner plus the normal table', async () => {
    renderPage({ status: 'Failed', failure_reason: 'Search quota ran out.' }, makeLeads(6))
    expect(await screen.findByText('Run stopped early, 6 leads were kept')).toBeInTheDocument()
    expect(screen.getByText('Search quota ran out.')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
  })

  it('explains an empty completed run and offers a way back to edit', async () => {
    renderPage({ status: 'Completed' }, [])
    expect(await screen.findByText('No companies matched this profile')).toBeInTheDocument()
    await userEvent.click(screen.getAllByRole('button', { name: 'Edit request' })[1])
    expect(await screen.findByText('Intake page')).toBeInTheDocument()
  })

  it('pages a large run 25 at a time with the total visible, and search covers all rows', async () => {
    renderPage({ status: 'Completed' }, makeLeads(120))
    await screen.findByRole('table')
    expect(screen.getAllByRole('row')).toHaveLength(26) // header + 25
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 25 of 120 companies')

    await userEvent.click(screen.getByRole('button', { name: 'Show 25 more' }))
    expect(screen.getAllByRole('row')).toHaveLength(51)

    await userEvent.type(screen.getByRole('searchbox', { name: /search companies/i }), 'Company 119')
    expect(screen.getByText(/Showing/)).toHaveTextContent('Showing 1 of 1 companies')
  }, 40000)

  it('opens a lead with a click and closes it with Escape', async () => {
    renderPage({ status: 'Completed' }, makeLeads(3))
    await userEvent.click((await screen.findAllByRole('button', { name: 'Company 000' }))[0])
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('shows an error with a retry when the results cannot be loaded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    renderPage({ status: 'Completed' }, [])
    leadsContext.getResults.mockReset()
    leadsContext.getResults.mockRejectedValue(Object.assign(new Error('x'), { isNetworkError: true }))
    cleanup()
    renderPage({ status: 'Completed' }, [], { keepMock: true })
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reach quarry/i)
    leadsContext.getResults.mockResolvedValue({ leads: [], competitors: [], queries: [] })
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Test run', level: 1 })).toBeInTheDocument()
  })

  it('shows a stat strip with companies, contacts and the average match', async () => {
    const leads = [
      { company_name: 'A Co', match_score: '90', contact_name: 'Ann' },
      { company_name: 'B Co', match_score: '70' },
    ]
    renderPage({ status: 'Completed' }, leads)
    const strip = await screen.findByRole('list', { name: 'Run summary' })
    expect(within(strip).getByText('Companies').closest('li')).toHaveTextContent('2')
    expect(within(strip).getByText('Contacts').closest('li')).toHaveTextContent('1')
    expect(within(strip).getByText('Average match').closest('li')).toHaveTextContent('80')
  })

  it('shows a dash instead of an average when no company has a match score', async () => {
    renderPage({ status: 'Completed' }, [{ company_name: 'A Co' }])
    const strip = await screen.findByRole('list', { name: 'Run summary' })
    expect(within(strip).getByText('Average match').closest('li')).not.toHaveTextContent(/\d/)
  })

  it('marks the selected results tab and keeps rows identifiable for animation', async () => {
    renderPage({ status: 'Completed' }, makeLeads(3))
    await screen.findByRole('table')
    expect(screen.getByRole('tab', { name: /^Companies/ })).toHaveAttribute('aria-selected', 'true')
    expect(document.querySelectorAll('[data-flip-id]')).toHaveLength(3)
  })

  it('returns focus to the row that opened the lead panel', async () => {
    renderPage({ status: 'Completed' }, makeLeads(3))
    const opener = (await screen.findAllByRole('button', { name: 'Company 000' }))[1]
    opener.focus()
    await userEvent.click(opener)
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(opener).toHaveFocus())
  })
})
