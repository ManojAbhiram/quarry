/**
 * What we know about a lead's email address, as text (never colour alone).
 *
 *  - Verified:  verified, high confidence
 *  - Likely:    verified, medium confidence (the domain accepts mail; the mailbox itself was not checked)
 *  - Invalid:   verification failed, or confidence is low
 *  - Unchecked: no email, or it was never verified
 *
 * `tone` is one of 'ok' | 'warn' | 'bad' | 'muted' and maps onto the semantic status tokens.
 */
export function emailStatus(lead) {
  const email = lead?.email || lead?.contact_email
  if (!email) return { key: 'unchecked', label: 'Unchecked', tone: 'muted', hint: 'No email address found for this lead.' }

  const verified = lead.email_verified
  const confidence = lead.email_confidence

  if (verified === false || confidence === 'low') {
    return { key: 'invalid', label: 'Invalid', tone: 'bad', hint: 'This address failed verification.' }
  }
  if (verified === true && confidence === 'high') {
    return { key: 'verified', label: 'Verified', tone: 'ok', hint: 'The mailbox was verified.' }
  }
  if (verified === true) {
    return { key: 'likely', label: 'Likely', tone: 'warn', hint: 'The domain accepts mail; the mailbox was not checked.' }
  }
  return { key: 'unchecked', label: 'Unchecked', tone: 'muted', hint: 'This address has not been verified yet.' }
}
