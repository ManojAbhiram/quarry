/**
 * What we know about an email address, as text (never colour alone).
 *
 *  - Verified: the mailbox was confirmed
 *  - Likely:   the domain accepts mail; the mailbox itself was not checked
 *  - Risky:    could bounce or reach nobody (catch-all domain, shared inbox such as info@, disposable provider)
 *  - Invalid:  will not deliver
 *  - Unchecked: no email, or it was never verified
 *
 * New records carry `email_status`, `email_checked_at` and `email_status_reason`. Older records only have the
 * `email_verified` boolean and `email_confidence`, which are mapped onto the same labels.
 * `tone` is one of 'ok' | 'info' | 'warn' | 'bad' | 'muted' and maps onto the semantic status tokens.
 */
const STATUS = {
  verified: { label: 'Verified', tone: 'ok', hint: 'The mailbox was verified.' },
  likely: { label: 'Likely', tone: 'info', hint: 'The domain accepts mail; the mailbox was not checked.' },
  risky: { label: 'Risky', tone: 'warn', hint: 'This address may bounce or reach a shared inbox. Use with care.' },
  invalid: { label: 'Invalid', tone: 'bad', hint: 'This address failed verification.' },
}

/** "3 Jan 2026" for an ISO timestamp, or '' when missing or unreadable. */
export function formatChecked(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function emailStatus(lead) {
  const email = lead?.email || lead?.contact_email
  if (!email) return { key: 'unchecked', label: 'Unchecked', tone: 'muted', hint: 'No email address found for this lead.', checkedAt: '', reason: '' }

  const checkedAt = lead.email_checked_at || ''
  const reason = lead.email_status_reason || ''
  const withMeta = (key) => ({ key, ...STATUS[key], checkedAt, reason })

  if (STATUS[lead.email_status]) return withMeta(lead.email_status)

  const verified = lead.email_verified
  const confidence = lead.email_confidence
  if (verified === false || confidence === 'low') return withMeta('invalid')
  if (verified === true && confidence === 'high') return withMeta('verified')
  if (verified === true) return withMeta('likely')
  return { key: 'unchecked', label: 'Unchecked', tone: 'muted', hint: 'This address has not been verified yet.', checkedAt: '', reason: '' }
}

/** The tooltip for a badge: what the status means, why, and when it was checked. */
export function statusTitle(status) {
  const when = formatChecked(status.checkedAt)
  return [status.hint, status.reason && `Reason: ${status.reason}`, when && `Checked ${when}`].filter(Boolean).join(' ')
}
