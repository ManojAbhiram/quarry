// Regression: ISSUE-003 — the organization card said "You are a owner." (wrong article before a vowel)
// Found by /qa on 2026-11-09
// Report: .gstack/qa-reports/run-20261109T110620Z/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({ api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }, getActiveOrgId: () => '' }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1', email: 'me@x.com', name: 'Me' } }) }))
const org = { orgs: [], activeOrg: null, role: null, switchOrg: vi.fn(), refresh: vi.fn(async () => []), can: () => true }
vi.mock('../context/OrgContext', () => ({ useOrg: () => org }))

import { api } from '../api'
import TeamSettings from './TeamSettings'

const route = (path) => {
  if (path.endsWith('/members')) return Promise.resolve({ members: [{ user_id: 'u1', name: 'Me', email: 'me@x.com', role: 'owner' }] })
  if (path.endsWith('/invites')) return Promise.resolve({ invites: [] })
  if (path.endsWith('/shared/lists')) return Promise.resolve({ lists: [] })
  if (path.endsWith('/shared/requests')) return Promise.resolve({ requests: [] })
  if (path === '/lists') return Promise.resolve({ lists: [] })
  if (path === '/requests') return Promise.resolve([])
  return Promise.reject(new Error('unexpected ' + path))
}

describe('TeamSettings role sentence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    api.get.mockImplementation(route)
  })

  it.each([
    ['owner', 'You are an owner.'],
    ['admin', 'You are an admin.'],
    ['member', 'You are a member.'],
    ['viewer', 'You are a viewer.'],
  ])('uses the right article for %s', async (role, sentence) => {
    const active = { id: 'o1', name: 'Acme', role }
    Object.assign(org, { orgs: [active], activeOrg: active, role })
    render(
      <MemoryRouter>
        <ToastProvider>
          <TeamSettings />
        </ToastProvider>
      </MemoryRouter>,
    )
    expect(await screen.findByText(sentence)).toBeInTheDocument()
  })
})
