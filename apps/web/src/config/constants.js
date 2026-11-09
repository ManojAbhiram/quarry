/**
 * Centralized frontend configuration.
 *
 * Single source of truth for values that were previously hardcoded and
 * duplicated across components (localStorage keys, UI timing, branding,
 * API base URL). Import from here instead of repeating literals.
 */

// API base URL — overridable per environment via VITE_API_URL.
export const API_BASE = import.meta.env.VITE_API_URL || '/api'

// localStorage keys. Auth tokens live in HttpOnly cookies, never here: SESSION is only a "probably signed in" hint
// (no secret) and the LEGACY_* keys are removed on load because older versions stored tokens in them.
export const STORAGE_KEYS = {
  SESSION: 'session',
  LEGACY_TOKEN: 'token',
  LEGACY_REFRESH_TOKEN: 'refresh_token',
  THEME: 'theme',
  PALETTE: 'palette',
}

// UI timing in milliseconds (values match previous in-component literals).
export const UI = {
  COPY_FEEDBACK_MS: 2000,
  PROFILE_SAVED_MS: 2500,
  DIRECT_REDIRECT_MS: 3500,
  REQUEST_REDIRECT_MS: 4000,
}
