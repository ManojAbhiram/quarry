import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../../components/kit'

vi.mock('../../api', () => ({ api: { getLists: vi.fn().mockResolvedValue({ lists: [{ _id: 'l1', name: 'Pilot' }] }) } }))
vi.mock('../../api.p3', () => ({
  outreachApi: {
    mailboxes: vi.fn(), sequences: vi.fn(), stats: vi.fn(), start: vi.fn(), pause: vi.fn(), enroll: vi.fn(), preview: vi.fn(),
    createMailbox: vi.fn(), preflight: vi.fn(), resumeMailbox: vi.fn(), deleteMailbox: vi.fn(), createSequence: vi.fn(),
  },
  integrationsApi: { keys: vi.fn(), createKey: vi.fn(), revokeKey: vi.fn(), webhooks: vi.fn(), createWebhook: vi.fn(), testWebhook: vi.fn(), patchWebhook: vi.fn(), deleteWebhook: vi.fn() },
  enrichApi: { credits: vi.fn(), setKey: vi.fn(), deleteKey: vi.fn() },
  watchApi: { searches: vi.fn(), signals: vi.fn(), createSearch: vi.fn(), runSearch: vi.fn(), deleteSearch: vi.fn(), scan: vi.fn() },
}))

import { outreachApi, integrationsApi, enrichApi, watchApi } from '../../api.p3'
import Outreach, { EnrollDialog } from '../Outreach'
import Integrations from '../Integrations'
import Watch from '../Watch'

const wrap = (ui) => render(<ToastProvider>{ui}</ToastProvider>)
const SEQ = { _id: 's1', name: 'Cold intro', status: 'draft', steps: [{}, {}] }

describe('Outreach', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    outreachApi.mailboxes.mockResolvedValue({ mailboxes: [{ _id: 'm1', email: 'me@x.test', daily_cap: 40, warmup: true, paused: true, pause_reason: 'hard bounce rate 5.0%' }] })
    outreachApi.sequences.mockResolvedValue({ sequences: [SEQ] })
  })

  it('lists sequences, starts one and shows reply rate as the headline stat', async () => {
    const user = userEvent.setup()
    outreachApi.start.mockResolvedValue({})
    outreachApi.stats.mockResolvedValue({ reply_rate: 0.125, contacted: 8, replies: 1, bounces: 0, unsubscribes: 0, steps: [{ step: 1, sent: 8, replies: 1, reply_rate: 0.125, bounces: 0 }] })
    wrap(<Outreach />)
    expect(await screen.findByText('Cold intro')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^start$/i }))
    expect(outreachApi.start).toHaveBeenCalledWith('s1')
    await user.click(screen.getByRole('button', { name: 'Stats' }))
    expect(await screen.findByLabelText('Reply rate')).toHaveTextContent('12.5%')
  })

  it('shows the empty state and an error with retry', async () => {
    const user = userEvent.setup()
    outreachApi.sequences.mockResolvedValueOnce({ sequences: [] })
    wrap(<Outreach />)
    expect(await screen.findByText('No sequences yet')).toBeInTheDocument()
    outreachApi.sequences.mockRejectedValueOnce(new Error('down')).mockResolvedValue({ sequences: [SEQ] })
    await user.click(screen.getByRole('tab', { name: 'Mailboxes' }))
    await user.click(screen.getByRole('tab', { name: 'Sequences' }))
    expect(await screen.findByText('Could not load sequences')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('Cold intro')).toBeInTheDocument()
  })

  it('mailboxes tab shows auto-pause reason and runs the DNS check', async () => {
    const user = userEvent.setup()
    outreachApi.preflight.mockResolvedValue({ overall: 'fail', checks: { spf: { status: 'fail', hint: 'Publish SPF' }, dkim: { status: 'warn' }, dmarc: { status: 'pass' } } })
    wrap(<Outreach />)
    await user.click(await screen.findByRole('tab', { name: 'Mailboxes' }))
    expect(await screen.findByText(/Paused: hard bounce/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /check dns/i }))
    expect(await screen.findByText('Publish SPF')).toBeInTheDocument()
    expect(screen.getByText('SPF: fail')).toBeInTheDocument()
  })

  it('EnrollDialog enrolls the selected contacts and reports skips', async () => {
    const user = userEvent.setup()
    outreachApi.enroll.mockResolvedValue({ enrolled: 1, skipped: [{ reason: 'duplicate' }] })
    const onDone = vi.fn()
    wrap(<EnrollDialog open onClose={() => {}} contacts={[{ email: 'a@b.test' }]} sequences={[SEQ]} onDone={onDone} />)
    expect(screen.getByText(/1 contact with an email selected/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /enroll/i }))
    await waitFor(() => expect(outreachApi.enroll).toHaveBeenCalledWith('s1', { contacts: [{ email: 'a@b.test' }] }))
    expect(await screen.findByText('Enrolled 1, skipped 1.')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalled()
  })

  it('EnrollDialog explains when there are no sequences and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    wrap(<EnrollDialog open onClose={onClose} contacts={[]} sequences={[]} />)
    expect(screen.getByText(/Create a sequence/)).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('Integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    integrationsApi.keys.mockResolvedValue({ keys: [{ _id: 'k1', name: 'ci', prefix: 'qk_abc12', revoked_at: null }] })
    integrationsApi.webhooks.mockResolvedValue({ webhooks: [] })
    enrichApi.credits.mockResolvedValue({ balance: 97, providers: [{ provider: 'hunter', credits_per_hit: 1, byo_key: '••••9999', platform_key: false }] })
  })

  it('shows keys, credits and an empty webhook state; reveals a new key once', async () => {
    const user = userEvent.setup()
    integrationsApi.createKey.mockResolvedValue({ _id: 'k2', key: 'qk_secretvalue' })
    wrap(<Integrations />)
    expect(await screen.findByText('qk_abc12…')).toBeInTheDocument()
    expect(await screen.findByText('No webhooks')).toBeInTheDocument()
    expect(await screen.findByText('97')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /create key/i }))
    expect(await screen.findByText('qk_secretvalue')).toBeInTheDocument()
  })

  it('revokes a key', async () => {
    const user = userEvent.setup()
    integrationsApi.revokeKey.mockResolvedValue(null)
    wrap(<Integrations />)
    await user.click(await screen.findByRole('button', { name: 'Revoke ci' }))
    expect(integrationsApi.revokeKey).toHaveBeenCalledWith('k1')
  })

  it('shows an error when a section fails', async () => {
    integrationsApi.keys.mockRejectedValue(new Error('x'))
    wrap(<Integrations />)
    expect(await screen.findByText('Could not load API keys')).toBeInTheDocument()
  })
})

describe('Watch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    watchApi.searches.mockResolvedValue({ searches: [{ _id: 'w1', name: 'Fintech', has_slack: true }] })
    watchApi.signals.mockResolvedValue({ signals: [{ _id: 'e1', kind: 'funding', domain: 'acme.test', summary: 'Acme raises Series B' }] })
  })

  it('lists searches and signals, and runs a search', async () => {
    const user = userEvent.setup()
    watchApi.runSearch.mockResolvedValue({ new: 2 })
    wrap(<Watch />)
    expect(await screen.findByText('Fintech')).toBeInTheDocument()
    expect(await screen.findByText('Acme raises Series B')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('2 new matches.')).toBeInTheDocument()
  })

  it('shows empty states', async () => {
    watchApi.searches.mockResolvedValue({ searches: [] })
    watchApi.signals.mockResolvedValue({ signals: [] })
    wrap(<Watch />)
    expect(await screen.findByText('No saved searches')).toBeInTheDocument()
    expect(await screen.findByText('No signals yet')).toBeInTheDocument()
  })
})
