import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { api } from './api'

const json = (status, body) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) })

describe('api error shape', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('puts the HTTP status on a server error', async () => {
    fetch.mockReturnValueOnce(json(500, { detail: 'boom' }))
    await expect(api.get('/users/me')).rejects.toMatchObject({ message: 'boom', status: 500 })
  })

  it('keeps the validation message and status for a 422', async () => {
    fetch.mockReturnValueOnce(json(422, { detail: [{ msg: 'Field required' }] }))
    await expect(api.get('/x')).rejects.toMatchObject({ message: 'Field required', status: 422 })
  })

  it('marks a failed connection as a network error, not a server answer', async () => {
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const error = await api.get('/users/me').catch((e) => e)
    expect(error.isNetworkError).toBe(true)
    expect(error.status).toBeUndefined()
  })

  it('marks an unreadable response body with its status', async () => {
    fetch.mockReturnValueOnce(Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new Error('bad json')) }))
    await expect(api.get('/x')).rejects.toMatchObject({ status: 502 })
  })
})

describe('api session refresh', () => {
  let loggedOut
  const onLogout = () => {
    loggedOut = true
  }

  beforeEach(() => {
    loggedOut = false
    localStorage.setItem('session', '1')
    document.cookie = 'quarry_csrf=csrf-abc; path=/'
    vi.stubGlobal('fetch', vi.fn())
    window.addEventListener('auth:logout', onLogout)
  })
  afterEach(() => {
    window.removeEventListener('auth:logout', onLogout)
    document.cookie = 'quarry_csrf=; path=/; max-age=0'
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('does not sign the user out when the refresh fails only because the network is down', async () => {
    fetch.mockReturnValueOnce(json(401, { detail: 'expired' })) // the original call
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')) // the refresh attempt
    const error = await api.get('/users/me').catch((e) => e)
    expect(error.isNetworkError).toBe(true)
    expect(loggedOut).toBe(false)
    expect(localStorage.getItem('session')).toBe('1')
  })

  it('signs the user out when the server rejects the refresh token', async () => {
    fetch.mockReturnValueOnce(json(401, { detail: 'expired' })) // the original call
    fetch.mockReturnValueOnce(json(401, { detail: 'bad refresh' })) // the refresh attempt
    await expect(api.get('/users/me')).rejects.toBeInstanceOf(Error)
    expect(loggedOut).toBe(true)
    expect(localStorage.getItem('session')).toBeNull()
  })

  it('refreshes once and retries the original call with the same cookie-based request', async () => {
    fetch.mockReturnValueOnce(json(401, { detail: 'expired' })) // original
    fetch.mockReturnValueOnce(json(200, {})) // refresh
    fetch.mockReturnValueOnce(json(200, { name: 'Asha' })) // retry
    await expect(api.get('/users/me')).resolves.toEqual({ name: 'Asha' })
    expect(fetch).toHaveBeenCalledTimes(3)
    const [refreshUrl, refreshInit] = fetch.mock.calls[1]
    expect(refreshUrl).toMatch(/\/auth\/refresh$/)
    expect(refreshInit).toMatchObject({ method: 'POST', credentials: 'include' })
    expect(refreshInit.headers['X-CSRF-Token']).toBe('csrf-abc')
    expect(refreshInit.body).toBeUndefined() // the refresh token is in the HttpOnly cookie, not JS-visible
  })

  it('shares one refresh between concurrent 401s', async () => {
    fetch.mockImplementation((url) => {
      if (url.endsWith('/auth/refresh')) return json(200, {})
      const first = !fetch.mock.calls.some(([u], i) => u === url && i < fetch.mock.calls.length - 1)
      return first ? json(401, { detail: 'expired' }) : json(200, { ok: true })
    })
    await Promise.all([api.get('/a'), api.get('/b')])
    expect(fetch.mock.calls.filter(([u]) => u.endsWith('/auth/refresh'))).toHaveLength(1)
  })
})

describe('api cookie auth and CSRF', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    document.cookie = 'quarry_csrf=csrf-abc; path=/'
  })
  afterEach(() => {
    document.cookie = 'quarry_csrf=; path=/; max-age=0'
    vi.unstubAllGlobals()
  })

  it('sends credentials on every request and never an Authorization header', async () => {
    fetch.mockReturnValueOnce(json(200, {}))
    await api.get('/users/me')
    const [, init] = fetch.mock.calls[0]
    expect(init.credentials).toBe('include')
    expect(init.headers.Authorization).toBeUndefined()
  })

  it('adds the CSRF header to writes but not to reads', async () => {
    fetch.mockReturnValue(json(200, {}))
    await api.get('/lists')
    await api.post('/lists', { name: 'x' })
    expect(fetch.mock.calls[0][1].headers['X-CSRF-Token']).toBeUndefined()
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('csrf-abc')
  })

  it('falls back to the API for the CSRF token when the cookie is not readable', async () => {
    document.cookie = 'quarry_csrf=; path=/; max-age=0'
    fetch.mockReturnValueOnce(json(200, { csrf_token: 'from-api' })) // GET /auth/csrf
    fetch.mockReturnValueOnce(json(200, {})) // the write
    await api.put('/users/me/serper-key', { serper_api_key: 'k' })
    expect(fetch.mock.calls[0][0]).toMatch(/\/auth\/csrf$/)
    expect(fetch.mock.calls[1][1].headers['X-CSRF-Token']).toBe('from-api')
  })

  it('does not ask for a CSRF token when logging in', async () => {
    document.cookie = 'quarry_csrf=; path=/; max-age=0'
    fetch.mockReturnValueOnce(json(200, { user: {} }))
    await api.post('/auth/login', { email: 'a', password: 'b' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('opens the status stream with credentials and without a token in the URL', () => {
    const ctor = vi.fn()
    vi.stubGlobal('EventSource', ctor)
    api.createStatusStream('r1')
    expect(ctor).toHaveBeenCalledWith(expect.stringMatching(/\/leads\/status\/r1\/stream$/), { withCredentials: true })
  })
})

describe('api legacy token cleanup', () => {
  it('has no token left in localStorage after a sign-out', async () => {
    const { clearSession } = await import('./session')
    localStorage.setItem('token', 'old')
    localStorage.setItem('refresh_token', 'old')
    localStorage.setItem('session', '1')
    clearSession()
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('refresh_token')).toBeNull()
    expect(localStorage.getItem('session')).toBeNull()
  })
})
