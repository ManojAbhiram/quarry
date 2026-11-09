import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({ api: { getLists: vi.fn().mockResolvedValue({ lists: [] }) } }))
vi.mock('../api.p3', () => ({
  outreachApi: {
    mailboxes: vi.fn(), sequences: vi.fn(), createMailbox: vi.fn(), testMailbox: vi.fn(), createSequence: vi.fn(),
    stats: vi.fn(), start: vi.fn(), pause: vi.fn(), enroll: vi.fn(), preview: vi.fn(), preflight: vi.fn(),
    resumeMailbox: vi.fn(), deleteMailbox: vi.fn(),
  },
}))

import { outreachApi } from '../api.p3'
import Outreach from './Outreach'

async function openDialog(user) {
  render(<ToastProvider><Outreach /></ToastProvider>)
  await user.click(screen.getByRole('tab', { name: 'Mailboxes' }))
  await user.click((await screen.findAllByRole('button', { name: 'Connect mailbox' }))[0])
  const dialog = await screen.findByRole('dialog')
  await user.type(within(dialog).getByLabelText(/Email address/), 'me@x.test')
  await user.type(within(dialog).getByLabelText(/SMTP host/), 'smtp.invalid')
  await user.type(within(dialog).getByLabelText(/SMTP password/), 'secret')
  return dialog
}

describe('Connect mailbox: test connection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    outreachApi.mailboxes.mockResolvedValue({ mailboxes: [] })
    outreachApi.sequences.mockResolvedValue({ sequences: [] })
  })

  it('shows per-protocol results from the test', async () => {
    outreachApi.testMailbox.mockResolvedValue({
      ok: false, smtp: { ok: true, error: null }, imap: { ok: false, error: 'IMAP login was rejected' },
    })
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Test connection' }))
    const list = await within(dialog).findByRole('list', { name: 'Connection test results' })
    expect(list).toHaveTextContent('SMTP: connected')
    expect(list).toHaveTextContent('IMAP: failed')
    expect(list).toHaveTextContent('IMAP login was rejected')
    expect(outreachApi.testMailbox).toHaveBeenCalledWith(expect.objectContaining({ smtp_host: 'smtp.invalid' }))
  })

  it('shows a request failure as a failed SMTP result', async () => {
    outreachApi.testMailbox.mockRejectedValue(new Error('Network down'))
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Test connection' }))
    expect(await within(dialog).findByText('Network down')).toBeInTheDocument()
  })

  it('warns, without blocking, when the saved mailbox failed its test', async () => {
    outreachApi.createMailbox.mockResolvedValue({ _id: 'm1', warning: 'Saved, but the connection test failed. SMTP: timed out' })
    const user = userEvent.setup()
    const dialog = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText(/Saved, but the connection test failed/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
