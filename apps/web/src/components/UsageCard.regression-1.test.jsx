// Regression: ISSUE-004 — per-call unit prices (fractions of a cent) were rounded to "$0.00" on the usage card
// Found by /qa on 2026-11-09
// Report: .gstack/qa-reports/run-20261109T110620Z/
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../api', () => ({
  api: {
    getUsageSummary: vi.fn().mockResolvedValue({
      runs: 0,
      search_calls: 0,
      llm_calls: 0,
      samples: 0,
      spend_usd: 0,
      quota: { runs: 30, usd: 20, runs_left: 30 },
      unit_prices: { search_call_usd: 0.001, llm_call_usd: 0.002 },
    }),
  },
}))

import UsageCard from './UsageCard'

describe('UsageCard unit prices', () => {
  it('shows sub-cent prices instead of $0.00', async () => {
    render(<UsageCard />)
    const note = await screen.findByText(/Spend is an estimate at about/)
    expect(note).toHaveTextContent('$0.001 per search')
    expect(note).toHaveTextContent('$0.002 per model call')
    expect(note).not.toHaveTextContent('$0.00 per')
  })
})
