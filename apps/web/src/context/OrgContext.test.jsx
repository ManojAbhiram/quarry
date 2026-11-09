import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('./AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { api } from '../api'
import { OrgProvider, useOrg } from './OrgContext'

function Probe() {
  const { orgs, activeOrg, role, can } = useOrg()
  return (
    <div>
      <span data-testid="count">{orgs.length}</span>
      <span data-testid="active">{activeOrg ? activeOrg.name : 'personal'}</span>
      <span data-testid="role">{role || 'none'}</span>
      <span data-testid="can-admin">{String(can('admin'))}</span>
    </div>
  )
}

const mount = () => render(<OrgProvider><Probe /></OrgProvider>)

describe('OrgContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores the saved workspace and exposes the role', async () => {
    localStorage.setItem('active_org', 'o1')
    api.get.mockResolvedValue({ organizations: [{ id: 'o1', name: 'Acme', role: 'member' }] })
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Acme'))
    expect(screen.getByTestId('role')).toHaveTextContent('member')
    expect(screen.getByTestId('can-admin')).toHaveTextContent('false')
  })

  it('falls back to the personal workspace when the saved org is no longer available', async () => {
    localStorage.setItem('active_org', 'gone')
    api.get.mockResolvedValue({ organizations: [{ id: 'o1', name: 'Acme', role: 'owner' }] })
    mount()
    await waitFor(() => expect(screen.getByTestId('count')).toHaveTextContent('1'))
    expect(screen.getByTestId('active')).toHaveTextContent('personal')
    expect(localStorage.getItem('active_org')).toBeNull()
  })

  it('survives the organizations request failing', async () => {
    api.get.mockRejectedValue(new Error('down'))
    mount()
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect(screen.getByTestId('active')).toHaveTextContent('personal')
  })

  it('accepts an invite saved before sign-in, then refreshes', async () => {
    localStorage.setItem('pending_invite', 'tok123456789')
    api.post.mockResolvedValue({ id: 'o2', name: 'Joined' })
    api.get.mockResolvedValue({ organizations: [{ id: 'o2', name: 'Joined', role: 'member' }] })
    mount()
    await waitFor(() => expect(screen.getByTestId('active')).toHaveTextContent('Joined'))
    expect(api.post).toHaveBeenCalledWith('/orgs/invites/accept', { token: 'tok123456789' })
    expect(localStorage.getItem('pending_invite')).toBeNull()
  })
})
