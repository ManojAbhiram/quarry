import { useId, useState } from 'react'
import { GlowingEffect } from '@/components/ui/glowing-effect'
import clsx from 'clsx'
import { Pencil, Check, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2, CircleAlert, Layers, Globe, Shield, UserCheck, Activity, Terminal } from 'lucide-react'

const CARD_META = {
  firmographic: { label: 'Firmographics', Icon: Layers },
  technographic: { label: 'Technographics', Icon: Terminal },
  team_structure: { label: 'Team & decision makers', Icon: UserCheck },
  buying_signals: { label: 'Buying signals', Icon: Activity },
  compliance: { label: 'Compliance needs', Icon: Shield },
  deployment_pref: { label: 'Deployment preferences', Icon: Globe },
}

/** High / low / medium confidence as text plus an icon, never colour alone. Unset is treated as high, as before. */
function confidenceBadge(text) {
  const t = (text || '').toLowerCase()
  if (!t || t.includes('high')) return { label: text || 'High confidence', tone: 'bg-ok-soft text-ok', Icon: CheckCircle2 }
  if (t.includes('low')) return { label: text, tone: 'bg-bad-soft text-bad', Icon: AlertTriangle }
  return { label: text, tone: 'bg-warn-soft text-warn', Icon: CircleAlert }
}

function parseIcpBulletPoints(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const cleaned = line.replace(/^[•\-*\d.\s]+/, '').trim()
      const colonIndex = cleaned.indexOf(':')
      if (colonIndex > 0) return { label: cleaned.slice(0, colonIndex).trim(), detail: cleaned.slice(colonIndex + 1).trim() }
      return { label: null, detail: cleaned }
    })
}

export default function IcpCard({ dimensionKey, value, editing, draft, onChangeDraft, onStartEdit, onSave, onCancel }) {
  const meta = CARD_META[dimensionKey] || { label: dimensionKey, Icon: Layers }
  const [expanded, setExpanded] = useState(false)
  const areaId = useId()

  const isObj = typeof value === 'object' && value !== null
  const textValue = isObj ? value.value : value
  const warningText = isObj ? value.warning : null
  const badge = confidenceBadge(isObj ? value.confidence : null)

  const points = parseIcpBulletPoints(textValue)
  const visible = expanded ? points : points.slice(0, 3)

  return (
    <div data-reveal className="relative h-full rounded-2xl">
    <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
    <section aria-label={meta.label} className="card relative flex h-full flex-col ring-1 ring-primary-500/5 hover:-translate-y-0.5 hover:shadow-lift">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-start gap-2 text-sm font-semibold text-ink">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-500 text-white shadow-md ring-1 ring-white/30">
              <meta.Icon aria-hidden="true" className="h-4 w-4" />
            </span>
            <span className="min-w-0 break-words pt-1.5 font-bold tracking-tight">{meta.label}</span>
          </h3>
          {!editing && (
            <button
              type="button"
              onClick={() => onStartEdit(dimensionKey)}
              aria-label={`Edit ${meta.label}`}
              className="inline-flex h-10 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-muted transition-colors hover:bg-head hover:text-ink sm:h-8"
            >
              <Pencil aria-hidden="true" className="h-3 w-3" />
              Edit
            </button>
          )}
        </div>

        <div>
          <span className={clsx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ring-current/15', badge.tone)}>
            <badge.Icon aria-hidden="true" className="h-3.5 w-3.5" />
            {badge.label}
          </span>
        </div>

        {!editing && warningText && (
          <p className="flex items-start gap-2 rounded-md bg-warn-soft p-2.5 text-xs text-warn">
            <AlertTriangle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 break-words">{warningText}</span>
          </p>
        )}

        {editing ? (
          <div className="flex flex-col gap-3">
            <div>
              <label htmlFor={areaId} className="mb-1.5 block text-xs font-semibold text-muted">
                One bullet per line
              </label>
              <textarea
                id={areaId}
                rows={6}
                autoFocus
                value={draft}
                onChange={(e) => onChangeDraft(e.target.value)}
                className="field-input font-mono text-xs leading-relaxed"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSave(dimensionKey)}
                className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-transparent bg-gradient-to-br from-btn to-btn-hover text-sm font-semibold text-white shadow-lg shadow-primary-600/25 transition-all hover:brightness-110 active:scale-95"
              >
                <Check aria-hidden="true" className="h-3.5 w-3.5" /> Save changes
              </button>
              <button type="button" onClick={onCancel} className="inline-flex h-10 items-center rounded-xl border border-line px-4 text-sm font-semibold text-ink transition-colors hover:bg-head">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col justify-between">
            {points.length > 0 ? (
              <ul className="space-y-3">
                {visible.map((pt, idx) => (
                  <li key={idx} className="text-sm">
                    {pt.label && <span className="block text-xs font-semibold uppercase tracking-wide text-muted">{pt.label}</span>}
                    <span className="break-words text-ink">{pt.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Nothing generated for this section yet. Use Edit to add it.</p>
            )}

            {points.length > 3 && (
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
                className="mt-3 inline-flex h-10 items-center gap-1 self-start rounded-md text-xs font-semibold text-primary-700 hover:underline dark:text-primary-300 sm:h-8"
              >
                {expanded ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
                {expanded ? 'Show less' : `Show ${points.length - 3} more`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
    </div>
  )
}
