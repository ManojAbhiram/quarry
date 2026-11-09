import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  toggleTheme: vi.fn(),
  setGlobalSearchQuery: vi.fn(),
  markAllRead: vi.fn(),
  leads: {},
}))

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Asha Rao', email: 'asha@acme.co' }, logout: mocks.logout }),
}))
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: mocks.toggleTheme, palette: 'quarry', setPalette: vi.fn() }),
}))
vi.mock('../context/LeadContext', () => ({ useLeads: () => mocks.leads }))

import Header from './Header'

const renderHeader = (path = '/lead-requests') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="*" element={<Header />} />
      </Routes>
    </MemoryRouter>,
  )

describe('Header', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.leads = {
      requests: [
        { id: 'abc', title: 'DACH agencies', status: 'Completed' },
        { id: 'def', title: 'UK SaaS', status: 'Pending' },
      ],
      globalSearchQuery: '',
      setGlobalSearchQuery: mocks.setGlobalSearchQuery,
      notifications: [
        { id: 1, type: 'success', title: 'Run finished', description: '38 leads found', time: '2m', read: false },
        { id: 2, type: 'info', title: 'Welcome', description: 'Hello', time: '1d', read: true },
      ],
      markAllRead: mocks.markAllRead,
      toggleRead: vi.fn(),
      clearNotification: vi.fn(),
    }
  })

  it('no longer carries the section links (they live in the sidebar)', () => {
    renderHeader('/dashboard')
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument()
  })

  it('with a sidebar, shows a toggle that reflects and flips its state, and hands the brand and account to the sidebar', async () => {
    const toggle = vi.fn()
    const { rerender } = render(
      <MemoryRouter>
        <Header sidebar={{ visible: true, isMobile: false, toggle }} />
      </MemoryRouter>,
    )
    const button = screen.getByRole('button', { name: 'Hide sidebar' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', 'app-sidebar')
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'New request' })).not.toBeInTheDocument()
    await userEvent.click(button)
    expect(toggle).toHaveBeenCalledTimes(1)

    rerender(
      <MemoryRouter>
        <Header sidebar={{ visible: false, isMobile: false, toggle }} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Account menu' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New request' })).toHaveAttribute('href', '/new-request')
  })

  it('offers New request as a link from every page', () => {
    renderHeader('/profile')
    expect(screen.getByRole('link', { name: 'New request' })).toHaveAttribute('href', '/new-request')
  })

  it('has a labelled search that updates the shared query', async () => {
    renderHeader()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search requests' }), 'ac')
    expect(mocks.setGlobalSearchQuery).toHaveBeenLastCalledWith('c')
  })

  it('focuses the search with Ctrl+K and with "/" (the badge is not decoration)', async () => {
    renderHeader()
    const search = screen.getByRole('searchbox', { name: 'Search requests' })
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(search).toHaveFocus()

    search.blur()
    await userEvent.keyboard('/')
    expect(search).toHaveFocus()
  })

  it('does not steal "/" while the user is typing in another field', async () => {
    render(
      <MemoryRouter>
        <Header />
        <input aria-label="other" />
      </MemoryRouter>,
    )
    const other = screen.getByLabelText('other')
    await userEvent.click(other)
    await userEvent.keyboard('a/b')
    expect(other).toHaveValue('a/b')
  })

  it('shows the signed-in user in an account menu with Escape-to-close and logout', async () => {
    renderHeader()
    const trigger = screen.getByRole('button', { name: 'Account menu' })
    await userEvent.click(trigger)
    expect(screen.getByText('asha@acme.co')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('asha@acme.co')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()

    await userEvent.click(trigger)
    await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
    expect(mocks.logout).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('login page')).toBeInTheDocument()
  })

  it('tells you how many notifications are unread, and can mark them all read', async () => {
    renderHeader()
    const bell = screen.getByRole('button', { name: 'Notifications, 1 unread' })
    await userEvent.click(bell)
    expect(screen.getByText('Run finished')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Mark all read' }))
    expect(mocks.markAllRead).toHaveBeenCalled()
  })

  it('says there are no unread notifications when there are none', () => {
    mocks.leads.notifications = []
    renderHeader()
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
  })

  it('opens help as a dialog and closes it with Escape', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'Help' }))
    expect(screen.getByRole('dialog', { name: 'Help center' })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('names the current request and lets you switch', async () => {
    renderHeader('/request/abc')
    const switcher = screen.getByRole('button', { name: /Switch request/ })
    expect(switcher).toHaveTextContent('DACH agencies')
    await userEvent.click(switcher)
    expect(screen.getByRole('button', { name: 'UK SaaS' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'DACH agencies' })).toHaveAttribute('aria-current', 'true')
  })

  it('switches theme from a labelled button', async () => {
    renderHeader()
    await userEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }))
    expect(mocks.toggleTheme).toHaveBeenCalled()
  })
})
