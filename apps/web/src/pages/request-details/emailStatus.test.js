import { describe, it, expect } from 'vitest'
import { emailStatus, formatChecked, statusTitle } from './emailStatus'

describe('emailStatus', () => {
  it('is Verified when the address is verified with high confidence', () => {
    expect(emailStatus({ email: 'a@b.co', email_verified: true, email_confidence: 'high' }).label).toBe('Verified')
  })

  it('is Likely when verified with medium confidence, and explains what that means', () => {
    const status = emailStatus({ email: 'a@b.co', email_verified: true, email_confidence: 'medium' })
    expect(status.label).toBe('Likely')
    expect(status.hint).toMatch(/domain accepts mail/i)
  })

  it('is Invalid when verification failed', () => {
    expect(emailStatus({ email: 'a@b.co', email_verified: false, email_confidence: 'high' }).label).toBe('Invalid')
  })

  it('is Invalid when confidence is low, even if marked verified', () => {
    expect(emailStatus({ email: 'a@b.co', email_verified: true, email_confidence: 'low' }).label).toBe('Invalid')
  })

  it('is Unchecked when there is no email at all', () => {
    expect(emailStatus({ email: '', email_verified: true, email_confidence: 'high' }).label).toBe('Unchecked')
    expect(emailStatus({}).label).toBe('Unchecked')
    expect(emailStatus(null).label).toBe('Unchecked')
  })

  it('is Unchecked when an email exists but was never verified (null)', () => {
    expect(emailStatus({ email: 'a@b.co', email_verified: null }).label).toBe('Unchecked')
    expect(emailStatus({ email: 'a@b.co' }).label).toBe('Unchecked')
  })

  it('falls back to contact_email when email is absent', () => {
    expect(emailStatus({ contact_email: 'a@b.co', email_verified: true, email_confidence: 'high' }).label).toBe('Verified')
  })

  it('uses email_status first: Verified, Likely, Risky and Invalid, with reason and check date', () => {
    const base = { email: 'a@b.co', email_checked_at: '2026-01-03T10:00:00Z', email_status_reason: 'Catch-all domain' }
    expect(emailStatus({ ...base, email_status: 'verified' })).toMatchObject({ label: 'Verified', tone: 'ok' })
    expect(emailStatus({ ...base, email_status: 'likely' })).toMatchObject({ label: 'Likely', tone: 'info' })
    const risky = emailStatus({ ...base, email_status: 'risky' })
    expect(risky).toMatchObject({ label: 'Risky', tone: 'warn', reason: 'Catch-all domain' })
    expect(emailStatus({ ...base, email_status: 'invalid' }).label).toBe('Invalid')
  })

  it('prefers email_status over the legacy fields', () => {
    expect(emailStatus({ email: 'a@b.co', email_status: 'risky', email_verified: true, email_confidence: 'high' }).label).toBe('Risky')
  })

  it('formats the check date and puts reason and date in the tooltip text', () => {
    expect(formatChecked('2026-01-03T10:00:00Z')).toMatch(/2026/)
    expect(formatChecked('nope')).toBe('')
    expect(formatChecked(null)).toBe('')
    const t = statusTitle(emailStatus({ email: 'a@b.co', email_status: 'risky', email_checked_at: '2026-01-03T10:00:00Z', email_status_reason: 'Role account' }))
    expect(t).toMatch(/Reason: Role account/)
    expect(t).toMatch(/Checked .*2026/)
  })
})
