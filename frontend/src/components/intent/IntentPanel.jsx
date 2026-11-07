import { useState } from 'react'
import { Zap, Loader2, TrendingUp, Briefcase, Cpu, Newspaper, Users, ChevronDown, ChevronUp, ExternalLink, Sparkles, RefreshCw } from 'lucide-react'
import { api } from '../../api'

// ── Intent Score Badge ────────────────────────────────────────────────────────
// Shows as a compact badge in the lead card/table row.

const BAND_STYLES = {
  HOT:     { bg: 'bg-gradient-to-r from-red-500 to-orange-500', text: 'text-white', emoji: '🔥', glow: 'shadow-red-500/30' },
  WARM:    { bg: 'bg-gradient-to-r from-orange-400 to-amber-400', text: 'text-white', emoji: '🟠', glow: 'shadow-orange-400/30' },
  NURTURE: { bg: 'bg-gradient-to-r from-yellow-400 to-yellow-500', text: 'text-slate-900', emoji: '🟡', glow: 'shadow-yellow-400/20' },
  WATCH:   { bg: 'bg-gradient-to-r from-slate-300 to-slate-400', text: 'text-slate-700', emoji: '⚪', glow: 'shadow-slate-400/20' },
  COLD:    { bg: 'bg-gradient-to-r from-blue-400 to-blue-500', text: 'text-white', emoji: '🔵', glow: 'shadow-blue-400/20' },
}

export function IntentScoreBadge({ score, band, small = false }) {
  const style = BAND_STYLES[band] || BAND_STYLES.COLD

  if (small) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${style.bg} ${style.text} shadow-md ${style.glow}`}>
        <span>{style.emoji}</span>
        <span>{score}</span>
      </span>
    )
  }

  return (
    <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-2xl ${style.bg} ${style.text} shadow-lg ${style.glow} font-black`}>
      <span className="text-lg">{style.emoji}</span>
      <div className="flex flex-col">
        <span className="text-xl leading-tight">{score}</span>
        <span className="text-[9px] uppercase tracking-[0.2em] opacity-80">{band}</span>
      </div>
    </div>
  )
}


// ── Score Breakdown Bar ───────────────────────────────────────────────────────

const PILLAR_CONFIG = {
  firmographic: { label: 'Firmographic', color: 'bg-violet-500', icon: Briefcase, max: 25 },
  tech:         { label: 'Technographic', color: 'bg-cyan-500', icon: Cpu, max: 20 },
  intent:       { label: 'Intent', color: 'bg-orange-500', icon: TrendingUp, max: 35 },
  engagement:   { label: 'Engagement', color: 'bg-emerald-500', icon: Users, max: 20 },
}

function ScoreBreakdown({ breakdown }) {
  if (!breakdown) return null

  return (
    <div className="space-y-3">
      {Object.entries(PILLAR_CONFIG).map(([key, config]) => {
        const score = breakdown[key] || 0
        const pct = Math.min(100, (score / config.max) * 100)
        const Icon = config.icon

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">
                <Icon className="w-3 h-3" />
                {config.label}
              </span>
              <span className="font-black text-slate-900 dark:text-white">
                {Math.round(score)}/{config.max}
              </span>
            </div>
            <div className="h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${config.color} transition-all duration-500 ease-out`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}


// ── Signal Type Icons ─────────────────────────────────────────────────────────

const SIGNAL_ICONS = {
  job_hiring:     { icon: '🔍', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/30' },
  job_growth:     { icon: '📈', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-950/30' },
  tech_signal:    { icon: '🔧', color: 'text-cyan-600 dark:text-cyan-400', bg: 'bg-cyan-50 dark:bg-cyan-950/30' },
  funding_event:  { icon: '💰', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30' },
  news_signal:    { icon: '📰', color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-950/30' },
  social_signal:  { icon: '👤', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30' },
}


// ── Signal Timeline ───────────────────────────────────────────────────────────

function SignalTimeline({ signals, maxVisible = 5 }) {
  const [showAll, setShowAll] = useState(false)
  if (!signals || signals.length === 0) return null

  const visible = showAll ? signals : signals.slice(0, maxVisible)

  return (
    <div className="space-y-2">
      {visible.map((signal, i) => {
        const config = SIGNAL_ICONS[signal.type] || SIGNAL_ICONS.news_signal
        return (
          <div
            key={i}
            className={`flex items-start gap-3 p-3 rounded-xl ${config.bg} transition-all hover:scale-[1.01]`}
          >
            <span className="text-lg mt-0.5 shrink-0">{config.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-snug">
                  {signal.title}
                </p>
                <span className={`shrink-0 text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${
                  signal.confidence === 'high' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                  signal.confidence === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                  'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {signal.confidence}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {signal.summary}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500">
                  +{signal.weight} pts
                </span>
                {signal.url && (
                  <a
                    href={signal.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 text-[10px] font-bold text-blue-500 hover:text-blue-700 dark:text-blue-400 transition"
                  >
                    <ExternalLink className="w-3 h-3" />
                    View source
                  </a>
                )}
              </div>
            </div>
          </div>
        )
      })}

      {signals.length > maxVisible && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="flex items-center gap-1.5 text-xs font-bold text-violet-600 dark:text-violet-400 hover:text-violet-700 transition mt-1 ml-1"
        >
          {showAll ? (
            <>
              <ChevronUp className="w-3.5 h-3.5" />
              Show less
            </>
          ) : (
            <>
              <ChevronDown className="w-3.5 h-3.5" />
              Show {signals.length - maxVisible} more signals
            </>
          )}
        </button>
      )}
    </div>
  )
}


// ── Main Intent Panel ─────────────────────────────────────────────────────────
// Full intent analysis panel shown in the company detail sidebar.

export function IntentPanel({ lead, requestId, leadIndex, onUpdate }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [intentData, setIntentData] = useState(
    lead?.intent_score != null ? {
      intent_score: lead.intent_score,
      intent_band: lead.intent_band,
      band_emoji: lead.band_emoji,
      intent_summary: lead.intent_summary,
      score_breakdown: lead.score_breakdown,
      intent_signals: lead.intent_signals || [],
      signal_timeline: lead.signal_timeline || [],
      total_signals: lead.total_signals || 0,
      serper_queries_used: lead.serper_queries_used || 0,
      intent_score_updated_at: lead.intent_score_updated_at,
    } : null
  )

  const handleAnalyze = async () => {
    setLoading(true)
    setError(null)

    try {
      const result = await api.analyzeIntent(requestId, leadIndex)
      setIntentData(result)
      if (onUpdate) onUpdate(result)
    } catch (err) {
      console.error('Intent analysis failed:', err)
      setError(err.message || 'Failed to analyze intent. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // No analysis yet — show the "Analyze Intent" CTA
  if (!intentData) {
    return (
      <div className="space-y-4">
        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Intent Analysis
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-bold">
            {error}
          </div>
        )}

        <div className="text-center p-6 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="text-3xl mb-3">🎯</div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300 mb-1">
            Discover buying signals
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4 max-w-[280px] mx-auto">
            Analyze job postings, funding events, tech stack, news, and social activity to score this lead's buying intent.
          </p>
          <button
            onClick={handleAnalyze}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-black text-xs uppercase tracking-wider shadow-lg shadow-violet-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Analyze Intent
              </>
            )}
          </button>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-3">
            Uses ~7 search queries • Takes 10-20 seconds
          </p>
        </div>
      </div>
    )
  }

  // Analysis complete — show results
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <TrendingUp className="w-3.5 h-3.5" /> Intent Analysis
        </div>
        <button
          onClick={handleAnalyze}
          disabled={loading}
          className="flex items-center gap-1 text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:text-violet-700 transition disabled:opacity-50"
          title="Re-analyze intent signals"
        >
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-400 text-xs font-bold">
          {error}
        </div>
      )}

      {/* Score + Band */}
      <div className="flex items-center gap-4">
        <IntentScoreBadge
          score={intentData.intent_score}
          band={intentData.intent_band}
        />
        <div className="flex-1">
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
            {intentData.band_action}
          </p>
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
            {intentData.total_signals} signals • {intentData.serper_queries_used} queries used
          </p>
        </div>
      </div>

      {/* AI Summary */}
      {intentData.intent_summary && (
        <div className="p-3 rounded-xl bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-950/30 dark:to-indigo-950/30 border border-violet-100 dark:border-violet-900/30">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3 h-3 text-violet-500" />
            <span className="text-[10px] font-black uppercase tracking-wider text-violet-600 dark:text-violet-400">
              AI Intent Summary
            </span>
          </div>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {intentData.intent_summary}
          </p>
        </div>
      )}

      {/* Score Breakdown */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
          Score Breakdown
        </p>
        <ScoreBreakdown breakdown={intentData.score_breakdown} />
      </div>

      {/* Signal Timeline */}
      {intentData.signal_timeline && intentData.signal_timeline.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3">
            Signal Timeline ({intentData.signal_timeline.length})
          </p>
          <SignalTimeline signals={intentData.signal_timeline} />
        </div>
      )}

      {/* Updated timestamp */}
      {intentData.intent_score_updated_at && (
        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right">
          Last analyzed: {new Date(intentData.intent_score_updated_at).toLocaleDateString(undefined, {
            month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
          })}
        </p>
      )}
    </div>
  )
}

export default IntentPanel
