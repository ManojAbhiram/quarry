// Phase 3 endpoints (outreach, integrations, watch, enrichment), kept apart from the core api object.
import { api } from './api'

const e = encodeURIComponent

export const outreachApi = {
  mailboxes: () => api.get('/outreach/mailboxes'),
  testMailbox: (d) => api.post('/outreach/mailboxes/test', d),
  createMailbox: (d) => api.post('/outreach/mailboxes', d),
  updateMailbox: (id, d) => api.put(`/outreach/mailboxes/${e(id)}`, d),
  deleteMailbox: (id) => api.delete(`/outreach/mailboxes/${e(id)}`),
  resumeMailbox: (id) => api.post(`/outreach/mailboxes/${e(id)}/resume`),
  preflight: (id) => api.post(`/outreach/mailboxes/${e(id)}/preflight`),
  sequences: () => api.get('/outreach/sequences'),
  createSequence: (d) => api.post('/outreach/sequences', d),
  updateSequence: (id, d) => api.put(`/outreach/sequences/${e(id)}`, d),
  deleteSequence: (id) => api.delete(`/outreach/sequences/${e(id)}`),
  preview: (id, contact) => api.post(`/outreach/sequences/${e(id)}/preview`, contact ? { contact } : {}),
  start: (id) => api.post(`/outreach/sequences/${e(id)}/start`),
  pause: (id) => api.post(`/outreach/sequences/${e(id)}/pause`),
  stats: (id) => api.get(`/outreach/sequences/${e(id)}/stats`),
  enroll: (id, d) => api.post(`/outreach/sequences/${e(id)}/enroll`, d),
}

export const integrationsApi = {
  keys: () => api.get('/integrations/api-keys'),
  createKey: (d) => api.post('/integrations/api-keys', d),
  revokeKey: (id) => api.delete(`/integrations/api-keys/${e(id)}`),
  webhooks: () => api.get('/integrations/webhooks'),
  createWebhook: (d) => api.post('/integrations/webhooks', d),
  patchWebhook: (id, d) => api.patch(`/integrations/webhooks/${e(id)}`, d),
  deleteWebhook: (id) => api.delete(`/integrations/webhooks/${e(id)}`),
  testWebhook: (id) => api.post(`/integrations/webhooks/${e(id)}/test`),
  exportToWebhook: (source, id, webhookId) => api.post('/integrations/export', { source, id, destination: 'webhook', webhook_id: webhookId }),
}

export const watchApi = {
  searches: () => api.get('/watch/searches'),
  createSearch: (d) => api.post('/watch/searches', d),
  deleteSearch: (id) => api.delete(`/watch/searches/${e(id)}`),
  runSearch: (id) => api.post(`/watch/searches/${e(id)}/run`),
  signals: (kind) => api.get(`/watch/signals${kind ? `?kind=${e(kind)}` : ''}`),
  scan: () => api.post('/watch/scan'),
}

export const enrichApi = {
  credits: () => api.get('/enrichment/credits'),
  setKey: (provider, key) => api.put(`/enrichment/keys/${e(provider)}`, { key }),
  deleteKey: (provider) => api.delete(`/enrichment/keys/${e(provider)}`),
}
