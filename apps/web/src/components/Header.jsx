import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { Bell, Check, ChevronDown, FolderDot, HelpCircle, LogOut, Moon, Plus, Search, Sun, UserCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useLeads } from '../context/LeadContext'
import { Menu } from './kit'
import BrandLogo from './BrandLogo'
import PaletteSwitcher from './PaletteSwitcher'
import HelpDrawer from './HelpDrawer'

const ICON_BUTTON =
  'flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface/80 text-muted shadow-sm transition-all duration-200 hover:bg-surface hover:text-ink hover:shadow-md active:scale-95'

const NAV = [
  { to: '/lead-requests', label: 'Requests', also: '/request/' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/lead-lists', label: 'Lead lists' },
  { to: '/outreach', label: 'Outreach' },
  { to: '/watch', label: 'Watch' },
  { to: '/integrations', label: 'Integrations' },
]

function initialsOf(name) {
  if (!name) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

function NavItem({ to, label, also, pathname }) {
  const active = pathname === to || pathname.startsWith(`${to}/`) || (also && pathname.startsWith(also))
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition-all duration-200',
        active ? 'bg-primary-50 font-semibold text-primary-800 shadow-sm ring-1 ring-primary-200/70 dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-900/60' : 'text-muted hover:bg-head hover:text-ink',
      )}
    >
      {label}
    </Link>
  )
}

function NotificationIcon({ type }) {
  const tone = type === 'success' ? 'bg-ok-soft text-ok' : type === 'warning' ? 'bg-warn-soft text-warn' : 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300'
  return (
    <span aria-hidden="true" className={clsx('mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs font-bold', tone)}>
      {type === 'success' ? <Check className="h-3.5 w-3.5" /> : type === 'warning' ? '!' : 'i'}
    </span>
  )
}

export default function Header() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { requests, globalSearchQuery, setGlobalSearchQuery, notifications, markAllRead, toggleRead, clearNotification } = useLeads()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const [helpOpen, setHelpOpen] = useState(false)
  const searchRef = useRef(null)
  const helpButtonRef = useRef(null)

  const requestId = pathname.match(/\/request\/([^/]+)/)?.[1] || null
  const activeRequest = requestId ? requests.find((r) => r && String(r.id || r._id || '') === String(requestId)) : null
  const unread = notifications.filter((n) => !n.read).length

  // "/" and Ctrl/Cmd+K jump to search. "/" is ignored while typing in another field.
  useEffect(() => {
    const onKeyDown = (event) => {
      const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
      } else if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  const closeHelp = () => {
    setHelpOpen(false)
    helpButtonRef.current?.focus()
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const openRequest = (req, close) => {
    close()
    const status = (req.status || 'Pending').toLowerCase()
    const id = req.id || req._id
    navigate(status === 'draft' || status === 'pending' ? `/request/${id}/intake` : `/request/${id}`)
  }

  return (
    <>
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/70 bg-surface/80 px-4 py-3 shadow-sm backdrop-blur-xl sm:px-6 lg:px-8">
        <Link to="/lead-requests" className="flex shrink-0 items-center gap-2" aria-label="Quarry home">
          <BrandLogo className="h-8 w-8 shrink-0 rounded-xl shadow-md shadow-primary-500/25" />
          <span className="hidden text-lg font-black tracking-tight text-ink sm:block">Quarry</span>
        </Link>

        <nav aria-label="Main" className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto md:order-none md:mx-0 md:w-auto">
          {NAV.map((item) => (
            <NavItem key={item.to} {...item} pathname={pathname} />
          ))}
        </nav>

        {activeRequest && (
          <Menu
            label={`Switch request, current: ${activeRequest.title || 'Untitled request'}`}
            align="left"
            buttonClassName="flex max-w-[11rem] items-center gap-1.5 rounded-xl border border-line bg-surface/80 px-3 py-2 text-xs font-semibold text-ink shadow-sm sm:max-w-[16rem]"
            panelClassName="w-72 py-1"
            button={
              <>
                <FolderDot aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" />
                <span className="truncate">{activeRequest.title || 'Untitled request'}</span>
                <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-muted" />
              </>
            }
          >
            {({ close }) => (
              <div className="max-h-64 overflow-y-auto">
                {requests.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted">No requests yet</p>
                ) : (
                  requests.filter(Boolean).map((req) => {
                    const id = req.id || req._id
                    const current = String(id) === String(requestId)
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-current={current ? 'true' : undefined}
                        onClick={() => openRequest(req, close)}
                        className={clsx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-head', current ? 'font-semibold text-primary-800 dark:text-primary-300' : 'text-ink')}
                      >
                        <span className="truncate">{req.title || 'Untitled request'}</span>
                        {current && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                      </button>
                    )
                  })
                )}
              </div>
            )}
          </Menu>
        )}

        <div className="ml-auto hidden min-w-[9rem] max-w-xs flex-1 items-center gap-2 rounded-xl border border-line bg-surface/80 px-3.5 shadow-sm transition-all focus-within:border-primary-400 focus-within:ring-4 focus-within:ring-primary-500/10 md:flex lg:max-w-sm">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
          <input
            ref={searchRef}
            type="search"
            aria-label="Search requests"
            placeholder="Search requests"
            value={globalSearchQuery}
            onChange={(e) => setGlobalSearchQuery(e.target.value)}
            className="h-9 w-full bg-transparent text-sm text-ink placeholder:text-muted/80 focus:outline-none"
          />
          <kbd aria-hidden="true" className="whitespace-nowrap rounded border border-line px-1.5 py-0.5 text-[10px] font-semibold text-muted">
            Ctrl K
          </kbd>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Link to="/new-request" className="btn-primary !h-9 !px-3.5">
            <Plus aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">New request</span>
          </Link>

          <Menu
            label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
            buttonClassName={clsx(ICON_BUTTON, 'relative')}
            panelClassName="w-80 sm:w-96"
            button={
              <>
                <Bell aria-hidden="true" className="h-4 w-4" />
                {unread > 0 && <span aria-hidden="true" className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-bad" />}
              </>
            }
          >
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">Notifications</span>
              {unread > 0 && (
                <button type="button" onClick={markAllRead} className="text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300">
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {notifications.length === 0 ? (
                <li className="px-4 py-8 text-center text-sm text-muted">Nothing new</li>
              ) : (
                notifications.map((n) => (
                  <li key={n.id} className={clsx('flex items-start gap-3 p-3.5', n.read && 'opacity-70')}>
                    <NotificationIcon type={n.type} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="truncate text-sm font-semibold text-ink">{n.title}</p>
                        <span className="shrink-0 text-xs text-muted">{n.time}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-muted">{n.description}</p>
                      <div className="mt-1.5 flex gap-3 text-xs font-semibold">
                        <button type="button" onClick={() => toggleRead(n.id)} className="text-muted hover:text-ink">
                          {n.read ? 'Mark unread' : 'Mark read'}
                        </button>
                        <button type="button" onClick={() => clearNotification(n.id)} className="text-bad hover:underline">
                          Delete
                        </button>
                      </div>
                    </div>
                  </li>
                ))
              )}
            </ul>
          </Menu>

          <button ref={helpButtonRef} type="button" aria-label="Help" onClick={() => setHelpOpen(true)} className={clsx(ICON_BUTTON, 'hidden sm:flex')}>
            <HelpCircle aria-hidden="true" className="h-4 w-4" />
          </button>

          <PaletteSwitcher />

          <button type="button" aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} onClick={toggleTheme} className={ICON_BUTTON}>
            {theme === 'light' ? <Moon aria-hidden="true" className="h-4 w-4" /> : <Sun aria-hidden="true" className="h-4 w-4" />}
          </button>

          <Menu
            label="Account menu"
            buttonClassName="flex h-9 w-9 items-center justify-center rounded-full border border-white/70 bg-gradient-to-br from-primary-100 to-accent-200 text-xs font-bold text-primary-800 shadow-sm ring-1 ring-primary-200/60 transition-all hover:ring-4 hover:ring-primary-500/15 active:scale-95 dark:border-line dark:from-primary-950 dark:to-accent-900 dark:text-primary-300 dark:ring-primary-900/60"
            panelClassName="w-64 py-1"
            button={initialsOf(user?.name || user?.email)}
          >
            {({ close }) => (
              <>
                <div className="border-b border-line px-4 py-3">
                  <p className="text-xs text-muted">Signed in as</p>
                  <p className="mt-1 truncate text-sm font-semibold text-ink">{user?.name || 'User'}</p>
                  <p className="truncate text-xs text-muted">{user?.email || ''}</p>
                </div>
                <div className="py-1">
                  <Link to="/profile" onClick={close} className="flex items-center gap-2.5 px-4 py-2 text-sm text-ink hover:bg-head">
                    <UserCircle aria-hidden="true" className="h-4 w-4 text-muted" />
                    Account settings
                  </Link>
                  <button type="button" onClick={handleLogout} className="flex w-full items-center gap-2.5 px-4 py-2 text-left text-sm font-semibold text-bad hover:bg-head">
                    <LogOut aria-hidden="true" className="h-4 w-4" />
                    Log out
                  </button>
                </div>
              </>
            )}
          </Menu>
        </div>
      </header>

      {helpOpen && <HelpDrawer onClose={closeHelp} />}
    </>
  )
}
