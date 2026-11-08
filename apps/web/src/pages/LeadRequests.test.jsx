import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../components/kit'

const leads = {}
vi.mock('../context/LeadContext', () => ({ useLeads: () => leads }))

import LeadRequests from './LeadRequests'

const base = { description: '', companies_count: 0, contacts_count: 0, icp_match_score: null, updated_at: 'Nov 08, 2026', request_type: 'icp' }
const REQUESTS = [
  { ...base, id: 'a', title: 'Healthy run', status: 'Completed', companies_count: 14, contacts_count: 28, icp_match_score: 74 },
  { ...base, id: 'b', title: 'Empty niche', status: 'Completed' },
  { ...base, id: 'c', title: 'Broken key', status: 'Failed', failure_reason: 'Your Serper key was rejected (401). Update it in Account settings and try again.' },
  { ...base, id: 'd', title: 'Going now', status: 'Active' },
  { ...base, id: 'e', title: 'Half typed', status: 'Draft' },
  { ...base, id: 'f', title: 'Waiting', status: 'Pending' },
  { ...base, id: 'g', title: 'M'.repeat(140), status: 'Completed', companies_count: 4 },
]

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function setup(over = {}) {
  Object.assign(leads, {
    requests: REQUESTS,
    stats: { totalLeads: 0, pending: 0, completed: 0, failed: 0 },
    refreshRequests: vi.fn(() => Promise.resolve(REQUESTS)),
    deleteRequest: vi.fn(() => Promise.resolve()),
    globalSearchQuery: '',
    setGlobalSearchQuery: vi.fn(),
    ...over,
  })
  return render(
    <MemoryRouter initialEntries={['/lead-requests']}>
      <ToastProvider>
        <Routes>
          <Route path="/lead-requests" element={<LeadRequests />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const row = (title) => screen.getByText(title).closest('li')

describe('LeadRequests', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows every status as a labelled badge', async () => {
    setup()
    expect(await screen.findByText('Healthy run')).toBeInTheDocument()
    expect(within(row('Healthy run')).getByText('Completed')).toBeInTheDocument()
    expect(within(row('Going now')).getByText('Running')).toBeInTheDocument()
    expect(within(row('Half typed')).getByText('Draft')).toBeInTheDocument()
    expect(within(row('Waiting')).getByText('Pending')).toBeInTheDocument()
    expect(within(row('Broken key')).getByText('Failed')).toBeInTheDocument()
  })

  it('shows a failed request reason in the row, and says a running one is running', async () => {
    setup()
    expect(await within(row('Broken key')).findByText(/Your Serper key was rejected/)).toBeInTheDocument()
    expect(within(row('Going now')).getByText(/running now/i)).toBeInTheDocument()
  })

  it('says nothing matched for a completed request with 0 companies', async () => {
    setup()
    expect(await within(row('Empty niche')).findByText(/no companies matched/i)).toBeInTheDocument()
    expect(within(row('Healthy run')).queryByText(/no companies matched/i)).not.toBeInTheDocument()
  })

  it('keeps a very long title available in full via the title attribute', async () => {
    setup()
    expect(await screen.findByTitle('M'.repeat(140))).toBeInTheDocument()
  })

  it('shows skeleton rows while the first load is pending, then the list', async () => {
    let resolve
    setup({ requests: [], refreshRequests: vi.fn(() => new Promise((r) => (resolve = r))) })
    expect(screen.getByRole('status', { name: /loading requests/i })).toBeInTheDocument()
    resolve([])
    await waitFor(() => expect(screen.queryByRole('status', { name: /loading requests/i })).not.toBeInTheDocument())
  })

  it('shows an empty state with a New request action for an empty account', async () => {
    setup({ requests: [], refreshRequests: vi.fn(() => Promise.resolve([])) })
    expect(await screen.findByRole('heading', { name: /no requests yet/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New request' }))
    expect(screen.getByTestId('where')).toHaveTextContent('/new-request')
  })

  it('does not put a second primary button next to the title', async () => {
    setup()
    await screen.findByText('Healthy run')
    expect(screen.queryByRole('button', { name: /new request/i })).not.toBeInTheDocument()
  })

  it('shows an error with a retry when the list cannot be loaded', async () => {
    const refresh = vi.fn().mockResolvedValueOnce(undefined).mockResolvedValueOnce([])
    setup({ requests: [], refreshRequests: refresh })
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t load/i)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: /no requests yet/i })).toBeInTheDocument()
  })

  it('filters by status from the stat strip', async () => {
    setup()
    await screen.findByText('Healthy run')
    await userEvent.click(screen.getByRole('button', { name: /^Failed/ }))
    expect(screen.getByText('Broken key')).toBeInTheDocument()
    expect(screen.queryByText('Healthy run')).not.toBeInTheDocument()
  })

  it('writes the search box into the shared search query', async () => {
    const set = vi.fn()
    setup({ setGlobalSearchQuery: set })
    await userEvent.type(await screen.findByRole('searchbox', { name: /search/i }), 'x')
    expect(set).toHaveBeenCalledWith('x')
  })

  describe('delete', () => {
    const open = async () => {
      await screen.findByText('Healthy run')
      await userEvent.click(within(row('Healthy run')).getByRole('button', { name: /delete/i }))
      return screen.getByRole('dialog')
    }

    it('asks first in an accessible dialog and does nothing when cancelled', async () => {
      setup()
      const dialog = await open()
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(dialog).toHaveAccessibleName(/delete/i)
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(leads.deleteRequest).not.toHaveBeenCalled()
    })

    it('closes on Escape and returns focus to the delete button', async () => {
      setup()
      await open()
      await userEvent.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(within(row('Healthy run')).getByRole('button', { name: /delete/i })).toHaveFocus()
    })

    it('deletes after confirming and shows a success toast', async () => {
      setup()
      const dialog = await open()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete request' }))
      await waitFor(() => expect(leads.deleteRequest).toHaveBeenCalledWith('a'))
      expect(await screen.findByRole('status')).toHaveTextContent(/deleted/i)
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    it('blocks a double submit while deleting', async () => {
      let finish
      setup({ deleteRequest: vi.fn(() => new Promise((r) => (finish = r))) })
      const dialog = await open()
      const confirm = within(dialog).getByRole('button', { name: /delete request/i })
      await userEvent.click(confirm)
      expect(confirm).toBeDisabled()
      await userEvent.click(confirm)
      expect(leads.deleteRequest).toHaveBeenCalledTimes(1)
      await act(async () => finish())
    })

    it('shows an error toast and keeps the request when the delete fails', async () => {
      setup({ deleteRequest: vi.fn(() => Promise.reject(new Error('Server is down'))) })
      const dialog = await open()
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete request' }))
      expect(await screen.findByRole('alert')).toHaveTextContent('Server is down')
      expect(screen.getByText('Healthy run')).toBeInTheDocument()
    })
  })
})
