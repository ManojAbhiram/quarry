import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EmailStatusBadge } from './ui'

describe('EmailStatusBadge', () => {
  it('shows the status word, with reason and date in the tooltip and the date as text', () => {
    render(<EmailStatusBadge showDate lead={{ email: 'a@b.co', email_status: 'risky', email_status_reason: 'Catch-all domain', email_checked_at: '2026-01-03T10:00:00Z' }} />)
    const badge = screen.getByText('Risky')
    expect(badge.closest('[data-email-status]')).toHaveAttribute('data-email-status', 'risky')
    expect(badge.closest('[title]').getAttribute('title')).toMatch(/Catch-all domain/)
    expect(screen.getByText(/Checked .*2026/)).toBeInTheDocument()
  })

  it('omits the date text unless asked', () => {
    render(<EmailStatusBadge lead={{ email: 'a@b.co', email_status: 'verified', email_checked_at: '2026-01-03T10:00:00Z' }} />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.queryByText(/Checked/)).not.toBeInTheDocument()
  })
})
