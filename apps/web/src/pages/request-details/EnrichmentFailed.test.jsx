import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../api', () => ({
  api: {
    retryLeadEnrichment: vi.fn(),
    getJob: vi.fn(),
    verifyAndSaveLeadEmail: vi.fn(),
    getLists: vi.fn(() => Promise.resolve({ lists: [] })),
    analyzeIntent: vi.fn(),
    getLeadIntent: vi.fn(() => Promise.resolve(null)),
  },
}))

import { api } from '../../api'
import { ToastProvider } from '../../components/kit'
import LeadDrawer from './LeadDrawer'
import { EnrichmentFailedBadge } from './ui'

const failedLead = {
  _id: 'L1',
  company_name: 'Acme',
  url: 'https://acme.test',
  enrichment_failed: true,
  enrichment_failure_reason: 'The AI provider was unreachable or rejected the request.',
  _originalIndex: 0,
}

const renderDrawer = (lead, props = {}) =>
  render(
    <ToastProvider>
      <LeadDrawer
        lead={lead}
        requestId="r1"
        flags={{}}
        onToggleFlag={() => {}}
        onClose={() => {}}
        onPatch={() => {}}
        onViewDecisionMakers={() => {}}
        {...props}
      />
    </ToastProvider>,
  )

describe('EnrichmentFailedBadge', () => {
  it('renders nothing for a healthy lead', () => {
    const { container } = render(<EnrichmentFailedBadge lead={{ enrichment_failed: false }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('names the problem in text and keeps the reason as a tooltip', () => {
    render(<EnrichmentFailedBadge lead={failedLead} />)
    const badge = screen.getByText('Enrichment failed')
    expect(badge.closest('span')).toHaveAttribute('title', failedLead.enrichment_failure_reason)
  })
})

describe('LeadDrawer enrichment failure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not show the notice for a healthy lead', () => {
    renderDrawer({ ...failedLead, enrichment_failed: false })
    expect(screen.queryByText('Enrichment failed for this company')).not.toBeInTheDocument()
  })

  it('explains the blanks and offers a retry', () => {
    renderDrawer(failedLead)
    expect(screen.getByText('Enrichment failed for this company')).toBeInTheDocument()
    expect(screen.getByText(/AI provider was unreachable/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry enrichment/ })).toBeEnabled()
  })

  it('queues a retry, polls the job, and reloads the results when it succeeds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const onRefresh = vi.fn()
    api.retryLeadEnrichment.mockResolvedValue({ job_id: 'J1', status: 'queued' })
    api.getJob.mockResolvedValueOnce({ status: 'running' }).mockResolvedValueOnce({ status: 'succeeded', result: { enrichment_failed: false } })
    renderDrawer(failedLead, { onRefresh })

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /Retry enrichment/ }))
    expect(api.retryLeadEnrichment).toHaveBeenCalledWith('L1')
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1))
  })

  it('shows why when the retry job fails, and lets the user try again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    api.retryLeadEnrichment.mockResolvedValue({ job_id: 'J2' })
    api.getJob.mockResolvedValue({ status: 'failed', error: 'RuntimeError: nothing extracted' })
    renderDrawer(failedLead)

    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole('button', { name: /Retry enrichment/ }))
    await act(async () => { await vi.advanceTimersByTimeAsync(2100) })
    expect(await screen.findByText(/nothing extracted/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retry enrichment/ })).toBeEnabled()
  })

  it('reports a network failure when the retry cannot be queued', async () => {
    api.retryLeadEnrichment.mockRejectedValue(Object.assign(new Error('x'), { isNetworkError: true }))
    renderDrawer(failedLead)
    await userEvent.click(screen.getByRole('button', { name: /Retry enrichment/ }))
    expect(await screen.findByText(/Can't reach Quarry/)).toBeInTheDocument()
  })
})
