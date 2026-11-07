import { useState, useEffect, useRef } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { useLeads } from '../context/LeadContext'
import BrandLogo from './BrandLogo'
import {
  Search,
  Bell,
  HelpCircle,
  UserCircle,
  LogOut,
  Sun,
  Moon,
  ChevronDown,
  FolderDot,
  Check,
  List
} from 'lucide-react'

export default function Header() {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { 
    requests, 
    globalSearchQuery, 
    setGlobalSearchQuery,
    notifications,
    markAllRead,
    toggleRead,
    clearNotification 
  } = useLeads()
  const navigate = useNavigate()
  const location = useLocation()

  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [isRequestSwitcherOpen, setIsRequestSwitcherOpen] = useState(false)
  const [showNotifications, setShowNotifications] = useState(false)
  const [showHelpDrawer, setShowHelpDrawer] = useState(false)

  const dropdownRef = useRef(null)
  const switcherRef = useRef(null)
  const notificationsRef = useRef(null)
  const helpRef = useRef(null)

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // Detect active request from route path
  const match = location.pathname.match(/\/request\/([^\/]+)/)
  const requestId = match ? match[1] : null
  const activeRequest = requestId ? requests.find((r) => r && String(r.id || r._id || "") === String(requestId)) : null

  // Helper to extract initials from name or email
  const getInitials = (name) => {
    if (!name) return 'U'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    }
    return parts[0].slice(0, 2).toUpperCase()
  }

  const initials = getInitials(user?.name || user?.email)

  // Click outside to dismiss dropdowns
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsDropdownOpen(false)
      }
      if (switcherRef.current && !switcherRef.current.contains(event.target)) {
        setIsRequestSwitcherOpen(false)
      }
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) {
        setShowNotifications(false)
      }
      if (helpRef.current && !helpRef.current.contains(event.target) && !event.target.closest('#help-trigger-btn')) {
        setShowHelpDrawer(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <>
      <header className="sticky top-0 z-30 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-800/80 px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between gap-4 shadow-sm select-none transition-colors duration-300">
      {/* Left Section: Logo, Request Switcher & Desktop Links */}
      <div className="flex items-center gap-4 lg:gap-6">
        <NavLink
          to="/lead-requests"
          className="flex items-center shrink-0 hover:opacity-90 active:scale-98 transition-all cursor-pointer"
        >
          <BrandLogo className="w-8 h-8 rounded-xl shadow-md shadow-primary-500/20 shrink-0" />
          <span className="hidden sm:block text-lg font-black text-slate-900 dark:text-white tracking-tight ml-2.5">
            Quarry
          </span>
        </NavLink>

        {/* Dynamic Request Switcher Dropdown */}
        {activeRequest && (
          <div className="flex items-center gap-3 shrink-0">
            {/* Vertical Divider */}
            <div className="h-5 w-[1px] bg-slate-200 dark:bg-slate-800"></div>

            <div className="relative" ref={switcherRef}>
              <button
                type="button"
                onClick={() => setIsRequestSwitcherOpen((prev) => !prev)}
                className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-all bg-slate-50 dark:bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-850 shadow-sm cursor-pointer select-none active:scale-98"
              >
                <FolderDot className="w-3.5 h-3.5 text-primary-500" />
                <span className="max-w-[120px] sm:max-w-[200px] truncate">
                  {activeRequest.title || 'Untitled Request'}
                </span>
                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${isRequestSwitcherOpen ? 'rotate-180' : ''}`} />
              </button>

              {isRequestSwitcherOpen && (
                <div className="absolute left-0 top-full mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-2 z-50 animate-fade-in">
                  <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-850">
                    <p className="text-[10px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">Switch Request</p>
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {requests.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-slate-450 dark:text-slate-500 italic">No requests found</p>
                    ) : (
                      requests.map((req) => {
                        if (!req) return null
                        const rId = req.id || req._id
                        const isCurrent = String(rId) === String(requestId)
                        return (
                          <button
                            key={rId}
                            type="button"
                            onClick={() => {
                              setIsRequestSwitcherOpen(false)
                              const sClean = (req.status || 'Pending').toLowerCase()
                              if (sClean === 'draft' || sClean === 'pending') {
                                navigate(`/request/${rId}/intake`)
                              } else {
                                navigate(`/request/${rId}`)
                              }
                            }}
                            className={`w-full flex items-center justify-between text-left px-4 py-2.5 text-xs font-bold transition-all hover:bg-slate-50 dark:hover:bg-slate-800/40 ${
                              isCurrent
                                ? 'text-primary-600 dark:text-primary-400 bg-primary-50/30 dark:bg-primary-950/10'
                                : 'text-slate-655 dark:text-slate-450 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            <span className="truncate pr-4">{req.title || 'Untitled Request'}</span>
                            {isCurrent && <Check className="w-3.5 h-3.5 text-primary-500 shrink-0" />}
                          </button>
                        )
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Center Section: Global Search Bar */}
      <div className="hidden sm:flex items-center gap-2 bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-slate-800 rounded-xl px-3.5 py-1.5 w-full max-w-[320px] lg:max-w-[420px] transition-all focus-within:ring-2 focus-within:ring-violet-500/20 focus-within:border-violet-400">
        <Search className="w-4 h-4 text-slate-400 shrink-0" />
        <input
          type="text"
          placeholder="Search companies, people, or settings..."
          value={globalSearchQuery}
          onChange={(e) => setGlobalSearchQuery(e.target.value)}
          className="bg-transparent focus:outline-none text-xs font-semibold w-full text-slate-700 dark:text-slate-300 placeholder-slate-400 dark:placeholder-slate-500"
        />
        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 bg-slate-200/50 dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200/30 dark:border-slate-700/50 select-none">
          Ctrl K
        </span>
      </div>

      {/* Right Section: Notification, Help, Theme Toggle & Avatar */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Notification Bell */}
        <div className="relative" ref={notificationsRef}>
          <button
            onClick={() => setShowNotifications(prev => !prev)}
            className="relative w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-all shadow-sm hover:shadow active:scale-95 cursor-pointer"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            {notifications.some(n => !n.read) && (
              <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
            )}
          </button>

          {showNotifications && (
            <div className="absolute right-0 top-full mt-2.5 w-80 sm:w-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-2 z-50 animate-fade-in">
              <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
                <span className="text-[10px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase">Notifications</span>
                {notifications.some(n => !n.read) && (
                  <button
                    onClick={markAllRead}
                    className="text-[10px] font-bold text-violet-600 hover:text-violet-700 dark:text-violet-400 dark:hover:text-violet-300 active:scale-98 transition-all cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto py-1 divide-y divide-slate-100 dark:divide-slate-850">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 dark:text-slate-500 italic text-xs">
                    No new notifications
                  </div>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      className={`p-3.5 flex items-start gap-3 transition-colors ${
                        n.read ? 'opacity-70 hover:opacity-100' : 'bg-violet-50/10 dark:bg-violet-950/5'
                      }`}
                    >
                      {/* Icon */}
                      <div className="mt-0.5 shrink-0">
                        {n.type === 'success' ? (
                          <div className="w-6 h-6 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-655 flex items-center justify-center">
                            <Check className="w-3.5 h-3.5" />
                          </div>
                        ) : n.type === 'warning' ? (
                          <div className="w-6 h-6 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-500 flex items-center justify-center font-bold text-xs">
                            !
                          </div>
                        ) : (
                          <div className="w-6 h-6 rounded-lg bg-blue-50 dark:bg-blue-950/30 text-blue-500 flex items-center justify-center font-bold text-xs">
                            i
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className={`text-xs font-bold text-slate-850 dark:text-slate-200 truncate ${n.read ? '' : 'text-violet-900 dark:text-violet-450'}`}>
                            {n.title}
                          </p>
                          <span className="text-[9px] text-slate-400 dark:text-slate-500 shrink-0 font-medium">{n.time}</span>
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                          {n.description}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <button
                            onClick={() => toggleRead(n.id)}
                            className="text-[9px] font-bold text-slate-400 dark:text-slate-550 hover:text-slate-600 dark:hover:text-slate-350 cursor-pointer"
                          >
                            {n.read ? 'Mark unread' : 'Mark read'}
                          </button>
                          <button
                            onClick={() => clearNotification(n.id)}
                            className="text-[9px] font-bold text-rose-500 hover:text-rose-600 cursor-pointer"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Help Circle */}
        <button
          id="help-trigger-btn"
          onClick={() => setShowHelpDrawer(prev => !prev)}
          className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-all shadow-sm hover:shadow active:scale-95 cursor-pointer"
          title="Help"
        >
          <HelpCircle className="w-4 h-4" />
        </button>



        {/* Theme Toggle Button */}
        <button
          onClick={toggleTheme}
          className="w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white transition-all shadow-sm hover:shadow active:scale-95 cursor-pointer"
          title={theme === 'light' ? 'Switch to Dark Mode' : 'Switch to Light Mode'}
        >
          {theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4 text-amber-500" />}
        </button>

        {/* User initials Avatar Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-100 to-indigo-200 dark:from-primary-950/60 dark:to-indigo-900/60 flex items-center justify-center text-xs font-bold text-primary-700 dark:text-primary-400 border border-white dark:border-slate-800 shadow-sm transition-all hover:ring-2 hover:ring-indigo-500/20 active:scale-95 cursor-pointer"
          >
            {initials}
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 top-full mt-2.5 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl py-2 z-50 animate-fade-in">
              {/* User Info Header */}
              <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-850">
                <p className="text-[10px] font-bold tracking-wider text-slate-400 dark:text-slate-500 uppercase leading-none">Signed in as</p>
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-2 truncate leading-none">{user?.name || 'User'}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate mt-1 leading-none">{user?.email || ''}</p>
              </div>


              {/* Navigation Items */}
              <div className="py-1.5 border-b border-slate-100 dark:border-slate-850">
                <NavLink
                  to="/lead-lists"
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold transition-all ${isActive
                      ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-400'
                      : 'text-slate-655 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white'
                    }`
                  }
                  onClick={() => setIsDropdownOpen(false)}
                >
                  <List className="w-4 h-4 text-slate-400" />
                  <span>Lead Lists</span>
                </NavLink>
                <NavLink
                  to="/profile"
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-4 py-2.5 text-sm font-semibold transition-all ${isActive
                      ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400'
                      : 'text-slate-655 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-white'
                    }`
                  }
                  onClick={() => setIsDropdownOpen(false)}
                >
                  <UserCircle className="w-4 h-4 text-slate-400" />
                  <span>Account Settings</span>
                </NavLink>
              </div>

              {/* Logout Button */}
              <div className="px-2 pt-1.5 pb-0.5">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-bold text-rose-600 dark:text-rose-450 hover:bg-rose-50 dark:hover:bg-rose-955/20 rounded-xl transition-all cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>

      {/* ── STUNNING SLIDE-OUT HELP DRAWER ── */}
      {showHelpDrawer && (
        <div className="fixed inset-0 z-[60] overflow-hidden select-none">
          {/* Overlay background dimmer */}
          <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-xs transition-opacity duration-300" onClick={() => setShowHelpDrawer(false)} />

          <div className="absolute inset-y-0 right-0 max-w-full flex">
            <div
              ref={helpRef}
              className="w-screen max-w-md bg-white/95 dark:bg-slate-900/95 border-l border-slate-200/80 dark:border-slate-800/80 shadow-2xl overflow-hidden relative z-10 flex flex-col h-full backdrop-blur-2xl animate-slide-in"
            >
              {/* Header */}
              <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-850 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="p-1.5 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 rounded-lg">
                    <HelpCircle className="w-4 h-4" />
                  </div>
                  <span className="text-base font-black text-slate-900 dark:text-white">Help Center & Guides</span>
                </div>
                <button
                  onClick={() => setShowHelpDrawer(false)}
                  className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-white rounded-lg transition-colors cursor-pointer text-xl leading-none"
                >
                  &times;
                </button>
              </div>

              {/* Drawer Body Scroll */}
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                {/* Quick Intro */}
                <div className="bg-gradient-to-br from-violet-500/5 to-indigo-650/5 dark:from-violet-500/10 dark:to-indigo-600/10 border border-violet-100 dark:border-violet-900/40 rounded-2xl p-4">
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-350 leading-relaxed">
                    Welcome to the <strong>Quarry SDR Assistant</strong>. Define your Ideal Customer Profile (ICP), run automated queries via Google Serper, and capture qualified leads in minutes.
                  </p>
                </div>

                {/* Detailed Project Flow Guide */}
                <div className="space-y-4">
                  <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">How to Use Quarry</h4>
                  
                  <div className="relative border-l-2 border-violet-200 dark:border-violet-900/50 ml-3 space-y-6 pb-2">
                    
                    {/* Step 1 */}
                    <div className="relative pl-6">
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/50 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">1. Product Intake</h5>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Navigate to the <span className="font-semibold text-slate-700 dark:text-slate-300">New Request</span> page. Input your product name, core value proposition, deployment model, and your target audience. You can optionally seed the AI with known competitors.
                      </p>
                    </div>

                    {/* Step 2 */}
                    <div className="relative pl-6">
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/50 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">2. ICP Generation</h5>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Our AI immediately analyzes your inputs to construct a comprehensive <span className="font-semibold text-slate-700 dark:text-slate-300">Ideal Customer Profile (ICP)</span>. This breaks your audience down into firmographic, technographic, and buying signal dimensions.
                      </p>
                    </div>

                    {/* Step 3 */}
                    <div className="relative pl-6">
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/50 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">3. Deep Sourcing Engine</h5>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Quarry synthesizes advanced Google Dorking queries to scrape live web data. It cross-references directories, software review portals, and company websites to identify qualified target companies.
                      </p>
                    </div>

                    {/* Step 4 */}
                    <div className="relative pl-6">
                      <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/50 border-2 border-white dark:border-slate-900 flex items-center justify-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                      </div>
                      <h5 className="text-xs font-bold text-slate-800 dark:text-slate-200">4. Capture & Export</h5>
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Review the AI-recommended companies in your <span className="font-semibold text-slate-700 dark:text-slate-300">Request Details</span> dashboard. Discover key decision-makers on LinkedIn, verify tech stacks, and export the entire curated list to your CRM.
                      </p>
                    </div>

                  </div>
                </div>

                {/* FAQ Accordions */}
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">Frequently Asked Questions</h4>

                  {/* FAQ 1 */}
                  <details className="group border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/20">
                    <summary className="text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer flex justify-between items-center select-none list-none">
                      <span>How is the ICP generated?</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-open:rotate-180 transition-transform" />
                    </summary>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Based on your Product Intake parameters (deployment model, value proposition, competitors), our AI evaluates the core market and structures the profile into <strong>6 precise dimensions</strong> with calculated fit-confidence levels.
                    </p>
                  </details>

                  {/* FAQ 2 */}
                  <details className="group border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/20">
                    <summary className="text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer flex justify-between items-center select-none list-none">
                      <span>What belongs in technographics?</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-open:rotate-180 transition-transform" />
                    </summary>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Technographic details target technical dependencies such as database management systems, data warehouse engines, analytics SDKs, or cloud architecture profiles.
                    </p>
                  </details>

                  {/* FAQ 3 */}
                  <details className="group border border-slate-200/80 dark:border-slate-800 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-950/20">
                    <summary className="text-xs font-bold text-slate-800 dark:text-slate-200 cursor-pointer flex justify-between items-center select-none list-none">
                      <span>Are third-party directories skipped?</span>
                      <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-open:rotate-180 transition-transform" />
                    </summary>
                    <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                      Massive platforms (like Indeed, Glassdoor, or social networks) are filtered out automatically to ensure high lead quality. Multi-company review portals are treated as <strong>directories</strong> and expanded to discover the listed targets' owned websites.
                    </p>
                  </details>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
