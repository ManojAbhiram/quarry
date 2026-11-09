import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({
  api: {
    getLists: vi.fn(),
    getList: vi.fn(),
    createList: vi.fn(),
    updateList: vi.fn(),
    deleteList: vi.fn(),
    removeLeadsFromList: vi.fn(),
    exportList: vi.fn(),
    verifyAndSaveLeadEmail: vi.fn(),
  },
}))

import { api } from '../api'
import LeadLists from './LeadLists'

const LISTS = [
  { _id: 'l1', name: 'Pilot shortlist', color: '#6366f1', lead_ids: ['a', 'b'], created_at: '2026-01-02T00:00:00Z' },
  { _id: 'l2', name: 'Q'.repeat(120), description: 'D'.repeat(300), lead_ids: [], created_at: 'not a date' },
]
const DETAIL = {
  ...LISTS[0],
  leads: [
    { id: 'a', title: 'Acme Corp', url: 'https://acme.test', email: 'x@acme.test', email_verified: true, email_confidence: 'high', match_score: 81.4 },
    { id: 'b', title: 'Globex', url: 'https://globex.test' },
  ],
}

const setup = () => render(<ToastProvider><LeadLists /></ToastProvider>)

describe('LeadLists', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.getLists.mockResolvedValue({ lists: LISTS })
    api.getList.mockResolvedValue(DETAIL)
  })

  it('shows the lists, with lead counts, and survives long names and a bad date', async () => {
    setup()
    expect(await screen.findByText('Pilot shortlist')).toBeInTheDocument()
    expect(screen.getByText('2 leads')).toBeInTheDocument()
    expect(screen.getByText('0 leads')).toBeInTheDocument()
    expect(screen.getByText('Q'.repeat(120))).toBeInTheDocument()
  })

  it('shows an empty state with a create action when there are no lists', async () => {
    api.getLists.mockResolvedValue({ lists: [] })
    setup()
    expect(await screen.findByText('No lists yet')).toBeInTheDocument()
    expect(screen.queryByLabelText('Search lists')).not.toBeInTheDocument()
  })

  it('shows an error with a working retry', async () => {
    const user = userEvent.setup()
    api.getLists.mockRejectedValueOnce(new Error('down'))
    setup()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your lists')
    await user.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Pilot shortlist')).toBeInTheDocument()
  })

  it('filters lists by the search box and offers to clear it', async () => {
    const user = userEvent.setup()
    setup()
    await screen.findByText('Pilot shortlist')
    await user.type(screen.getByLabelText('Search lists'), 'zzz')
    expect(screen.getByText('No lists match')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /clear search/i }))
    expect(screen.getByText('Pilot shortlist')).toBeInTheDocument()
  })

  it('validates the new list form inline, including duplicate names, then creates it', async () => {
    const user = userEvent.setup()
    api.createList.mockResolvedValue({ _id: 'l3', name: 'Fresh', color: '#6366f1', lead_ids: [], created_at: '2026-02-01T00:00:00Z' })
    setup()
    await screen.findByText('Pilot shortlist')
    await user.click(screen.getByRole('button', { name: /new list/i }))
    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /create list/i }))
    expect(within(dialog).getByText('Give the list a name.')).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/list name/i), 'pilot SHORTLIST')
    await user.click(within(dialog).getByRole('button', { name: /create list/i }))
    expect(within(dialog).getByText('You already have a list with that name.')).toBeInTheDocument()
    expect(api.createList).not.toHaveBeenCalled()
    await user.clear(within(dialog).getByLabelText(/list name/i))
    await user.type(within(dialog).getByLabelText(/list name/i), 'Fresh')
    await user.click(within(dialog).getByRole('button', { name: /create list/i }))
    await waitFor(() => expect(api.createList).toHaveBeenCalledWith({ name: 'Fresh', color: '#6366f1', description: null }))
    expect(await screen.findByText('Fresh')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a server error inside the create dialog and keeps it open', async () => {
    const user = userEvent.setup()
    api.createList.mockRejectedValue(new Error('Name is reserved'))
    setup()
    await screen.findByText('Pilot shortlist')
    await user.click(screen.getByRole('button', { name: /new list/i }))
    await user.type(screen.getByLabelText(/list name/i), 'Okay')
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: /create list/i }))
    expect(await screen.findByText('Name is reserved')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('asks before deleting a list, and deletes on confirm', async () => {
    const user = userEvent.setup()
    api.deleteList.mockResolvedValue(null)
    setup()
    await screen.findByText('Pilot shortlist')
    await user.click(screen.getByRole('button', { name: 'Delete Pilot shortlist' }))
    const dialog = screen.getByRole('dialog')
    expect(api.deleteList).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Delete list' }))
    await waitFor(() => expect(api.deleteList).toHaveBeenCalledWith('l1'))
    await waitFor(() => expect(screen.queryByText('Pilot shortlist')).not.toBeInTheDocument())
  })

  it('opens a list, shows its leads, and removes a selection after confirming', async () => {
    const user = userEvent.setup()
    api.removeLeadsFromList.mockResolvedValue(null)
    setup()
    await user.click(await screen.findByRole('button', { name: /^Pilot shortlist/ }))
    expect(await screen.findByText('Acme Corp')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: 'Select Globex' }))
    await user.click(screen.getByRole('button', { name: /remove 1 selected/i }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(api.removeLeadsFromList).toHaveBeenCalledWith('l1', ['b']))
    await waitFor(() => expect(screen.queryByText('Globex')).not.toBeInTheDocument())
    expect(screen.getByText('Acme Corp')).toBeInTheDocument()
  })

  it('shows an empty state for a list with no leads and an error when a list fails to load', async () => {
    const user = userEvent.setup()
    api.getList.mockResolvedValueOnce({ ...LISTS[1], leads: [] }).mockRejectedValueOnce(new Error('x'))
    setup()
    await screen.findByText('Pilot shortlist')
    await user.click(screen.getAllByRole('button', { name: /^QQQ/ })[0])
    expect(await screen.findByText('No leads in this list yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Pilot shortlist/ }))
    expect(await screen.findByText('Could not load this list')).toBeInTheDocument()
  })

  it('renames a list inline and rejects an empty name', async () => {
    const user = userEvent.setup()
    api.updateList.mockResolvedValue({})
    setup()
    await screen.findByText('Pilot shortlist')
    await user.click(screen.getByRole('button', { name: 'Rename Pilot shortlist' }))
    const input = screen.getByLabelText('List name')
    await user.clear(input)
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    expect(screen.getByText('Give the list a name.')).toBeInTheDocument()
    await user.type(input, 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(api.updateList).toHaveBeenCalledWith('l1', { name: 'Renamed' }))
    expect(await screen.findByText('Renamed')).toBeInTheDocument()
  })
})
