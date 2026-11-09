import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ user: { name: 'Asha Rao', email: 'asha@acme.co' }, logout: mocks.logout }),
}))
vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({ theme: 'light', toggleTheme: vi.fn(), palette: 'quarry', setPalette: vi.fn() }),
}))
vi.mock('../../context/LeadContext', () => ({
  useLeads: () => ({ requests: [], globalSearchQuery: '', setGlobalSearchQuery: vi.fn(), notifications: [], markAllRead: vi.fn(), toggleRead: vi.fn(), clearNotification: vi.fn() }),
}))

import Header from '../Header'
import Sidebar from './Sidebar'
import { useSidebar, SIDEBAR, WIDTH_KEY, STATE_KEY } from './useSidebar'

function Shell() {
  const sidebar = useSidebar()
  return (
    <>
      <Sidebar sidebar={sidebar} />
      <Header sidebar={sidebar} />
    </>
  )
}

const renderShell = (path = '/lead-requests') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<p>login page</p>} />
        <Route path="*" element={<Shell />} />
      </Routes>
    </MemoryRouter>,
  )

function stubMedia({ mobile = false, reduce = false } = {}) {
  window.matchMedia = (query) => ({
    matches: query.includes('max-width') ? mobile : query.includes('prefers-reduced-motion: reduce') ? reduce : query.includes('no-preference') ? !reduce : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

const sidebarEl = () => document.getElementById('app-sidebar')
const separator = () => screen.getByRole('separator', { name: 'Resize sidebar' })

const LINKS = [
  ['Requests', '/lead-requests'],
  ['Dashboard', '/dashboard'],
  ['Lead lists', '/lead-lists'],
  ['Outreach', '/outreach'],
  ['Watch', '/watch'],
  ['Integrations', '/integrations'],
  ['CRM integrations', '/integrations/crm'],
  ['Team', '/team'],
  ['Billing', '/billing'],
  ['Compliance', '/compliance'],
  ['Account', '/profile'],
]

describe('Sidebar', () => {
  const originalMatchMedia = window.matchMedia
  beforeEach(() => {
    vi.clearAllMocks()
    stubMedia({ reduce: true })
  })
  afterEach(() => {
    window.matchMedia = originalMatchMedia
  })

  describe('content', () => {
    it('renders every destination in a Main navigation landmark with the right href', () => {
      renderShell()
      const nav = screen.getByRole('navigation', { name: 'Main' })
      for (const [name, href] of LINKS) {
        expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href)
      }
      expect(screen.getByRole('link', { name: 'New request' })).toHaveAttribute('href', '/new-request')
      expect(screen.getByRole('button', { name: /Switch workspace/ })).toBeInTheDocument()
      expect(screen.getByText('asha@acme.co')).toBeInTheDocument()
    })

    it('groups links under Workspace, Outreach and Settings headings', () => {
      renderShell()
      for (const heading of ['Workspace', 'Outreach', 'Settings']) {
        expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
      }
    })

    it('marks only the current page with aria-current', () => {
      renderShell('/dashboard')
      const nav = screen.getByRole('navigation', { name: 'Main' })
      expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
      expect(within(nav).getAllByRole('link').filter((a) => a.hasAttribute('aria-current'))).toHaveLength(1)
    })

    it('keeps Integrations and CRM integrations apart, and treats a request page as Requests', () => {
      const { unmount } = renderShell('/integrations/crm')
      let nav = screen.getByRole('navigation', { name: 'Main' })
      expect(within(nav).getByRole('link', { name: 'CRM integrations' })).toHaveAttribute('aria-current', 'page')
      expect(within(nav).getByRole('link', { name: 'Integrations' })).not.toHaveAttribute('aria-current')
      unmount()

      renderShell('/request/abc/intake')
      nav = screen.getByRole('navigation', { name: 'Main' })
      expect(within(nav).getByRole('link', { name: 'Requests' })).toHaveAttribute('aria-current', 'page')
    })

    it('logs out and returns to the login page', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Log out' }))
      expect(mocks.logout).toHaveBeenCalledTimes(1)
      expect(await screen.findByText('login page')).toBeInTheDocument()
    })
  })

  describe('hide, show and the icon rail', () => {
    it('hides and shows with the toggle button, keeping aria-expanded in sync', async () => {
      renderShell()
      const toggle = screen.getByRole('button', { name: 'Hide sidebar' })
      expect(toggle).toHaveAttribute('aria-expanded', 'true')
      expect(toggle).toHaveAttribute('aria-controls', 'app-sidebar')
      await userEvent.click(toggle)
      expect(sidebarEl()).toHaveAttribute('data-state', 'hidden')
      expect(screen.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute('aria-expanded', 'false')
      expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
      expect(sidebarEl()).toHaveAttribute('data-state', 'open')
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })

    it('toggles with Ctrl+B', async () => {
      renderShell()
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(sidebarEl()).toHaveAttribute('data-state', 'hidden')
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(sidebarEl()).toHaveAttribute('data-state', 'open')
    })

    it('collapses to an icon rail whose links keep their names and tooltips', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar to icons' }))
      expect(sidebarEl()).toHaveAttribute('data-state', 'collapsed')
      const link = within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'Billing' })
      expect(link).toHaveAttribute('title', 'Billing')
      expect(link).toHaveAttribute('href', '/billing')
      await userEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }))
      expect(sidebarEl()).toHaveAttribute('data-state', 'open')
    })

    it('comes back to the rail after hiding if it was a rail', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar to icons' }))
      await userEvent.keyboard('{Control>}b{/Control}')
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(sidebarEl()).toHaveAttribute('data-state', 'collapsed')
    })
  })

  describe('resizing and persistence', () => {
    it('starts at the default width with a labelled vertical separator', () => {
      renderShell()
      const sep = separator()
      expect(sep).toHaveAttribute('aria-orientation', 'vertical')
      expect(sep).toHaveAttribute('aria-valuemin', String(SIDEBAR.MIN))
      expect(sep).toHaveAttribute('aria-valuemax', String(SIDEBAR.MAX))
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.DEFAULT))
      expect(sidebarEl().style.width).toBe(`${SIDEBAR.DEFAULT}px`)
    })

    it('resizes with the arrow keys within its bounds, Home/End, and resets on double click', async () => {
      renderShell()
      const sep = separator()
      sep.focus()
      await userEvent.keyboard('{ArrowRight}')
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.DEFAULT + SIDEBAR.STEP))
      await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.DEFAULT - SIDEBAR.STEP))
      await userEvent.keyboard('{End}')
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.MAX))
      await userEvent.keyboard('{ArrowRight}')
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.MAX))
      await userEvent.keyboard('{Home}')
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.MIN))
      await waitFor(() => expect(sidebarEl().style.width).toBe(`${SIDEBAR.MIN}px`))

      await userEvent.dblClick(sep)
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.DEFAULT))
    })

    it('collapses to the rail when pushed left past the minimum', async () => {
      renderShell()
      separator().focus()
      await userEvent.keyboard('{Home}{ArrowLeft}')
      expect(sidebarEl()).toHaveAttribute('data-state', 'collapsed')
      await userEvent.keyboard('{ArrowRight}')
      expect(sidebarEl()).toHaveAttribute('data-state', 'open')
    })

    it('follows a pointer drag, snapping to the rail when dragged very narrow', () => {
      renderShell()
      const sep = separator()
      const move = (x) => fireEvent(sep, new MouseEvent('pointermove', { clientX: x, bubbles: true }))
      fireEvent(sep, new MouseEvent('pointerdown', { clientX: 264, bubbles: true }))
      move(340)
      expect(sep).toHaveAttribute('aria-valuenow', '340')
      expect(sidebarEl().style.width).toBe('340px')
      move(900)
      expect(sep).toHaveAttribute('aria-valuenow', String(SIDEBAR.MAX))
      move(60)
      expect(sidebarEl()).toHaveAttribute('data-state', 'collapsed')
      fireEvent(sep, new MouseEvent('pointerup', { bubbles: true }))
      move(500)
      expect(sidebarEl()).toHaveAttribute('data-state', 'collapsed')
    })

    it('saves width and state, and restores them on the next load without a flash', async () => {
      const first = renderShell()
      separator().focus()
      await userEvent.keyboard('{ArrowRight}{ArrowRight}')
      expect(localStorage.getItem(WIDTH_KEY)).toBe(String(SIDEBAR.DEFAULT + 2 * SIDEBAR.STEP))
      expect(localStorage.getItem(STATE_KEY)).toBe('open')
      first.unmount()

      renderShell()
      expect(sidebarEl().style.width).toBe(`${SIDEBAR.DEFAULT + 2 * SIDEBAR.STEP}px`)
    })

    it('restores a hidden or collapsed state on first render', () => {
      localStorage.setItem(STATE_KEY, 'hidden')
      const first = renderShell()
      expect(sidebarEl()).toHaveAttribute('data-state', 'hidden')
      expect(sidebarEl().style.visibility).toBe('hidden')
      expect(sidebarEl().style.width).toBe('0px')
      first.unmount()

      localStorage.setItem(STATE_KEY, 'collapsed')
      renderShell()
      expect(sidebarEl()).toHaveAttribute('data-state', 'collapsed')
      expect(sidebarEl().style.width).toBe(`${SIDEBAR.RAIL}px`)
    })

    it('ignores garbage in storage and clamps out-of-range widths', () => {
      localStorage.setItem(WIDTH_KEY, '9999')
      localStorage.setItem(STATE_KEY, 'sideways')
      renderShell()
      expect(sidebarEl()).toHaveAttribute('data-state', 'open')
      expect(separator()).toHaveAttribute('aria-valuenow', String(SIDEBAR.MAX))
    })

    it('still works when storage throws', async () => {
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked')
      })
      renderShell()
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(sidebarEl()).toHaveAttribute('data-state', 'hidden')
      spy.mockRestore()
      get.mockRestore()
    })
  })

  describe('mobile drawer', () => {
    beforeEach(() => stubMedia({ mobile: true, reduce: true }))

    it('is closed by default, with no resize handle and no hamburger-less state', () => {
      renderShell()
      expect(sidebarEl().style.visibility).toBe('hidden')
      expect(screen.queryByRole('separator')).not.toBeInTheDocument()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Show sidebar' })).toHaveAttribute('aria-expanded', 'false')
    })

    it('opens as a modal dialog with a backdrop and moves focus inside', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
      const drawer = screen.getByRole('dialog', { name: 'Navigation menu' })
      expect(drawer).toHaveAttribute('aria-modal', 'true')
      expect(within(drawer).getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
      expect(screen.getByTestId('sidebar-backdrop')).toBeInTheDocument()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Close menu' })).toHaveFocus())
    })

    it('closes with Escape and returns focus to the toggle', async () => {
      renderShell()
      const toggle = screen.getByRole('button', { name: 'Show sidebar' })
      toggle.focus()
      await userEvent.click(toggle)
      await screen.findByRole('dialog')
      await userEvent.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(toggle).toHaveFocus()
    })

    it('closes when the backdrop is clicked', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
      await userEvent.click(screen.getByTestId('sidebar-backdrop'))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('closes on navigation', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
      const nav = within(await screen.findByRole('dialog')).getByRole('navigation', { name: 'Main' })
      await userEvent.click(within(nav).getByRole('link', { name: 'Dashboard' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('traps Tab inside the drawer, wrapping both ways', async () => {
      renderShell()
      await userEvent.click(screen.getByRole('button', { name: 'Show sidebar' }))
      const drawer = await screen.findByRole('dialog')
      const close = within(drawer).getByRole('button', { name: 'Close menu' })
      await waitFor(() => expect(close).toHaveFocus())
      await userEvent.tab({ shift: true })
      expect(drawer.contains(document.activeElement)).toBe(true)
      expect(document.activeElement).not.toBe(close)
      await userEvent.tab()
      expect(document.activeElement).toBe(close)
    })

    it('Ctrl+B opens and closes the drawer', async () => {
      renderShell()
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(await screen.findByRole('dialog')).toBeInTheDocument()
      await userEvent.keyboard('{Control>}b{/Control}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    })

    it('does not touch the saved desktop state', async () => {
      renderShell()
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(localStorage.getItem(STATE_KEY)).toBe('open')
    })
  })

  describe('reduced motion', () => {
    it('works and lands on the final state immediately when the user prefers reduced motion', async () => {
      stubMedia({ reduce: true })
      renderShell('/team')
      expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page')
      await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar to icons' }))
      expect(sidebarEl().style.width).toBe(`${SIDEBAR.RAIL}px`)
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(sidebarEl().style.width).toBe('0px')
      expect(sidebarEl().style.visibility).toBe('hidden')
    })

    it('does not throw with motion enabled either', async () => {
      stubMedia({ reduce: false })
      renderShell('/team')
      await userEvent.keyboard('{Control>}b{/Control}')
      await userEvent.keyboard('{Control>}b{/Control}')
      expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    })
  })
})

describe('sidebar scrollbar', () => {
  beforeEach(() => {
    localStorage.clear()
    stubMedia({ reduce: true })
  })

  it('hides the scrollbar on the nav but keeps it scrollable', () => {
    renderShell()
    const nav = within(sidebarEl()).getByRole('navigation', { name: 'Main' })
    expect(nav).toHaveClass('scrollbar-hide')
    expect(nav).toHaveClass('overflow-y-auto')
  })
})
