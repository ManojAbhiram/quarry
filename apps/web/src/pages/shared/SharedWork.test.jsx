import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../components/kit'

const org = { activeOrg: { id: 'o1', name: 'Acme Team' }, can: () => true }
vi.mock('../../context/OrgContext', () => ({ useOrg: () => org }))
vi.mock('../../api', () => ({ api: { get: vi.fn(), delete: vi.fn() } }))

import { api } from '../../api'
import SharedWork from './SharedWork'

const wrap = (ui) => render(<ToastProvider>{ui}</ToastProvider>)
const REQ = { id: 'r9', title: 'Fintech CFOs', status: 'Completed', companies_count: 12, contacts_count: 5, icp_match_score: 81 }
const LIST = { _id: 'l9', name: 'Hot list', lead_ids: ['a', 'b'] }

describe('SharedWork', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    org.activeOrg = { id: 'o1', name: 'Acme Team' }
    org.can = () => true
  })

  it('renders nothing in the personal workspace', () => {
    org.activeOrg = null
    wrap(<SharedWork kind="requests" />)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(api.get).not.toHaveBeenCalled()
  })

  it('lists shared requests with a Shared badge and read-only details', async () => {
    api.get.mockResolvedValue({ requests: [REQ, { ...REQ, id: 'mine', title: 'My own' }] })
    const user = userEvent.setup()
    wrap(<SharedWork kind="requests" excludeIds={['mine']} />)
    expect(await screen.findByRole('heading', { name: 'Shared with Acme Team' })).toBeInTheDocument()
    expect(api.get).toHaveBeenCalledWith('/orgs/o1/shared/requests')
    expect(screen.getByText('Fintech CFOs')).toBeInTheDocument()
    expect(screen.queryByText('My own')).not.toBeInTheDocument() // already in "your requests"
    expect(screen.getByText('Shared')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Show details for Fintech CFOs/ }))
    expect(screen.getByText('12')).toBeInTheDocument()
    expect(screen.getByText('81%')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Delete|Edit/ })).not.toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    api.get.mockResolvedValue({ requests: [] })
    wrap(<SharedWork kind="requests" />)
    expect(await screen.findByText('No shared requests yet')).toBeInTheDocument()
  })

  it('shows an error with retry', async () => {
    api.get.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce({ requests: [REQ] })
    const user = userEvent.setup()
    wrap(<SharedWork kind="requests" />)
    await user.click(await screen.findByRole('button', { name: /Try again|Retry/ }))
    expect(await screen.findByText('Fintech CFOs')).toBeInTheDocument()
  })

  it('opens a shared list to see its leads and can stop sharing when permitted', async () => {
    api.get.mockImplementation((p) => Promise.resolve(p.endsWith('/shared/lists') ? { lists: [LIST] } : { leads: [{ id: 'a', title: 'Acme', email: 'a@acme.test', match_score: 88 }] }))
    api.delete.mockResolvedValue(undefined)
    const user = userEvent.setup()
    wrap(<SharedWork kind="lists" />)
    await user.click(await screen.findByRole('button', { name: /Show details for Hot list/ }))
    const leads = await screen.findByRole('list', { name: 'Leads in Hot list' })
    expect(within(leads).getByText('Acme')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop sharing Hot list' }))
    expect(api.delete).toHaveBeenCalledWith('/orgs/o1/shares/list/l9')
  })

  it('hides stop-sharing for members who may not manage shares', async () => {
    org.can = (min) => min !== 'admin'
    api.get.mockResolvedValue({ lists: [LIST] })
    wrap(<SharedWork kind="lists" />)
    expect(await screen.findByText('Hot list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Stop sharing/ })).not.toBeInTheDocument()
  })
})
