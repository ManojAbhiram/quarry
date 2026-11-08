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
    localStorage.setItem('token', 'old')
    localStorage.setItem('refresh_token', 'ref')
    vi.stubGlobal('fetch', vi.fn())
    window.addEventListener('auth:logout', onLogout)
  })
  afterEach(() => {
    window.removeEventListener('auth:logout', onLogout)
    vi.unstubAllGlobals()
  })

  it('does not sign the user out when the refresh fails only because the network is down', async () => {
    fetch.mockReturnValueOnce(json(401, { detail: 'expired' })) // the original call
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch')) // the refresh attempt
    const error = await api.get('/users/me').catch((e) => e)
    expect(error.isNetworkError).toBe(true)
    expect(loggedOut).toBe(false)
    expect(localStorage.getItem('refresh_token')).toBe('ref')
  })

  it('signs the user out when the server rejects the refresh token', async () => {
    fetch.mockReturnValueOnce(json(401, { detail: 'expired' })) // the original call
    fetch.mockReturnValueOnce(json(401, { detail: 'bad refresh' })) // the refresh attempt
    await expect(api.get('/users/me')).rejects.toBeInstanceOf(Error)
    expect(loggedOut).toBe(true)
    expect(localStorage.getItem('refresh_token')).toBeNull()
  })
})
