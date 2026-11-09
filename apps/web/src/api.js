import { API_BASE, STORAGE_KEYS } from './config/constants'

const BASE = API_BASE

function getToken() {
  return localStorage.getItem(STORAGE_KEYS.TOKEN)
}

function getRefreshToken() {
  return localStorage.getItem(STORAGE_KEYS.REFRESH_TOKEN)
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

let isRefreshing = false
let refreshQueue = []

function drainQueue(error, token) {
  refreshQueue.forEach((cb) => cb(error, token))
  refreshQueue = []
}

async function doRefresh() {
  const refreshToken = getRefreshToken()
  if (!refreshToken) throw httpError('No refresh token', 401)

  const res = await send(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  })

  if (!res.ok) {
    localStorage.removeItem(STORAGE_KEYS.TOKEN)
    localStorage.removeItem(STORAGE_KEYS.REFRESH_TOKEN)
    throw httpError('Session expired', 401)
  }

  const data = await res.json()
  localStorage.setItem(STORAGE_KEYS.TOKEN, data.access_token)
  localStorage.setItem(STORAGE_KEYS.REFRESH_TOKEN, data.refresh_token)
  return data.access_token
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await send(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register' && path !== '/auth/logout') {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((err, newToken) => {
          if (err) return reject(err)
          resolve(request(method, path, body))
        })
      })
    }

    isRefreshing = true
    try {
      const newToken = await doRefresh()
      isRefreshing = false
      drainQueue(null, newToken)
      return request(method, path, body)
    } catch (err) {
      isRefreshing = false
      drainQueue(err, null)
      // A refresh that failed only because the network is down must not sign the user out.
      if (!err.isNetworkError) window.dispatchEvent(new Event('auth:logout'))
      throw err
    }
  }

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
    throw httpError(detail || 'Request failed', res.status)
  }
  return data
}

async function requestFormData(method, path, formData) {
  const headers = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await send(`${BASE}${path}`, {
    method,
    headers,
    body: formData,
  })

  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register' && path !== '/auth/logout') {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((err) => {
          if (err) return reject(err)
          resolve(requestFormData(method, path, formData))
        })
      })
    }
    isRefreshing = true
    try {
      const newToken = await doRefresh()
      isRefreshing = false
      drainQueue(null, newToken)
      return requestFormData(method, path, formData)
    } catch (err) {
      isRefreshing = false
      drainQueue(err, null)
      // A refresh that failed only because the network is down must not sign the user out.
      if (!err.isNetworkError) window.dispatchEvent(new Event('auth:logout'))
      throw err
    }
  }

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
    throw httpError(detail || 'Request failed', res.status)
  }
  return data
}

async function requestDownload(path, filename) {
  const headers = {}
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await send(`${BASE}${path}`, {
    method: 'GET',
    headers,
  })

  if (res.status === 401 && path !== '/auth/refresh' && path !== '/auth/login' && path !== '/auth/register' && path !== '/auth/logout') {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push((err, newToken) => {
          if (err) return reject(err)
          resolve(requestDownload(path, filename))
        })
      })
    }

    isRefreshing = true
    try {
      const newToken = await doRefresh()
      isRefreshing = false
      drainQueue(null, newToken)
      return requestDownload(path, filename)
    } catch (err) {
      isRefreshing = false
      drainQueue(err, null)
      // A refresh that failed only because the network is down must not sign the user out.
      if (!err.isNetworkError) window.dispatchEvent(new Event('auth:logout'))
      throw err
    }
  }

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

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  delete: (path) => request('DELETE', path),


  logout: (refreshToken) => request('POST', '/auth/logout', { refresh_token: refreshToken }),


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


  createStatusStream: (requestId) => {
    const token = getToken()
    const params = token ? `?token=${encodeURIComponent(token)}` : ''
    return new EventSource(`${BASE}/leads/status/${encodeURIComponent(requestId)}/stream${params}`)
  },


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
  exportLeadsCsv: (source, id) => requestDownload(`/integrations/export/${source}/${encodeURIComponent(id)}.csv`, `quarry_${source}_${id}.csv`),
}
