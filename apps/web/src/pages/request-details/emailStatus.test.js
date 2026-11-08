import { describe, it, expect } from 'vitest'
import { emailStatus } from './emailStatus'

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
})
