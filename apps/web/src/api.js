import { API_BASE, STORAGE_KEYS } from './config/constants'
import { hasSession, markSession, clearSession } from './session'

const BASE = API_BASE

function clearLegacyTokens() {
  try {
    localStorage.removeItem(STORAGE_KEYS.LEGACY_TOKEN)
    localStorage.removeItem(STORAGE_KEYS.LEGACY_REFRESH_TOKEN)
  } catch {
    /* ignore */
  }
}

/**
 * Auth model: the API sets HttpOnly cookies (access + refresh) on login, so no token is ever readable by, or stored
 * in, page JavaScript. The only thing kept in localStorage is a non-secret "a session probably exists" hint, used to
 * decide whether to ask the server who we are. Unsafe requests echo the readable CSRF cookie in `X-CSRF-Token`
 * (double-submit); the server rejects cookie-authenticated writes without it.
 */
const CSRF_COOKIE = 'quarry_csrf'
const CSRF_HEADER = 'X-CSRF-Token'
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']
const AUTH_PATHS = ['/auth/refresh', '/auth/login', '/auth/register', '/auth/logout', '/auth/csrf']
// These do not act on an existing cookie session, so the server does not ask for a CSRF token.
const NO_CSRF_PATHS = ['/auth/login', '/auth/register', '/auth/logout']

// One-time cleanup of tokens stored by older versions.
clearLegacyTokens()

function readCookie(name) {
  if (typeof document === 'undefined') return null
  const hit = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`))
  return hit ? decodeURIComponent(hit.slice(name.length + 1)) : null
}

let csrfFallback = null

/** The CSRF token: from the readable cookie, else (cross-site deployments) from the API once and cached. */
async function getCsrfToken() {
  const fromCookie = readCookie(CSRF_COOKIE)
  if (fromCookie) return fromCookie
  if (csrfFallback) return csrfFallback
  try {
    const res = await fetch(`${BASE}/auth/csrf`, { credentials: 'include' })
    if (res.ok) csrfFallback = (await res.json()).csrf_token || null
  } catch {
    /* the write will fail with a clear 403 if the token was really needed */
  }
  return csrfFallback
}

/** The organization workspace the user switched to ('' = personal). Sent as X-Org-Id; the server verifies it. */
export function getActiveOrgId() {
  try {
    return localStorage.getItem(STORAGE_KEYS.ACTIVE_ORG) || ''
  } catch {
    return ''
  }
}

/** An Error that carries the HTTP status, so callers can tell "the server said no" from "the server is down". */
function httpError(message, status) {
  return Object.assign(new Error(message), { status })
}

/** fetch() that marks a failed connection (offline, DNS, CORS, server down) with `isNetworkError`. */
async function send(url, init) {
  try {
    return await fetch(url, init)
  } catch (cause) {
    throw Object.assign(new Error(cause?.message || 'Network error'), { isNetworkError: true })
  }
}

let refreshPromise = null

async function doRefresh() {
  if (!hasSession()) throw httpError('Not signed in', 401)

  const headers = {}
  const csrf = await getCsrfToken()
  if (csrf) headers[CSRF_HEADER] = csrf
  const res = await send(`${BASE}/auth/refresh`, { method: 'POST', headers, credentials: 'include' })

  if (!res.ok) {
    csrfFallback = null
    clearSession()
    throw httpError('Session expired', 401)
  }
  csrfFallback = null // the server issued a fresh CSRF token with the new session
  markSession()
}

/** Refresh the session once, however many requests hit a 401 at the same time. */
function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = doRefresh()
      .catch((err) => {
        // A refresh that failed only because the network is down must not sign the user out.
        if (!err.isNetworkError) window.dispatchEvent(new Event('auth:logout'))
        throw err
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

/** Send an authenticated request (cookies + CSRF); on a 401 refresh the session once and retry. */
async function authedFetch(path, { method = 'GET', headers = {}, body } = {}) {
  const attempt = async () => {
    const h = { ...headers }
    const orgId = getActiveOrgId()
    if (orgId) h['X-Org-Id'] = orgId
    if (!SAFE_METHODS.includes(method) && !NO_CSRF_PATHS.includes(path)) {
      const csrf = await getCsrfToken()
      if (csrf) h[CSRF_HEADER] = csrf
    }
    return send(`${BASE}${path}`, { method, headers: h, body, credentials: 'include' })
  }

  const res = await attempt()
  if (res.status === 401 && !AUTH_PATHS.includes(path)) {
    await refreshSession()
    return attempt()
  }
  return res
}

async function parseResponse(res) {
  if (res.status === 204) return null

  let data
  try {
    data = await res.json()
  } catch {
    throw httpError(res.ok ? 'Invalid server response' : `Server error (${res.status})`, res.status)
  }

  if (!res.ok) {
    const detail = data.detail
    if (Array.isArray(detail)) {
      throw httpError(detail[0]?.msg || 'Validation error', res.status)
    }
    // Plan-limit errors (402) carry { code, message }.
    throw httpError((detail && typeof detail === 'object' ? detail.message : detail) || 'Request failed', res.status)
  }
  return data
}

async function request(method, path, body) {
  const res = await authedFetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  // Login/register/logout/refresh rotate the CSRF cookie: forget any cached fallback token.
  if (AUTH_PATHS.includes(path)) csrfFallback = null
  return parseResponse(res)
}

async function requestFormData(method, path, formData) {
  const res = await authedFetch(path, { method, body: formData })
  return parseResponse(res)
}

async function requestDownload(path, filename) {
  const res = await authedFetch(path, { method: 'GET' })

  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`)
  }

  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const downloadAnchor = document.createElement('a')
  downloadAnchor.setAttribute("href", url)
  downloadAnchor.setAttribute("download", filename)
  document.body.appendChild(downloadAnchor)
  downloadAnchor.click()
  downloadAnchor.remove()
  URL.revokeObjectURL(url)
}

/** A request that carries no credentials and never tries to refresh a session (for the public opt-out page). */
async function publicRequest(method, path, body) {
  const res = await send(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw httpError(typeof data?.detail === 'string' ? data.detail : 'Something went wrong.', res.status)
  return data
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),


  // The refresh token travels in the HttpOnly cookie; the server clears the cookies.
  logout: () => request('POST', '/auth/logout'),


  createLeadRequest: (data) => request('POST', '/requests', data),


  suggestChip: (data) => request('POST', '/requests/suggest-chip', data),
  generateStructuredIcp: (data, requestId) => request('POST', `/requests/generate-icp${requestId ? `?request_id=${encodeURIComponent(requestId)}` : ''}`, data),
  checkIcpConsistency: (data) => request('POST', '/requests/check-consistency', data),
  createRequest: (data, draftId) => request('POST', `/requests/launch${draftId ? `?draft_id=${encodeURIComponent(draftId)}` : ''}`, data),
  launchDirectCompanies: (data, draftId) => request('POST', `/requests/launch-direct${draftId ? `?draft_id=${encodeURIComponent(draftId)}` : ''}`, data),
  parseCompaniesCsv: (formData) => requestFormData('POST', '/requests/parse-companies-csv', formData),
  analyzeSource: (formData) => requestFormData('POST', '/requests/analyze-source', formData),
  findCompetitors: (requestId) => request('GET', `/requests/find-competitors?request_id=${encodeURIComponent(requestId)}`),
  deleteRequest: (requestId) => request('DELETE', `/requests/${encodeURIComponent(requestId)}`),
  updateLeadRequest: (requestId, data) => request('PUT', `/requests/${encodeURIComponent(requestId)}`, data),
  updateRequestLists: (requestId, data) => request('PUT', `/requests/${encodeURIComponent(requestId)}/lists`, data),


  // EventSource sends the HttpOnly session cookie itself (withCredentials); no token in the URL.
  createStatusStream: (requestId) =>
    new EventSource(`${BASE}/leads/status/${encodeURIComponent(requestId)}/stream`, { withCredentials: true }),


  getDecisionMakers: (requestId) => request('GET', `/leads/decision-makers?request_id=${encodeURIComponent(requestId)}`),


  getSerperKey: () => request('GET', '/users/me/serper-key'),
  setSerperKey: (key) => request('PUT', '/users/me/serper-key', { serper_api_key: key }),
  deleteSerperKey: () => request('DELETE', '/users/me/serper-key'),


  getOrganization: () => request('GET', '/organizations/me'),
  createOrganization: (data) => request('POST', '/organizations', data),
  updateOrganization: (data) => request('PUT', '/organizations/me', data),


  analyzeIntent: (requestId, leadIndex) => request('POST', '/leads/intent/analyze', { request_id: requestId, lead_index: leadIndex }),
  getLeadIntent: (requestId, leadIndex) => request('GET', `/leads/intent/${encodeURIComponent(requestId)}/${leadIndex}`),


  exportCompanies: (requestId, format = 'csv') => requestDownload(`/leads/${encodeURIComponent(requestId)}/export/companies?format=${format}`, `quarry_companies_${requestId}.${format}`),
  exportCompetitors: (requestId, format = 'csv') => requestDownload(`/leads/${encodeURIComponent(requestId)}/export/competitors?format=${format}`, `quarry_competitors_${requestId}.${format}`),
  exportDecisionMakers: (requestId, format = 'csv') => requestDownload(`/leads/${encodeURIComponent(requestId)}/export/decision-makers?format=${format}`, `quarry_all_decision_makers_${requestId}.${format}`),

  // Email Verification
  verifyEmail: (email) => request('POST', '/leads/verify-email', { email }),
  verifyEmailsInBatch: (emails) => request('POST', '/leads/verify-emails-batch', { emails }),
  verifyAndSaveLeadEmail: (leadId) => request('POST', `/leads/${encodeURIComponent(leadId)}/verify-email`),
  getLeadListMemberships: (leadId) => request('GET', `/leads/${encodeURIComponent(leadId)}/lists`),

  // Enrichment retry + background jobs
  retryLeadEnrichment: (leadId) => request('POST', `/leads/${encodeURIComponent(leadId)}/retry-enrichment`),
  getJob: (jobId) => request('GET', `/jobs/${encodeURIComponent(jobId)}`),
  cancelJob: (jobId) => request('POST', `/jobs/${encodeURIComponent(jobId)}/cancel`),

  // Lead Lists
  getLists: () => request('GET', '/lists'),
  createList: (data) => request('POST', '/lists', data),
  getList: (listId) => request('GET', `/lists/${encodeURIComponent(listId)}`),
  updateList: (listId, data) => request('PUT', `/lists/${encodeURIComponent(listId)}`, data),
  deleteList: (listId) => request('DELETE', `/lists/${encodeURIComponent(listId)}`),
  addLeadsToList: (listId, leadIds) => request('POST', `/lists/${encodeURIComponent(listId)}/leads`, { lead_ids: leadIds }),
  removeLeadsFromList: (listId, leadIds) => request('DELETE', `/lists/${encodeURIComponent(listId)}/leads`, { lead_ids: leadIds }),
  getListsForLead: (leadId) => request('GET', `/lists/lead/${encodeURIComponent(leadId)}`),
  exportList: (listId, name = 'list', format = 'csv') => requestDownload(`/lists/${encodeURIComponent(listId)}/export?format=${format}`, `quarry_${name}.${format}`),

  // Email verification settings and contact verification
  getVerifierSettings: () => request('GET', '/verification/settings'),
  setVerifierSettings: (data) => request('PUT', '/verification/settings', data),
  deleteVerifierKey: () => request('DELETE', '/verification/settings/key'),
  verifyDecisionMakerEmail: (dmId) => request('POST', `/verification/decision-makers/${encodeURIComponent(dmId)}/verify`),

  // Cost controls
  getUsageSummary: () => request('GET', '/usage/summary'),
  getUsageEstimate: (numLeads, icpDimensions) => request('POST', '/usage/estimate', { num_leads: numLeads, icp_dimensions: icpDimensions }),
  runSample: (data) => request('POST', '/usage/sample-run', data),

  // Compliance
  getSuppressions: () => request('GET', '/compliance/suppressions'),
  addSuppression: (value, reason = '') => request('POST', '/compliance/suppressions', { value, reason }),
  removeSuppression: (value) => request('DELETE', `/compliance/suppressions?value=${encodeURIComponent(value)}`),
  makeOptOutLink: (email) => request('POST', '/compliance/opt-out-link', { email }),
  erasePerson: (email, addToSuppression = true) => request('POST', '/compliance/erase', { email, add_to_suppression: addToSuppression }),
  getAuditLog: () => request('GET', '/compliance/audit-log'),
  rejectLead: (leadId) => request('POST', `/compliance/leads/${encodeURIComponent(leadId)}/reject`),
  restoreLead: (leadId) => request('POST', `/compliance/leads/${encodeURIComponent(leadId)}/restore`),
  runRetention: (dryRun = false) => request('POST', `/compliance/retention/run?dry_run=${dryRun}`),
  // Public opt-out (no sign-in): the token comes from the link in the email footer.
  getOptOut: (token) => publicRequest('GET', `/public/opt-out?token=${encodeURIComponent(token)}`),
  confirmOptOut: (token) => publicRequest('POST', '/public/opt-out', { token }),
  exportLeadsCsv: (source, id) => requestDownload(`/integrations/export/${source}/${encodeURIComponent(id)}.csv`, `quarry_${source}_${id}.csv`),
}
