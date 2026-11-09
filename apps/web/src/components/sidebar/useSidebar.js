import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

export const SIDEBAR = { MIN: 200, MAX: 420, DEFAULT: 264, RAIL: 68, SNAP: 150, STEP: 16 }
export const WIDTH_KEY = 'quarry.sidebar.width'
export const STATE_KEY = 'quarry.sidebar.state'
export const MOBILE_QUERY = '(max-width: 767px)'

const clampWidth = (w) => Math.min(SIDEBAR.MAX, Math.max(SIDEBAR.MIN, Math.round(w)))

function readWidth() {
  try {
    const raw = localStorage.getItem(WIDTH_KEY)
    const n = raw === null ? NaN : Number(raw)
    return Number.isFinite(n) && n > 0 ? clampWidth(n) : SIDEBAR.DEFAULT
  } catch {
    return SIDEBAR.DEFAULT
  }
}

function readMode() {
  try {
    const v = localStorage.getItem(STATE_KEY)
    return v === 'collapsed' || v === 'hidden' ? v : 'open'
  } catch {
    return 'open'
  }
}

function matchesMobile() {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.(MOBILE_QUERY).matches
  } catch {
    return false
  }
}

/**
 * State for the app sidebar. `mode` is 'open' | 'collapsed' (icons-only rail) | 'hidden'. Width and mode are
 * persisted and read synchronously on first render so the layout is right before the first paint. Below 768px
 * the sidebar is an off-canvas drawer controlled by `drawerOpen`; Ctrl/Cmd+B toggles whichever applies.
 */
export function useSidebar() {
  const { pathname } = useLocation()
  const [isMobile, setIsMobile] = useState(matchesMobile)
  const [width, setWidthState] = useState(readWidth)
  const [mode, setModeState] = useState(readMode)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const lastVisible = useRef(mode === 'hidden' ? 'open' : mode)

  useEffect(() => {
    let mql
    try {
      mql = window.matchMedia(MOBILE_QUERY)
    } catch {
      return undefined
    }
    if (!mql) return undefined
    const onChange = (e) => setIsMobile(e.matches)
    setIsMobile(mql.matches)
    if (mql.addEventListener) mql.addEventListener('change', onChange)
    else mql.addListener?.(onChange)
    return () => {
      if (mql.removeEventListener) mql.removeEventListener('change', onChange)
      else mql.removeListener?.(onChange)
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(width))
      localStorage.setItem(STATE_KEY, mode)
    } catch {
      /* storage unavailable: the sidebar just will not remember itself */
    }
  }, [width, mode])

  // Navigating, or leaving the mobile layout, closes the drawer.
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname, isMobile])

  const setMode = useCallback((next) => {
    if (next !== 'hidden') lastVisible.current = next
    setModeState(next)
  }, [])

  const setWidth = useCallback((w) => setWidthState(clampWidth(w)), [])

  const toggle = useCallback(() => {
    if (isMobile) setDrawerOpen((o) => !o)
    else setMode(mode === 'hidden' ? lastVisible.current : 'hidden')
  }, [isMobile, mode, setMode])

  const toggleRail = useCallback(() => setMode(mode === 'collapsed' ? 'open' : 'collapsed'), [mode, setMode])
  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'b') {
        if (event.target?.isContentEditable) return
        event.preventDefault()
        toggle()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [toggle])

  return {
    isMobile,
    width,
    mode,
    drawerOpen,
    visible: isMobile ? drawerOpen : mode !== 'hidden',
    collapsed: !isMobile && mode === 'collapsed',
    setWidth,
    setMode,
    toggle,
    toggleRail,
    closeDrawer,
  }
}
