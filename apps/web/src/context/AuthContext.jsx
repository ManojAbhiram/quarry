import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { STORAGE_KEYS } from '../config/constants'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(() => localStorage.getItem(STORAGE_KEYS.TOKEN))
  const [loading, setLoading] = useState(!!localStorage.getItem(STORAGE_KEYS.TOKEN))

  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
    if (refreshToken) {

      api.logout(refreshToken).catch(() => {})
    }
    localStorage.removeItem(STORAGE_KEYS.TOKEN)
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
    setToken(null)
    setUser(null)
  }, [])


  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    api.get('/users/me')
      .then((u) => setUser(u))
      .catch(() => logout())
      .finally(() => setLoading(false))
  }, [])


  useEffect(() => {
    window.addEventListener('auth:logout', logout)
    return () => window.removeEventListener('auth:logout', logout)
  }, [logout])

  const _applyAuth = ({ access_token, refresh_token, user: u }) => {
    localStorage.setItem(STORAGE_KEYS.TOKEN, access_token)
    localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, refresh_token)
    setToken(access_token)
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
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUser, applyAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
