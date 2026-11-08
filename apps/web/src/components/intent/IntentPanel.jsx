import { useState } from 'react'
import clsx from 'clsx'
import { ChevronDown, ChevronUp, ExternalLink, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '../../api'
import { Button } from '../kit'

// Intent bands as text plus a tint (never colour alone).
const BAND_TONE = {
  HOT: 'bg-bad-soft text-bad',
  WARM: 'bg-warn-soft text-warn',
  NURTURE: 'bg-warn-soft text-warn',
  WATCH: 'bg-head text-muted',
  COLD: 'bg-primary-50 text-primary-800 dark:bg-primary-950/60 dark:text-primary-300',
}
const BAND_LABEL = { HOT: 'Hot', WARM: 'Warm', NURTURE: 'Nurture', WATCH: 'Watch', COLD: 'Cold' }

/** The intent score with its band name. `small` is the compact form used in table rows. */
export function IntentScoreBadge({ score, band, small = false }) {
  const tone = BAND_TONE[band] || BAND_TONE.COLD
  const label = BAND_LABEL[band] || band || 'Cold'
  if (small) {
    return (
      <span className={clsx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold', tone)}>
        <span className="tabular-nums">{score}</span>
        <span>{label}</span>
      </span>
    )
  }
  return (
    <div className={clsx('inline-flex items-baseline gap-2 rounded-md px-3 py-2', tone)}>
      <span className="text-2xl font-bold tabular-nums">{score}</span>
      <span className="text-sm font-semibold">{label}</span>
    </div>
  )
}

const PILLARS = {
  firmographic: { label: 'Firmographic', max: 25 },
  tech: { label: 'Technographic', max: 20 },
  intent: { label: 'Intent', max: 35 },
  engagement: { label: 'Engagement', max: 20 },
}

function ScoreBreakdown({ breakdown }) {
  if (!breakdown) return null
  return (
    <ul className="space-y-3">
      {Object.entries(PILLARS).map(([key, { label, max }]) => {
        const score = breakdown[key] || 0
        const pct = Math.min(100, (score / max) * 100)
        return (
          <li key={key}>
            <div className="flex items-center justify-between text-sm">
              <span className="text-ink">{label}</span>
              <span className="font-semibold tabular-nums text-ink">{Math.round(score)}/{max}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-head" aria-hidden="true">
              <div className="h-full rounded-full bg-primary-600 dark:bg-primary-400" style={{ width: `${pct}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

const SIGNAL_LABEL = {
  job_hiring: 'Hiring',
  job_growth: 'Growth',
  tech_signal: 'Technology',
  funding_event: 'Funding',
  news_signal: 'News',
  social_signal: 'Social',
}

function SignalTimeline({ signals, maxVisible = 5 }) {
  const [showAll, setShowAll] = useState(false)
  if (!signals || signals.length === 0) return null
  const visible = showAll ? signals : signals.slice(0, maxVisible)
  return (
    <div>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {visible.map((signal, i) => (
          <li key={i} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-semibold text-ink break-words">{signal.title}</p>
              {signal.confidence && <span className="shrink-0 rounded-md border border-line px-1.5 py-0.5 text-xs text-muted">{signal.confidence} confidence</span>}
            </div>
            {signal.summary && <p className="mt-1 text-xs text-muted break-words">{signal.summary}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
              <span>{SIGNAL_LABEL[signal.type] || 'Signal'}</span>
              <span className="tabular-nums">+{signal.weight} pts</span>
              {signal.url && (
                <a href={signal.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary-700 hover:underline dark:text-primary-300">
                  <ExternalLink aria-hidden="true" className="h-3 w-3" /> View source
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
      {signals.length > maxVisible && (
        <button type="button" onClick={() => setShowAll(!showAll)} className="mt-2 inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">
          {showAll ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}
          {showAll ? 'Show fewer' : `Show ${signals.length - maxVisible} more`}
        </button>
      )}
    </div>
  )
}

const SectionTitle = ({ children }) => <h3 className="mb-2 text-sm font-semibold text-ink">{children}</h3>

/** Intent analysis for one lead: run it, then read the score, summary, breakdown and signals. */
export function IntentPanel({ lead, requestId, leadIndex, onUpdate }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [intentData, setIntentData] = useState(
    lead?.intent_score != null
      ? {
          intent_score: lead.intent_score,
          intent_band: lead.intent_band,
          band_emoji: lead.band_emoji,
          band_action: lead.band_action,
          intent_summary: lead.intent_summary,
          score_breakdown: lead.score_breakdown,
          intent_signals: lead.intent_signals || [],
          signal_timeline: lead.signal_timeline || [],
          total_signals: lead.total_signals || 0,
          serper_queries_used: lead.serper_queries_used || 0,
          intent_score_updated_at: lead.intent_score_updated_at,
        }
      : null,
  )

  const handleAnalyze = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    try {
      const result = await api.analyzeIntent(requestId, leadIndex)
      setIntentData(result)
      if (onUpdate) onUpdate(result)
    } catch (err) {
      console.error('Intent analysis failed:', err)
      setError(err.isNetworkError ? "Can't reach Quarry. Check your connection and try again." : err.message || 'Failed to analyze intent. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const errorBox = error && (
    <div role="alert" className="rounded-md bg-bad-soft p-3 text-sm text-bad break-words">
      {error}
    </div>
  )

  if (!intentData) {
    return (
      <section aria-label="Intent analysis" className="space-y-3">
        <SectionTitle>Intent analysis</SectionTitle>
        {errorBox}
        <div className="rounded-lg border border-dashed border-line p-5 text-center">
          <p className="text-sm font-semibold text-ink">Not analysed yet</p>
          <p className="mx-auto mt-1 max-w-xs text-sm text-muted">Checks job postings, funding, technology, news and social activity to score how likely this company is to buy.</p>
          <Button className="mt-4" loading={loading} onClick={handleAnalyze}>
            {!loading && <Sparkles aria-hidden="true" className="h-4 w-4" />}
            {loading ? 'Analysing…' : 'Analyse intent'}
          </Button>
          <p className="mt-3 text-xs text-muted">Uses about 7 search queries and takes 10 to 20 seconds.</p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Intent analysis" className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>Intent analysis</SectionTitle>
        <Button variant="ghost" size="sm" loading={loading} onClick={handleAnalyze} aria-label="Re-analyse intent signals">
          {!loading && <RefreshCw aria-hidden="true" className="h-3.5 w-3.5" />}
          Refresh
        </Button>
      </div>
      {errorBox}

      <div className="flex flex-wrap items-center gap-4">
        <IntentScoreBadge score={intentData.intent_score} band={intentData.intent_band} />
        <div className="min-w-0 flex-1">
          {intentData.band_action && <p className="text-sm text-ink break-words">{intentData.band_action}</p>}
          <p className="text-xs text-muted tabular-nums">{intentData.total_signals} signals, {intentData.serper_queries_used} queries used</p>
        </div>
      </div>

      {intentData.intent_summary && (
        <div className="rounded-lg border border-line bg-head p-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Summary</p>
          <p className="text-sm text-ink break-words">{intentData.intent_summary}</p>
        </div>
      )}

      <div>
        <SectionTitle>Score breakdown</SectionTitle>
        <ScoreBreakdown breakdown={intentData.score_breakdown} />
      </div>

      {intentData.signal_timeline?.length > 0 && (
        <div>
          <SectionTitle>Signals ({intentData.signal_timeline.length})</SectionTitle>
          <SignalTimeline signals={intentData.signal_timeline} />
        </div>
      )}

      {intentData.intent_score_updated_at && (
        <p className="text-right text-xs text-muted">
          Last analysed {new Date(intentData.intent_score_updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
    </section>
  )
}

export default IntentPanel
