import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }, getActiveOrgId: () => '' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'me@x.com', name: 'Me' } }) }))
const org = { orgs: [], activeOrg: null, role: null, switchOrg: vi.fn(), refresh: vi.fn(async () => []), can: () => true }
vi.mock('../context/OrgContext', () => ({ useOrg: () => org }))

import { api } from '../api'
import TeamSettings from './TeamSettings'
import Integrations from './CrmIntegrations'
import AcceptInvite from './AcceptInvite'
import OrgSwitcher from '../components/OrgSwitcher'

const wrap = (ui, path = '/') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  )

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(org, { orgs: [], activeOrg: null, role: null, can: () => true })
})

describe('OrgSwitcher', () => {
  it('lists the personal workspace and organizations, and switches', async () => {
    Object.assign(org, { orgs: [{ id: 'o1', name: 'Acme', role: 'admin' }], activeOrg: null })
    const user = userEvent.setup()
    wrap(<OrgSwitcher />)
    await user.click(screen.getByRole('button', { name: /Switch workspace, current: Personal/ }))
    expect(screen.getByText('Personal workspace')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Acme/ }))
    expect(org.switchOrg).toHaveBeenCalledWith('o1')
  })
})

describe('TeamSettings', () => {
  it('lets a personal-workspace user create an organization', async () => {
    api.post.mockResolvedValue({ id: 'o9', name: 'New Co' })
    const user = userEvent.setup()
    wrap(<TeamSettings />)
    await user.click(screen.getByRole('button', { name: 'Create organization' }))
    expect(await screen.findByText('Give the organization a name.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Organization name'), 'New Co')
    await user.click(screen.getByRole('button', { name: 'Create organization' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs', { name: 'New Co' }))
    await waitFor(() => expect(org.switchOrg).toHaveBeenCalledWith('o9'))
  })

  const MEMBERS = { members: [{ user_id: 'u1', name: 'Me', email: 'me@x.com', role: 'owner' }, { user_id: 'u2', name: 'Sam', email: 'sam@x.com', role: 'viewer' }] }
  const route = (path) => {
    if (path.endsWith('/members')) return Promise.resolve(MEMBERS)
    if (path.endsWith('/invites')) return Promise.resolve({ invites: [{ id: 'i1', email: 'new@x.com', role: 'member' }] })
    if (path.endsWith('/shared/lists')) return Promise.resolve({ lists: [{ _id: 'l1', name: 'Hot list', lead_ids: ['a'] }] })
    if (path.endsWith('/shared/requests')) return Promise.resolve({ requests: [] })
    if (path === '/lists') return Promise.resolve({ lists: [] })
    if (path === '/requests') return Promise.resolve([])
    return Promise.reject(new Error('unexpected ' + path))
  }
  const asRole = (role) => {
    const active = { id: 'o1', name: 'Acme', role }
    Object.assign(org, { orgs: [active], activeOrg: active, role })
  }

  it('shows members, pending invites and shared work for an owner, and can change a role', async () => {
    asRole('owner')
    api.get.mockImplementation(route)
    api.put.mockResolvedValue({})
    const user = userEvent.setup()
    wrap(<TeamSettings />)
    expect(await screen.findByText('Sam')).toBeInTheDocument()
    expect(await screen.findByText(/new@x.com/)).toBeInTheDocument()
    expect(await screen.findByText('Hot list')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Role for Sam'), 'member')
    expect(api.put).toHaveBeenCalledWith('/orgs/o1/members/u2', { role: 'member' })
  })

  it('shows the invite link after inviting and validates the email', async () => {
    asRole('admin')
    api.get.mockImplementation(route)
    api.post.mockResolvedValue({ id: 'i2', invite_url: 'http://app/invite?token=abc', email_status: 'disabled' })
    const user = userEvent.setup()
    wrap(<TeamSettings />)
    await user.click(await screen.findByRole('button', { name: /Send invite/ }))
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Email'), 'a@b.co')
    await user.click(screen.getByRole('button', { name: /Send invite/ }))
    expect(await screen.findByText('http://app/invite?token=abc')).toBeInTheDocument()
    expect(screen.getByText('Email not set up, share the link')).toBeInTheDocument()
    expect(api.post).toHaveBeenCalledWith('/orgs/o1/invites', { email: 'a@b.co', role: 'member' })
  })

  it('hides management controls from a viewer', async () => {
    asRole('viewer')
    org.can = (min) => min === 'viewer'
    api.get.mockImplementation(route)
    wrap(<TeamSettings />)
    expect(await screen.findByText('Sam')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Send invite/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Role for Sam')).not.toBeInTheDocument()
  })

  it('shows an error with retry when members fail to load', async () => {
    asRole('owner')
    api.get.mockImplementation((p) => (p.endsWith('/members') ? Promise.reject(new Error('down')) : route(p)))
    wrap(<TeamSettings />)
    expect(await screen.findByText('Could not load members')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })
})

describe('Integrations', () => {
  const FIELDS = { company: { name: 'Company name', domain: 'Website domain' }, contact: { email: 'Email', first_name: 'First name' } }
  const base = { hubspot_oauth_available: false, can_manage: true, fields: FIELDS }

  it('connects HubSpot with a private-app token', async () => {
    api.get.mockResolvedValue({ ...base, integrations: [{ provider: 'hubspot', connected: false }] })
    api.put.mockResolvedValue({})
    const user = userEvent.setup()
    wrap(<Integrations />)
    await user.click(await screen.findByRole('button', { name: /Connect HubSpot/ }))
    expect(await screen.findByText('Paste your HubSpot private app access token.')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Private app access token'), 'pat-na1-secret')
    await user.click(screen.getByRole('button', { name: /Connect HubSpot/ }))
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/integrations/hubspot/token', { access_token: 'pat-na1-secret' }))
  })

  it('shows mapping, pushes a list and reports per-lead sync status', async () => {
    const connected = { ...base, integrations: [{ provider: 'hubspot', connected: true, auth_type: 'private_app', info: { portal_id: 7 } }] }
    let synced = false
    api.get.mockImplementation((p) => {
      if (p === '/integrations') return Promise.resolve(connected)
      if (p === '/integrations/hubspot/mapping') return Promise.resolve({ mapping: { company: { name: 'name', domain: 'domain' }, contact: { email: 'email' } } })
      if (p === '/lists') return Promise.resolve({ lists: [{ _id: 'l1', name: 'Hot', lead_ids: ['a', 'b'] }] })
      if (p === '/lists/l1') return Promise.resolve({ leads: [{ id: 'a', title: 'Acme' }, { id: 'b', title: 'Globex' }] })
      if (p.startsWith('/integrations/hubspot/sync')) {
        return Promise.resolve(
          synced
            ? { counts: { synced: 1, failed: 1, not_synced: 0 }, leads: [{ lead_id: 'a', status: 'synced' }, { lead_id: 'b', status: 'failed', error: 'HubSpot is unavailable', retryable: true }] }
            : { counts: { synced: 0, failed: 0, not_synced: 2 }, leads: [{ lead_id: 'a', status: 'not_synced' }, { lead_id: 'b', status: 'not_synced' }] },
        )
      }
      if (p === '/jobs/j1') return Promise.resolve({ status: 'succeeded', result: { summary: { synced: 1, failed: 1, skipped: 0 } } })
      if (p === '/hooks') return Promise.resolve({ hooks: [] })
      return Promise.reject(new Error('unexpected ' + p))
    })
    api.post.mockImplementation(() => {
      synced = true
      return Promise.resolve({ job_id: 'j1', status: 'queued', total: 2 })
    })
    const user = userEvent.setup()
    wrap(<Integrations />)
    expect(await screen.findByText(/Connected to portal 7/)).toBeInTheDocument()
    expect(await screen.findByLabelText('Company name')).toBeEnabled()
    expect(screen.getByLabelText('Website domain')).toBeDisabled()
    await user.selectOptions(await screen.findByLabelText('Lead list'), 'l1')
    expect(await screen.findByText('Acme')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Push to HubSpot' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/integrations/hubspot/push', { list_id: 'l1', only_failed: false }))
    expect(await screen.findByText('Push started. Leads update below as they sync.')).toBeInTheDocument()
    expect(await screen.findByText('HubSpot is unavailable (will work on retry)', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(await screen.findByText('1 synced, 1 failed. See details below.', {}, { timeout: 5000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry failed/ })).toBeInTheDocument()
  })

  it('shows leads as in progress while a push runs and resumes polling on reload', async () => {
    const connected = { ...base, integrations: [{ provider: 'hubspot', connected: true, auth_type: 'private_app', info: { portal_id: 7 } }] }
    let polls = 0
    api.get.mockImplementation((p) => {
      if (p === '/integrations') return Promise.resolve(connected)
      if (p === '/integrations/hubspot/mapping') return Promise.resolve({ mapping: { company: { name: 'name' }, contact: { email: 'email' } } })
      if (p === '/lists') return Promise.resolve({ lists: [{ _id: 'l1', name: 'Hot', lead_ids: ['a'] }] })
      if (p === '/lists/l1') return Promise.resolve({ leads: [{ id: 'a', title: 'Acme' }] })
      if (p.startsWith('/integrations/hubspot/sync')) {
        polls += 1
        return Promise.resolve(polls < 2
          ? { counts: { synced: 0, failed: 0, not_synced: 0, in_progress: 1 }, leads: [{ lead_id: 'a', status: 'syncing' }] }
          : { counts: { synced: 1, failed: 0, not_synced: 0, in_progress: 0 }, leads: [{ lead_id: 'a', status: 'synced' }] })
      }
      if (p === '/hooks') return Promise.resolve({ hooks: [] })
      return Promise.reject(new Error('unexpected ' + p))
    })
    const user = userEvent.setup()
    wrap(<Integrations />)
    await user.selectOptions(await screen.findByLabelText('Lead list'), 'l1')
    expect(await screen.findByText('Syncing')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Push to HubSpot' })).toBeDisabled()
    expect(await screen.findByText('Synced', {}, { timeout: 5000 })).toBeInTheDocument()
  })

  it('shows an error with retry', async () => {
    api.get.mockRejectedValue(new Error('boom'))
    wrap(<Integrations />)
    expect(await screen.findByText('Could not load integrations')).toBeInTheDocument()
  })
})

describe('AcceptInvite', () => {
  it('accepts the invite token and switches into the organization', async () => {
    api.post.mockResolvedValue({ id: 'o1', name: 'Acme' })
    const user = userEvent.setup()
    wrap(<AcceptInvite />, '/invite?token=abcdefghijk')
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/orgs/invites/accept', { token: 'abcdefghijk' }))
    await waitFor(() => expect(org.switchOrg).toHaveBeenCalledWith('o1'))
  })

  it('shows the server error when the invite is invalid', async () => {
    api.post.mockRejectedValue(new Error('This invite is invalid or was already used'))
    const user = userEvent.setup()
    wrap(<AcceptInvite />, '/invite?token=zzzzzzzzzzz')
    await user.click(screen.getByRole('button', { name: 'Accept invitation' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already used')
  })

  it('handles a link with no token', () => {
    wrap(<AcceptInvite />, '/invite')
    expect(screen.getByText('Invite link incomplete')).toBeInTheDocument()
  })
})
