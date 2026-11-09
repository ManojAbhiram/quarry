import { STORAGE_KEYS } from './config/constants'

/**
 * Client-side session hint. The real session is a pair of HttpOnly cookies that JavaScript cannot read; this flag only
 * records "a session probably exists" so the app knows whether to ask the server who is signed in. It is not a secret
 * and grants nothing: clearing or forging it only changes whether the app makes one extra /users/me request.
 */
export function hasSession() {
  try {
    return localStorage.getItem(STORAGE_KEYS.SESSION) === '1'
  } catch {
    return false
  }
}

export function markSession() {
  try {
    localStorage.setItem(STORAGE_KEYS.SESSION, '1')
  } catch {
    /* storage unavailable: the cookie still authenticates, we just cannot hint on reload */
  }
}

/** Forget the hint, and any token an older version stored in localStorage. */
export function clearSession() {
  try {
    localStorage.removeItem(STORAGE_KEYS.SESSION)
    localStorage.removeItem(STORAGE_KEYS.LEGACY_TOKEN)
    localStorage.removeItem(STORAGE_KEYS.LEGACY_REFRESH_TOKEN)
  } catch {
    /* ignore */
  }
}
