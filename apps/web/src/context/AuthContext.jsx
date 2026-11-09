import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { hasSession, markSession, clearSession } from '../session'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // The session lives in HttpOnly cookies JavaScript cannot see; this hint only says whether to ask the server.
  const [loading, setLoading] = useState(() => hasSession())
  // Set when we could not confirm the session (server or network trouble). The session is kept; the UI offers a retry.
  const [bootError, setBootError] = useState(null)

  const logout = useCallback(() => {
    setBootError(null)
    // Best effort: the server drops the session and clears the cookies. A failure must not block signing out here.
    if (hasSession()) api.logout().catch(() => {})
    clearSession()
    setUser(null)
  }, [])


  // Only a server answer of 401/403 means the session is invalid. Network or server trouble must not sign
  // the user out: keep the session and let them retry.
  const loadUser = useCallback(() => {
    setLoading(true)
    setBootError(null)
    return api.get('/users/me')
      .then((u) => setUser(u))
      .catch((err) => {
        if (err?.status === 401 || err?.status === 403) logout()
        else setBootError(err)
      })
      .finally(() => setLoading(false))
  }, [logout])

  useEffect(() => {
    if (!hasSession()) {
      setLoading(false)
      return
    }
    loadUser()
  }, [])


  useEffect(() => {
    window.addEventListener('auth:logout', logout)
    return () => window.removeEventListener('auth:logout', logout)
  }, [logout])

  // The server already set the session cookies; only the user (and the non-secret hint) is kept client-side.
  const _applyAuth = ({ user: u }) => {
    markSession()
    setUser(u)
  }

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password })
    _applyAuth(data)
  }

  const register = async (email, password, name, orgName, orgDomain) => {
    const data = await api.post('/auth/register', { email, password, name, org_name: orgName, org_domain: orgDomain })
    _applyAuth(data)
  }


  const applyAuth = _applyAuth

  const updateUser = (updates) => setUser((prev) => ({ ...prev, ...updates }))

  return (
    <AuthContext.Provider value={{ user, loading, bootError, retry: loadUser, login, register, logout, updateUser, applyAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
