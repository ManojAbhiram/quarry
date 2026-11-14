import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../api', () => ({
  api: { getUsageSummary: vi.fn(), getUsageEstimate: vi.fn(), runSample: vi.fn(), getVerifierSettings: vi.fn(), setVerifierSettings: vi.fn(), deleteVerifierKey: vi.fn() },
}))

import { api } from '../api'
import { ToastProvider } from './kit'
import UsageCard from './UsageCard'
import LaunchCostPanel from './request/LaunchCostPanel'
import VerifierSettings from '../pages/profile/VerifierSettings'

const summary = {
  runs: 3, samples: 1, search_calls: 40, llm_calls: 25, cost_usd: 0.5,
  quota: { runs: 30, cost_usd: 20, runs_left: 27, cost_left_usd: 19.5 },
  unit_prices: { search_call_usd: 0.001, llm_call_usd: 0.002 },
}
const estimate = {
  num_leads: 20, search_calls: 190, llm_calls: 200, fits_quota: true,
  cost_usd: { low: 0.4, typical: 0.7, high: 1.1 }, assumptions: ['6 search queries, from 4 ICP criteria'],
  quota: { runs_left: 27, cost_left_usd: 19.5 },
}

describe('UsageCard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows runs and spend against the quota', async () => {
    api.getUsageSummary.mockResolvedValue(summary)
    render(<UsageCard />)
    expect(await screen.findByText('3 of 30')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Runs' })).toHaveAttribute('aria-valuenow', '10')
    expect(screen.getByText('$0.50 of $20.00')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Runs' }).firstElementChild).toHaveStyle({ width: '10%' })
  })

  it('uses an accessible transform meter in the dashboard without animating layout', async () => {
    api.getUsageSummary.mockResolvedValue(summary)
    render(<UsageCard dashboard />)
    await screen.findByText('3 of 30')
    const meter = screen.getByRole('progressbar', { name: 'Runs' })
    expect(meter).toHaveAttribute('aria-valuetext', '3 of 30')
    expect(meter.firstElementChild).toHaveStyle({ transform: 'scaleX(0.1)' })
    expect(meter.firstElementChild.style.width).toBe('')
  })

  it('caps an over-quota dashboard meter and retains its warning', async () => {
    api.getUsageSummary.mockResolvedValue({ ...summary, runs: 31 })
    render(<UsageCard dashboard />)
    await screen.findByText('31 of 30')
    const meter = screen.getByRole('progressbar', { name: 'Runs' })
    expect(meter).toHaveAttribute('aria-valuenow', '100')
    expect(meter.firstElementChild).toHaveStyle({ transform: 'scaleX(1)' })
    expect(meter.firstElementChild).toHaveClass('bg-bad')
  })

  it('shows an error with retry', async () => {
    api.getUsageSummary.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(summary)
    render(<UsageCard />)
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByText('3 of 30')).toBeInTheDocument()
  })
})

describe('LaunchCostPanel', () => {
  beforeEach(() => vi.clearAllMocks())
  const panel = () => render(<LaunchCostPanel numLeads={20} icpDimensions={{ a: 'x' }} buildPayload={() => ({ num_leads: 20 })} />)

  it('shows the estimate with its assumptions', async () => {
    api.getUsageEstimate.mockResolvedValue(estimate)
    panel()
    expect(await screen.findByText('$0.70')).toBeInTheDocument()
    expect(screen.getByText('6 search queries, from 4 ICP criteria')).toBeInTheDocument()
    expect(api.getUsageEstimate).toHaveBeenCalledWith(20, { a: 'x' })
  })

  it('warns when the run may not fit the quota', async () => {
    api.getUsageEstimate.mockResolvedValue({ ...estimate, fits_quota: false })
    panel()
    expect(await screen.findByRole('alert')).toHaveTextContent(/exceed your monthly limit/i)
  })

  it('says the estimate is unavailable but does not block launching', async () => {
    api.getUsageEstimate.mockRejectedValue(new Error('x'))
    panel()
    expect(await screen.findByText(/estimate is not available/i)).toBeInTheDocument()
  })

  it('runs a sample and lists the candidates', async () => {
    api.getUsageEstimate.mockResolvedValue(estimate)
    api.runSample.mockResolvedValue({ query: 'saas hiring', sample_cost_usd: 0.003, samples: [{ title: 'Acme', url: 'https://acme.com', snippet: 'We sell' }] })
    panel()
    await userEvent.click(await screen.findByRole('button', { name: /run a sample first/i }))
    expect(await screen.findByRole('link', { name: 'Acme' })).toHaveAttribute('href', 'https://acme.com')
    expect(api.runSample).toHaveBeenCalledWith({ num_leads: 20 })
    expect(screen.getByRole('button', { name: /run sample again/i })).toBeInTheDocument()
  })

  it('shows a sample error', async () => {
    api.getUsageEstimate.mockResolvedValue(estimate)
    api.runSample.mockRejectedValue(new Error('Add your Serper API key'))
    panel()
    await userEvent.click(await screen.findByRole('button', { name: /run a sample first/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add your Serper API key')
  })
})

describe('VerifierSettings', () => {
  beforeEach(() => vi.clearAllMocks())
  const settings = { provider: null, has_key: false, masked: null, smtp_probe: false, providers: [{ name: 'zerobounce', label: 'ZeroBounce' }] }
  const renderIt = () => render(<ToastProvider><VerifierSettings /></ToastProvider>)

  it('requires a key when a provider is chosen, then saves it', async () => {
    const user = userEvent.setup()
    api.getVerifierSettings.mockResolvedValue(settings)
    api.setVerifierSettings.mockResolvedValue({ ...settings, provider: 'zerobounce', has_key: true, masked: '••••1234' })
    renderIt()
    await user.selectOptions(await screen.findByLabelText(/paid provider/i), 'zerobounce')
    await user.click(screen.getByRole('button', { name: /save settings/i }))
    expect(await screen.findByText(/paste the api key/i)).toBeInTheDocument()
    expect(api.setVerifierSettings).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/provider api key/i), 'zb-secret-1234')
    await user.click(screen.getByRole('button', { name: /save settings/i }))
    await waitFor(() => expect(api.setVerifierSettings).toHaveBeenCalledWith({ provider: 'zerobounce', smtp_probe: false, api_key: 'zb-secret-1234' }))
    expect(await screen.findByRole('button', { name: /remove key/i })).toBeInTheDocument()
  })

  it('shows a load error with retry', async () => {
    api.getVerifierSettings.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(settings)
    renderIt()
    await userEvent.click(await screen.findByRole('button', { name: /try again/i }))
    expect(await screen.findByLabelText(/paid provider/i)).toBeInTheDocument()
  })
})
