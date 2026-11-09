import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../api.p3', () => ({ watchApi: { leadSignals: vi.fn(), signals: vi.fn() } }))

import { watchApi } from '../../api.p3'
import { LeadSignals, RowSignals } from './SignalChips'
import { domainOf, groupByDomain } from './signals'

const sig = (kind, summary, detected_at, domain = 'acme.test') => ({ _id: `${kind}${detected_at}`, kind, summary, detected_at, domain })

describe('signal helpers', () => {
  it('normalises domains the way the API does', () => {
    expect(domainOf('https://www.Acme.test/careers')).toBe('acme.test')
    expect(domainOf('acme.test')).toBe('acme.test')
    expect(domainOf('')).toBe('')
  })

  it('groups newest first by domain', () => {
    const g = groupByDomain([sig('tech', 'a', '2026-11-01T00:00:00Z'), sig('hiring', 'b', '2026-11-05T00:00:00Z'), sig('funding', 'c', '2026-11-03T00:00:00Z', 'other.test')])
    expect(g['acme.test'].map((s) => s.kind)).toEqual(['hiring', 'tech'])
    expect(Object.keys(g)).toHaveLength(2)
  })
})

describe('LeadSignals (drawer)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a loading state, then chips with kind and date', async () => {
    let resolve
    watchApi.leadSignals.mockReturnValue(new Promise((r) => { resolve = r }))
    render(<LeadSignals leadId="L1" />)
    expect(screen.getByRole('status', { name: 'Loading signals' })).toBeInTheDocument()
    resolve({ signals: [sig('hiring', '3 new roles', '2026-11-05T12:00:00Z'), sig('funding', 'Series A', '2026-11-02T12:00:00Z')] })
    const list = await screen.findByRole('list', { name: 'Detected signals' })
    expect(list).toHaveTextContent('Hiring')
    expect(list).toHaveTextContent('Funding')
    expect(list).toHaveTextContent(/Nov 5/)
    expect(screen.getByTitle('Series A')).toBeInTheDocument()
    expect(watchApi.leadSignals).toHaveBeenCalledWith('L1')
  })

  it('shows an explanatory empty state', async () => {
    watchApi.leadSignals.mockResolvedValue({ signals: [] })
    render(<LeadSignals leadId="L1" />)
    expect(await screen.findByText(/No hiring, funding or tech changes detected/)).toBeInTheDocument()
  })

  it('shows an error with retry', async () => {
    watchApi.leadSignals.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ signals: [sig('tech', 'Added Stripe', '2026-11-04T00:00:00Z')] })
    const user = userEvent.setup()
    render(<LeadSignals leadId="L1" />)
    await user.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Tech change')).toBeInTheDocument()
  })
})

describe('RowSignals (company rows)', () => {
  it('renders nothing when there are no signals', () => {
    const { container } = render(<RowSignals signals={[]} state="ready" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows a placeholder while loading', () => {
    const { container } = render(<RowSignals signals={undefined} state="loading" />)
    expect(container.firstChild).not.toBeNull()
  })

  it('shows up to three chips and a count of the rest', () => {
    const signals = ['hiring', 'funding', 'tech', 'hiring', 'tech'].map((k, i) => sig(k, 's', `2026-11-0${i + 1}T00:00:00Z`))
    render(<RowSignals signals={signals} state="ready" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
    expect(screen.getByText('+2 more')).toBeInTheDocument()
  })
})
