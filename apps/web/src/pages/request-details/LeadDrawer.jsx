import { useState } from 'react'
import CompanyLogo from '../../components/CompanyLogo'
import { List, MailCheck } from 'lucide-react'
import { api } from '../../api'
import IntentPanel from '../../components/intent/IntentPanel'
import { Button, Menu, useToast } from '../../components/kit'
import { contactOf, leadKey, matchScore } from './leadHelpers'
import { Dash, Drawer, EmailStatusBadge, ExtLink, Tag } from './ui'
import { actionItems } from './LeadActions'
import ListPicker from './ListPicker'
import { emailStatus } from './emailStatus'

function Stat({ label, children }) {
  return (
    <div className="rounded-lg border border-line p-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 break-words text-base font-semibold tabular-nums text-ink">{children || <Dash />}</dd>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <section className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-ink">{title}</h3>
      {children}
    </section>
  )
}

/** One lead in full. Opens as a side panel; Escape or the close button dismisses it. */
export default function LeadDrawer({ lead, requestId, flags, onToggleFlag, onClose, onPatch, onViewDecisionMakers }) {
  const toast = useToast()
  const [verifying, setVerifying] = useState(false)
  if (!lead) return null

  const name = leadKey(lead)
  const contact = contactOf(lead)
  const email = lead.email || lead.contact_email
  const leadId = lead._id || lead.id
  const canVerify = Boolean(email) && emailStatus(lead).key === 'unchecked' && Boolean(leadId)

  const verify = async () => {
    if (verifying) return
    setVerifying(true)
    try {
      const res = await api.verifyAndSaveLeadEmail(String(leadId))
      onPatch(lead._originalIndex, { email_verified: res.verified, email_confidence: res.confidence })
    } catch (err) {
      console.error('Email verification failed:', err)
      toast.push({ type: 'error', message: 'Could not verify this email. Please try again.' })
    } finally {
      setVerifying(false)
    }
  }

  const tech = Array.isArray(lead.tech_stack) ? lead.tech_stack : []
  const signals = Array.isArray(lead.signals) ? lead.signals : []

  return (
    <Drawer
      open
      onClose={onClose}
      title={name}
      icon={<CompanyLogo name={name} website={lead.url} size="h-11 w-11" />}
      subtitle={lead.industry || 'Industry not available'}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="secondary" onClick={onViewDecisionMakers}>View decision makers</Button>
          <Menu
            label="Add to list"
            align="right"
            buttonClassName="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink hover:bg-head"
            button={<><List aria-hidden="true" className="h-4 w-4" />Add to list</>}
            panelClassName="!bottom-full !top-auto !mt-0 mb-2"
          >
            {({ close }) => <ListPicker leadIds={[leadId]} onDone={close} />}
          </Menu>
        </div>
      }
    >
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Match score">{lead.match_score != null ? Math.round(matchScore(lead)) : null}</Stat>
        <Stat label="Employees">{lead.employee_size_estimate}</Stat>
        <Stat label="Growth">{lead.growth}</Stat>
        <Stat label="Funding">{lead.funding_stage}</Stat>
      </dl>

      {lead.match_explanation && (
        <Section title="Why it matches">
          <p className="text-sm text-ink break-words">{lead.match_explanation}</p>
        </Section>
      )}

      <Section title="Status in this run">
        <p className="text-sm text-muted">
          {[flags.saved && 'Saved', flags.excluded && 'Excluded', flags.valid && 'Marked valid', flags.invalid && 'Marked invalid'].filter(Boolean).join(', ') || 'No marks yet.'}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {actionItems(flags).map(({ kind, label, Icon }) => (
            <Button key={kind} variant="secondary" size="sm" onClick={() => onToggleFlag(name, kind)}>
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              {label}
            </Button>
          ))}
        </div>
      </Section>

      <Section title="Contact">
        <div className="rounded-lg border border-line p-3">
          {contact.name && (
            <p className="text-sm text-ink break-words">
              <span className="font-semibold">{contact.name}</span>
              {contact.title && <span className="text-muted">, {contact.title}</span>}
            </p>
          )}
          {email ? (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <a href={`mailto:${email}`} className="break-all text-sm text-primary-700 hover:underline dark:text-primary-300">{email}</a>
              <EmailStatusBadge lead={lead} />
              {canVerify && (
                <Button variant="secondary" size="sm" loading={verifying} onClick={verify}>
                  {!verifying && <MailCheck aria-hidden="true" className="h-3.5 w-3.5" />}
                  Verify email
                </Button>
              )}
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted">No email address found. <EmailStatusBadge lead={lead} className="ml-1" /></p>
          )}
          {email && <p className="mt-1 text-xs text-muted">{emailStatus(lead).hint}</p>}
          {lead.phone && <p className="mt-1 text-sm text-ink">{lead.phone}</p>}
        </div>
      </Section>

      <Section title="Company">
        <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Location</dt>
          <dd className="break-words text-ink">{lead.location || <Dash />}</dd>
          <dt className="text-muted">Source</dt>
          <dd className="break-all text-ink">{lead.source_url ? <ExtLink href={lead.source_url}>{lead.source_url}</ExtLink> : <Dash />}</dd>
          <dt className="text-muted">Links</dt>
          <dd className="flex flex-wrap gap-x-4 gap-y-1">
            {[['Website', lead.url], ['LinkedIn', lead.linkedin_url], ['Crunchbase', lead.crunchbase_url], ['X', lead.x_url || lead.twitter_url]].filter(([, href]) => href).map(([label, href]) => (
              <ExtLink key={label} href={href}>{label}</ExtLink>
            ))}
            {![lead.url, lead.linkedin_url, lead.crunchbase_url, lead.x_url, lead.twitter_url].some(Boolean) && <Dash />}
          </dd>
        </dl>
      </Section>

      <Section title="Technology">
        {tech.length > 0 ? <div className="flex flex-wrap gap-1.5">{tech.map((t, i) => <Tag key={i}>{t}</Tag>)}</div> : <p className="text-sm text-muted">No technology detected.</p>}
      </Section>

      <Section title="Growth signals">
        {signals.length > 0 ? <div className="flex flex-wrap gap-1.5">{signals.map((s, i) => <Tag key={i}>{s}</Tag>)}</div> : <p className="text-sm text-muted">No growth signals found.</p>}
      </Section>

      <div className="mt-6 border-t border-line pt-6">
        <IntentPanel key={lead._originalIndex} lead={lead} requestId={requestId} leadIndex={lead._originalIndex} onUpdate={(data) => onPatch(lead._originalIndex, data)} />
      </div>
    </Drawer>
  )
}
