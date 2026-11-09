// Regression: ISSUE-001 — a mailbox connected on the Mailboxes tab did not appear in the new-sequence dialog's
// "Send from" list until the page was reloaded, which left "Create sequence" disabled.
// Found by /qa on 2026-11-09
// Report: .gstack/qa-reports/run-20261109T110620Z/
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({ api: { getLists: vi.fn().mockResolvedValue({ lists: [] }) } }))
vi.mock('../api.p3', () => ({
  outreachApi: {
    mailboxes: vi.fn(), sequences: vi.fn(), createMailbox: vi.fn(), createSequence: vi.fn(),
    stats: vi.fn(), start: vi.fn(), pause: vi.fn(), enroll: vi.fn(), preview: vi.fn(), preflight: vi.fn(),
    resumeMailbox: vi.fn(), deleteMailbox: vi.fn(),
  },
}))

import { outreachApi } from '../api.p3'
import Outreach from './Outreach'

describe('Outreach mailbox list stays in sync', () => {
  let saved
  beforeEach(() => {
    vi.clearAllMocks()
    saved = false
    outreachApi.mailboxes.mockImplementation(async () => ({
      mailboxes: saved ? [{ _id: 'm1', email: 'me@x.test', daily_cap: 40, warmup: true, paused: false }] : [],
    }))
    outreachApi.sequences.mockResolvedValue({ sequences: [] })
    outreachApi.createMailbox.mockImplementation(async () => {
      saved = true
      return { _id: 'm1' }
    })
  })

  it('offers a just-connected mailbox in the sequence dialog without a reload', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Outreach />
      </ToastProvider>,
    )

    await user.click(screen.getByRole('tab', { name: 'Mailboxes' }))
    await user.click((await screen.findAllByRole('button', { name: 'Connect mailbox' }))[0])
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/Email address/), 'me@x.test')
    await user.type(within(dialog).getByLabelText(/SMTP host/), 'smtp.x.test')
    await user.type(within(dialog).getByLabelText(/SMTP password/), 'secret')
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }))
    expect(outreachApi.createMailbox).toHaveBeenCalled()

    await user.click(screen.getByRole('tab', { name: 'Sequences' }))
    await user.click((await screen.findAllByRole('button', { name: 'New sequence' }))[0])
    const seqDialog = await screen.findByRole('dialog')
    expect(within(seqDialog).getByLabelText('Send from')).toHaveDisplayValue('me@x.test')
  })
})
