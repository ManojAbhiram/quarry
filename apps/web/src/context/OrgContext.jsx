import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import { STORAGE_KEYS } from '../config/constants'
import { useAuth } from './AuthContext'

const noop = async () => {}
const OrgContext = createContext({ orgs: [], activeOrg: null, role: null, loading: false, switchOrg: () => {}, refresh: noop, can: () => false })

const RANK = { owner: 4, admin: 3, member: 2, viewer: 1 }

function readActive() {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_ORG) || ''
  } catch {
    return ''
  }
}

/** The signed-in user's organizations and which workspace (personal or an organization) is active. */
export function OrgProvider({ children }) {
  const { user } = useAuth()
  const [orgs, setOrgs] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeId, setActiveId] = useState(readActive)

  const persist = useCallback((id) => {
    try {
      if (id) localStorage.setItem(STORAGE_KEYS.ACTIVE_ORG, id)
      else localStorage.removeItem(STORAGE_KEYS.ACTIVE_ORG)
    } catch {
      /* storage can be unavailable (private windows); the in-memory choice still works */
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/orgs')
      const list = Array.isArray(res?.organizations) ? res.organizations : []
      setOrgs(list)
      // A stale choice (left the org, org gone) falls back to the personal workspace.
      setActiveId((current) => {
        if (current && !list.some((o) => o.id === current)) {
          persist('')
          return ''
        }
        return current
      })
      return list
    } catch {
      return []
    } finally {
      setLoading(false)
    }
  }, [persist])

  useEffect(() => {
    if (!user) {
      setOrgs([])
      return
    }
    ;(async () => {
      // An invite link opened while signed out is accepted right after sign-in.
      let pending = ''
      try {
        pending = localStorage.getItem(STORAGE_KEYS.PENDING_INVITE) || ''
      } catch {
        pending = ''
      }
      if (pending) {
        try {
          localStorage.removeItem(STORAGE_KEYS.PENDING_INVITE)
          const joined = await api.post('/orgs/invites/accept', { token: pending })
          if (joined?.id) {
            persist(joined.id)
            setActiveId(joined.id)
          }
        } catch {
          /* an expired or mismatched invite is reported on the invite page; do not block sign-in */
        }
      }
      refresh()
    })()
  }, [user, refresh, persist])

  const switchOrg = useCallback(
    (id) => {
      persist(id || '')
      setActiveId(id || '')
      // Every page reads data for the active workspace, so reload to start from a clean slate.
      window.location.reload()
    },
    [persist],
  )

  const value = useMemo(() => {
    const activeOrg = orgs.find((o) => o.id === activeId) || null
    const role = activeOrg?.role || null
    return {
      orgs,
      activeOrg,
      role,
      loading,
      switchOrg,
      refresh,
      can: (minimum) => !activeOrg || (RANK[role] || 0) >= RANK[minimum],
    }
  }, [orgs, activeId, loading, switchOrg, refresh])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}

export const useOrg = () => useContext(OrgContext)
