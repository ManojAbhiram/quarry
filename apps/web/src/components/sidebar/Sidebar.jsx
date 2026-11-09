import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { LogOut, PanelLeftClose, PanelLeftOpen, Plus, X } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import BrandLogo from '../BrandLogo'
import OrgSwitcher from '../OrgSwitcher'
import { NAV_SECTIONS, isActivePath } from './navItems'
import { SIDEBAR } from './useSidebar'

gsap.registerPlugin(useGSAP)

export const SIDEBAR_ID = 'app-sidebar'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
const FOCUS_RING = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface'

function initialsOf(name) {
  if (!name) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return parts[0].slice(0, 2).toUpperCase()
}

function NavLinkItem({ item, pathname, collapsed }) {
  const Icon = item.icon
  const active = isActivePath(pathname, item)
  return (
    <li data-nav-item>
      <Link
        to={item.to}
        data-nav-link
        aria-current={active ? 'page' : undefined}
        title={collapsed ? item.label : undefined}
        className={clsx(
          'relative z-10 flex items-center gap-3 rounded-xl py-2.5 text-sm transition-colors duration-200',
          FOCUS_RING,
          collapsed ? 'justify-center px-0' : 'px-3',
          active ? 'font-semibold text-primary-800 dark:text-primary-300' : 'font-medium text-muted hover:bg-head/80 hover:text-ink',
        )}
      >
        <span data-nav-icon aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center">
          <Icon className="h-[18px] w-[18px]" />
        </span>
        <span className={clsx('truncate', collapsed && 'sr-only')}>{item.label}</span>
      </Link>
    </li>
  )
}

/**
 * The app's left navigation. On desktop it is an in-flow column that can be resized, collapsed to an icon rail
 * or hidden; below 768px it is an off-canvas drawer with a backdrop, a focus trap and Escape-to-close.
 * `sidebar` is the state object from `useSidebar()`.
 */
export default function Sidebar({ sidebar }) {
  const { isMobile, width, mode, collapsed, drawerOpen, visible, setWidth, setMode, toggleRail, closeDrawer } = sidebar
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()

  const rootRef = useRef(null)
  const asideRef = useRef(null)
  const backdropRef = useRef(null)
  const navRef = useRef(null)
  const pillRef = useRef(null)
  const closeRef = useRef(null)
  const reducedRef = useRef(true) // safest default: no motion until matchMedia says otherwise
  const draggingRef = useRef(false)
  const widthInit = useRef(false)
  const pillInit = useRef(false)
  const drawerInit = useRef(false)

  const [dragging, setDragging] = useState(false)
  const [drawerShown, setDrawerShown] = useState(false)
  if (drawerOpen && !drawerShown) setDrawerShown(true)

  const hidden = !isMobile && mode === 'hidden'
  const target = hidden ? 0 : collapsed ? SIDEBAR.RAIL : width

  // The desktop element is rendered with its starting width once (GSAP owns the width afterwards), so there is no layout flash.
  const styleRef = useRef({ key: null, style: null })
  if (styleRef.current.key !== isMobile) {
    styleRef.current = {
      key: isMobile,
      style: isMobile ? null : { width: target, ...(hidden ? { visibility: 'hidden', overflow: 'hidden' } : null) },
    }
  }

  // 1. Reduced-motion preference, kept current by gsap.matchMedia.
  const { contextSafe } = useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add({ reduce: '(prefers-reduced-motion: reduce)', ok: '(prefers-reduced-motion: no-preference)' }, (ctx) => {
        reducedRef.current = !!ctx.conditions.reduce || !ctx.conditions.ok
        return () => {
          reducedRef.current = true
        }
      })
      return () => mm.revert()
    },
    { scope: rootRef },
  )

  // 2. Desktop: slide/collapse the column. While dragging, the width is set directly with no tween.
  useGSAP(
    () => {
      const el = asideRef.current
      if (!el || isMobile) {
        widthInit.current = false
        return
      }
      const done = () => {
        el.style.overflow = hidden ? 'hidden' : ''
        el.style.visibility = hidden ? 'hidden' : ''
        el.style.willChange = ''
      }
      if (!hidden) el.style.visibility = ''
      if (!widthInit.current || draggingRef.current || reducedRef.current) {
        widthInit.current = true
        gsap.killTweensOf(el)
        gsap.set(el, { width: target })
        done()
        return
      }
      gsap.to(el, {
        width: target,
        duration: 0.42,
        ease: 'power3.inOut',
        overwrite: true,
        onStart: () => {
          el.style.overflow = 'hidden'
          el.style.willChange = 'width'
        },
        onComplete: done,
      })
    },
    { scope: rootRef, dependencies: [isMobile, hidden, target] },
  )

  // 3. Mobile: the drawer slides in over a fading backdrop.
  useGSAP(
    () => {
      const drawer = asideRef.current
      const back = backdropRef.current
      if (!isMobile || !drawer || !back) {
        drawerInit.current = false
        return
      }
      const instant = !drawerInit.current || reducedRef.current
      drawerInit.current = true
      const to = drawerOpen ? { xPercent: 0 } : { xPercent: -100 }
      const backTo = { opacity: drawerOpen ? 1 : 0 }
      const finish = () => {
        if (!drawerOpen) setDrawerShown(false)
      }
      if (instant) {
        gsap.set(drawer, to)
        gsap.set(back, backTo)
        finish()
        return
      }
      gsap.to(drawer, { ...to, duration: 0.38, ease: 'power3.out', overwrite: true, onComplete: finish })
      gsap.to(back, { ...backTo, duration: 0.3, ease: 'power1.out', overwrite: true })
    },
    { scope: rootRef, dependencies: [isMobile, drawerOpen] },
  )

  // 4. Staggered entrance of the nav items on first mount and whenever the sidebar is shown again.
  useGSAP(
    () => {
      if (!visible || reducedRef.current) return
      gsap.from('[data-nav-item]', {
        x: -14,
        autoAlpha: 0,
        duration: 0.45,
        ease: 'power3.out',
        stagger: 0.035,
        clearProps: 'transform,opacity,visibility',
      })
    },
    { scope: rootRef, dependencies: [visible, isMobile] },
  )

  // 5. One highlight pill that glides to whichever item is current.
  useGSAP(
    () => {
      const nav = navRef.current
      const pill = pillRef.current
      if (!nav || !pill) return
      if (!visible) return
      const active = nav.querySelector('[aria-current="page"]')
      if (!active) {
        gsap.to(pill, { autoAlpha: 0, duration: reducedRef.current ? 0 : 0.2 })
        return
      }
      const navRect = nav.getBoundingClientRect()
      const rect = active.getBoundingClientRect()
      const vars = { y: rect.top - navRect.top + nav.scrollTop, height: rect.height, autoAlpha: 1 }
      if (!pillInit.current || reducedRef.current) {
        pillInit.current = true
        gsap.set(pill, vars)
      } else {
        gsap.to(pill, { ...vars, duration: 0.5, ease: 'power3.out', overwrite: true })
      }
    },
    { scope: rootRef, dependencies: [pathname, collapsed, visible, isMobile] },
  )

  // Hover and press micro-interactions, delegated from the nav (event handlers need contextSafe).
  const linkOf = (event) => event.target.closest?.('[data-nav-link]')
  const onNavOver = contextSafe((event) => {
    const link = linkOf(event)
    if (!link || reducedRef.current || event.pointerType === 'touch' || link.contains(event.relatedTarget)) return
    gsap.to(link.querySelector('[data-nav-icon]'), { scale: 1.16, duration: 0.25, ease: 'back.out(2.5)', overwrite: 'auto' })
  })
  const onNavOut = contextSafe((event) => {
    const link = linkOf(event)
    if (!link || link.contains(event.relatedTarget)) return
    gsap.to(link.querySelector('[data-nav-icon]'), { scale: 1, duration: 0.2, ease: 'power2.out', overwrite: 'auto', clearProps: 'transform' })
    gsap.to(link, { scale: 1, duration: 0.2, ease: 'power2.out', overwrite: 'auto', clearProps: 'transform' })
  })
  const onNavDown = contextSafe((event) => {
    const link = linkOf(event)
    if (!link || reducedRef.current) return
    gsap.to(link, { scale: 0.97, duration: 0.1, ease: 'power2.out', overwrite: 'auto' })
  })
  const onNavUp = contextSafe((event) => {
    const link = linkOf(event)
    if (!link) return
    gsap.to(link, { scale: 1, duration: 0.3, ease: 'back.out(3)', overwrite: 'auto', clearProps: 'transform' })
  })

  // Mobile drawer: focus moves in on open, Tab is trapped, Escape closes, focus goes back to where it was.
  useEffect(() => {
    if (!isMobile || !drawerOpen) return undefined
    const previous = document.activeElement
    const frame = requestAnimationFrame(() => closeRef.current?.focus())
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeDrawer()
        return
      }
      if (event.key !== 'Tab' || !asideRef.current) return
      const items = [...asideRef.current.querySelectorAll(FOCUSABLE)].filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true')
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (!asideRef.current.contains(document.activeElement)) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKeyDown)
      if (previous && document.contains(previous) && typeof previous.focus === 'function') previous.focus()
    }
  }, [isMobile, drawerOpen, closeDrawer])

  // Dragging: no text selection, resize cursor everywhere.
  useEffect(() => {
    if (!dragging) return undefined
    document.body.classList.add('select-none', 'cursor-col-resize')
    return () => document.body.classList.remove('select-none', 'cursor-col-resize')
  }, [dragging])

  const onHandlePointerDown = (event) => {
    if (event.button !== undefined && event.button !== 0) return
    event.preventDefault()
    draggingRef.current = true
    setDragging(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }
  const onHandlePointerMove = (event) => {
    if (!draggingRef.current || !asideRef.current) return
    const raw = event.clientX - asideRef.current.getBoundingClientRect().left
    if (raw < SIDEBAR.SNAP) {
      setMode('collapsed')
    } else {
      setMode('open')
      setWidth(raw)
    }
  }
  const onHandlePointerUp = (event) => {
    draggingRef.current = false
    setDragging(false)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }
  const onHandleKeyDown = (event) => {
    const step = SIDEBAR.STEP * (event.shiftKey ? 3 : 1)
    let handled = true
    if (event.key === 'ArrowRight') {
      if (collapsed) {
        setMode('open')
        setWidth(SIDEBAR.MIN)
      } else setWidth(width + step)
    } else if (event.key === 'ArrowLeft') {
      if (collapsed) return
      if (width <= SIDEBAR.MIN) setMode('collapsed')
      else setWidth(width - step)
    } else if (event.key === 'Home') {
      setMode('open')
      setWidth(SIDEBAR.MIN)
    } else if (event.key === 'End') {
      setMode('open')
      setWidth(SIDEBAR.MAX)
    } else handled = false
    if (handled) event.preventDefault()
  }
  const resetWidth = () => {
    setMode('open')
    setWidth(SIDEBAR.DEFAULT)
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const rail = collapsed
  const innerWidth = isMobile ? undefined : rail ? SIDEBAR.RAIL : width
  const name = user?.name || user?.email || 'User'

  return (
    <div ref={rootRef} className="contents">
      {isMobile && (
        <div
          ref={backdropRef}
          aria-hidden="true"
          data-testid="sidebar-backdrop"
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]"
          style={{ visibility: drawerShown ? 'visible' : 'hidden' }}
        />
      )}
      <aside
        key={isMobile ? 'drawer' : 'rail'}
        ref={asideRef}
        id={SIDEBAR_ID}
        aria-label={isMobile ? 'Navigation menu' : 'Sidebar'}
        role={isMobile && drawerShown ? 'dialog' : undefined}
        aria-modal={isMobile && drawerShown ? 'true' : undefined}
        data-state={isMobile ? (drawerOpen ? 'open' : 'closed') : mode}
        style={isMobile ? { visibility: drawerShown ? 'visible' : 'hidden' } : styleRef.current.style}
        className={clsx(
          'border-r border-line/70 bg-surface/90 shadow-lift backdrop-blur-xl',
          isMobile ? 'fixed inset-y-0 left-0 z-50 w-[min(86vw,20rem)]' : 'relative z-30 shrink-0',
        )}
      >
        <div className="relative flex h-full flex-col" style={innerWidth ? { width: innerWidth } : undefined}>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-primary-500/10 to-transparent" />

          <div className={clsx('relative flex shrink-0 gap-2 px-3 pt-4', rail ? 'flex-col items-center' : 'items-center justify-between')} data-nav-item>
            <Link to="/lead-requests" aria-label="Quarry home" className={clsx('flex items-center gap-2.5 rounded-xl', FOCUS_RING)}>
              <BrandLogo className="h-9 w-9 shrink-0 rounded-xl shadow-md shadow-primary-500/25" />
              {!rail && <span className="text-lg font-black tracking-tight text-ink">Quarry</span>}
            </Link>
            {isMobile ? (
              <button ref={closeRef} type="button" aria-label="Close menu" onClick={closeDrawer} className={clsx('flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-head hover:text-ink', FOCUS_RING)}>
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={rail ? 'Expand sidebar' : 'Collapse sidebar to icons'}
                title={rail ? 'Expand sidebar' : 'Collapse to icons'}
                onClick={toggleRail}
                className={clsx('flex h-9 w-9 items-center justify-center rounded-xl text-muted transition-colors hover:bg-head hover:text-ink', FOCUS_RING)}
              >
                {rail ? <PanelLeftOpen aria-hidden="true" className="h-[18px] w-[18px]" /> : <PanelLeftClose aria-hidden="true" className="h-[18px] w-[18px]" />}
              </button>
            )}
          </div>

          <div className="relative shrink-0 space-y-3 px-3 pt-4" data-nav-item>
            <Link
              to="/new-request"
              title={rail ? 'New request' : undefined}
              className={clsx('btn-primary', FOCUS_RING, rail ? '!h-10 !w-10 mx-auto !px-0' : 'w-full')}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              <span className={clsx(rail && 'sr-only')}>New request</span>
            </Link>
            <OrgSwitcher block={!rail} compact={rail} />
          </div>

          <nav ref={navRef} aria-label="Main" className="scrollbar-hide relative mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
            <span
              ref={pillRef}
              aria-hidden="true"
              data-testid="nav-pill"
              className="pointer-events-none absolute inset-x-2 top-0 z-0 rounded-xl bg-primary-50 opacity-0 shadow-sm ring-1 ring-primary-200/70 before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-primary-600 dark:bg-primary-950/60 dark:ring-primary-900/60 dark:before:bg-primary-400"
            />
            {NAV_SECTIONS.map((section, index) => (
              <div key={section.id} className={clsx(index > 0 && 'mt-4')}>
                {rail ? (
                  index > 0 && <div aria-hidden="true" className="mx-3 mb-2 border-t border-line/70" />
                ) : null}
                <h2 className={clsx(rail ? 'sr-only' : 'px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted')}>{section.label}</h2>
                <ul className="space-y-0.5" onPointerOver={onNavOver} onPointerOut={onNavOut} onPointerDown={onNavDown} onPointerUp={onNavUp} onPointerCancel={onNavUp}>
                  {section.items.map((item) => (
                    <NavLinkItem key={item.to} item={item} pathname={pathname} collapsed={rail} />
                  ))}
                </ul>
              </div>
            ))}
          </nav>

          <div className="relative shrink-0 border-t border-line/70 p-3" data-nav-item>
            <div className={clsx('flex items-center gap-3', rail && 'flex-col')}>
              <span
                aria-hidden="true"
                title={rail ? name : undefined}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/70 bg-gradient-to-br from-primary-100 to-accent-200 text-xs font-bold text-primary-800 shadow-sm ring-1 ring-primary-200/60 dark:border-line dark:from-primary-950 dark:to-accent-900 dark:text-primary-300 dark:ring-primary-900/60"
              >
                {initialsOf(user?.name || user?.email)}
              </span>
              {!rail && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink">{user?.name || 'User'}</p>
                  <p className="truncate text-xs text-muted">{user?.email || ''}</p>
                </div>
              )}
              <button
                type="button"
                onClick={handleLogout}
                title={rail ? 'Log out' : undefined}
                className={clsx('flex h-9 items-center justify-center gap-2 rounded-xl text-sm font-semibold text-bad transition-colors hover:bg-bad-soft', FOCUS_RING, rail ? 'w-9' : 'shrink-0 px-2.5')}
              >
                <LogOut aria-hidden="true" className="h-4 w-4" />
                <span className={clsx(rail && 'sr-only')}>Log out</span>
              </button>
            </div>
          </div>
        </div>

        {!isMobile && !hidden && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-controls={SIDEBAR_ID}
            aria-valuemin={SIDEBAR.MIN}
            aria-valuemax={SIDEBAR.MAX}
            aria-valuenow={width}
            aria-valuetext={rail ? 'Collapsed to icons' : `${width} pixels`}
            tabIndex={0}
            data-dragging={dragging || undefined}
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            onDoubleClick={resetWidth}
            onKeyDown={onHandleKeyDown}
            className="group absolute inset-y-0 -right-1.5 z-40 w-3 cursor-col-resize touch-none focus-visible:outline-none"
          >
            <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 rounded-full bg-primary-500/0 transition-colors group-hover:bg-primary-500/50 group-focus-visible:bg-primary-500 group-data-[dragging]:bg-primary-500" />
          </div>
        )}
      </aside>
    </div>
  )
}
