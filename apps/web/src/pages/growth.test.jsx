import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }, getActiveOrgId: () => '' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'me@x.com', name: 'Me' } }) }))
const org = { orgs: [], activeOrg: null, role: null, switchOrg: vi.fn(), refresh: vi.fn(async () => []), can: () => true }
vi.mock('../context/OrgContext', () => ({ useOrg: () => org }))

import { api } from '../api'
import TeamSettings from './TeamSettings'
import Billing from './Billing'
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

describe('Billing', () => {
  const SUMMARY = {
    scope: 'personal',
    can_manage: true,
    plan: { id: 'free', name: 'Free' },
    usage: { requests_created: 3, requests_limit: 3, credits_spent: 3 },
    credits: { balance: 22, monthly_grant: 25, recent: [] },
    subscription: null,
  }
  const PLANS = {
    plans: [
      { id: 'free', name: 'Free', price_usd_month: 0, features: ['3 lead requests / month'] },
      { id: 'pro', name: 'Pro', price_usd_month: 49, features: ['50 lead requests / month'] },
    ],
    providers: ['stripe'],
  }

  beforeEach(() => {
    api.get.mockImplementation((p) => Promise.resolve(p === '/billing/summary' ? SUMMARY : p === '/billing/plans' ? PLANS : { invoices: [] }))
  })

  it('shows plan, usage meters, credits and an empty invoice state', async () => {
    wrap(<Billing />)
    expect(await screen.findByRole('heading', { name: 'Free plan' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Lead requests this month' })).toHaveAttribute('aria-valuenow', '3')
    expect(screen.getByText('22')).toBeInTheDocument()
    expect(screen.getByText('No invoices yet')).toBeInTheDocument()
  })

  it('labels the two credit balances and lets an admin add credits', async () => {
    const TOPUP = { packs: [{ credits: 100, price_usd: 10 }, { credits: 500, price_usd: 40 }], providers: ['mock'], can_manage: true }
    api.get.mockImplementation((p) => Promise.resolve(
      p === '/billing/summary' ? { ...SUMMARY, credits: { ...SUMMARY.credits, label: 'Request credits', recent: [{ kind: 'topup', label: 'Top-up', amount: 100, note: '' }] }, enrichment_credits: { label: 'Email lookup credits', balance: 97 } }
        : p === '/billing/plans' ? PLANS : p === '/billing/topup' ? TOPUP : { invoices: [] }))
    api.post.mockResolvedValue({ settled: true, credits: 500, target: 'enrichment' })
    const user = userEvent.setup()
    wrap(<Billing />)
    expect(await screen.findByText('Request credits', { selector: 'dt' })).toBeInTheDocument()
    expect(screen.getByText('Email lookup credits', { selector: 'dt' })).toBeInTheDocument()
    expect(screen.getByLabelText('Email lookup credit balance')).toHaveTextContent('97')
    expect(screen.getByRole('list', { name: 'Recent request credit activity' })).toHaveTextContent('Top-up')
    await user.selectOptions(screen.getByLabelText('Credit pack'), '500')
    await user.selectOptions(screen.getByLabelText('Add to'), 'enrichment')
    await user.click(screen.getByRole('button', { name: 'Add credits' }))
    expect(api.post).toHaveBeenCalledWith('/billing/topup', { credits: 500, target: 'enrichment' })
    expect(await screen.findByText('Added 500 email lookup credits.')).toBeInTheDocument()
  })

  it('hides the top-up form when no provider is enabled and disables it for non-admins', async () => {
    wrap(<Billing />)
    expect(await screen.findByRole('heading', { name: 'Free plan' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add credits' })).not.toBeInTheDocument()
    cleanup()
    api.get.mockImplementation((p) => Promise.resolve(
      p === '/billing/summary' ? SUMMARY : p === '/billing/plans' ? PLANS
        : p === '/billing/topup' ? { packs: [{ credits: 100, price_usd: 10 }], providers: ['mock'], can_manage: false } : { invoices: [] }))
    wrap(<Billing />)
    expect(await screen.findByRole('button', { name: 'Add credits' })).toBeDisabled()
    expect(screen.getByText('Only owners and admins can add credits.')).toBeInTheDocument()
  })

  it('shows the error when adding credits fails', async () => {
    api.get.mockImplementation((p) => Promise.resolve(
      p === '/billing/summary' ? SUMMARY : p === '/billing/plans' ? PLANS
        : p === '/billing/topup' ? { packs: [{ credits: 100, price_usd: 10 }], providers: ['mock'], can_manage: true } : { invoices: [] }))
    api.post.mockRejectedValue(new Error('The payment provider could not start the top-up'))
    const user = userEvent.setup()
    wrap(<Billing />)
    await user.click(await screen.findByRole('button', { name: 'Add credits' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('could not start the top-up')
  })

  it('starts checkout for an upgrade', async () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true })
    api.post.mockResolvedValue({ url: 'https://pay.test/x' })
    const user = userEvent.setup()
    wrap(<Billing />)
    await user.click(await screen.findByRole('button', { name: 'Upgrade to Pro' }))
    expect(api.post).toHaveBeenCalledWith('/billing/checkout', { plan: 'pro', provider: 'stripe' })
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://pay.test/x'))
  })

  it('disables upgrades for non-admins and lists invoices when present', async () => {
    const invoices = { invoices: [{ id: 'stripe:in_1', amount: 4900, currency: 'usd', status: 'paid', created_at: '2026-01-02T00:00:00', url: 'https://r.test' }] }
    api.get.mockImplementation((p) => Promise.resolve(p === '/billing/summary' ? { ...SUMMARY, can_manage: false } : p === '/billing/plans' ? PLANS : invoices))
    wrap(<Billing />)
    expect(await screen.findByRole('button', { name: 'Upgrade to Pro' })).toBeDisabled()
    expect(within(screen.getByRole('table')).getByText('paid')).toBeInTheDocument()
  })

  it('shows an error with retry', async () => {
    api.get.mockRejectedValue(new Error('nope'))
    wrap(<Billing />)
    expect(await screen.findByText('Could not load billing')).toBeInTheDocument()
  })
})

describe('Integrations', () => {
  const FIELDS = { company: { name: 'Company name', domain: 'Website domain' }, contact: { email: 'Email', first_name: 'First name' } }
  const base = { hubspot_oauth_available: false, crm_connections_allowed: 1, can_manage: true, fields: FIELDS }

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
      if (p === '/hooks') return Promise.resolve({ hooks: [] })
      return Promise.reject(new Error('unexpected ' + p))
    })
    api.post.mockImplementation(() => {
      synced = true
      return Promise.resolve({ summary: { synced: 1, failed: 1, skipped: 0 }, results: [] })
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
    expect(await screen.findByText('HubSpot is unavailable (will work on retry)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry failed/ })).toBeInTheDocument()
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
