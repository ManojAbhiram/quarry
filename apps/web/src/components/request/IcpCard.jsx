import { useState } from 'react'
import { Pencil, Check, ChevronDown, ChevronUp, AlertCircle, Layers, Globe, Shield, UserCheck, Activity, Terminal } from 'lucide-react'

const CARD_META = {
  firmographic: { label: 'Firmographics', icon: <Layers className="w-4 h-4" />, color: 'from-blue-500 to-indigo-600' },
  technographic: { label: 'Technographics', icon: <Terminal className="w-4 h-4" />, color: 'from-purple-500 to-violet-600' },
  team_structure: { label: 'Team & Decision Makers', icon: <UserCheck className="w-4 h-4" />, color: 'from-emerald-500 to-teal-600' },
  buying_signals: { label: 'Buying Signals', icon: <Activity className="w-4 h-4" />, color: 'from-amber-500 to-orange-600' },
  compliance: { label: 'Compliance Needs', icon: <Shield className="w-4 h-4" />, color: 'from-rose-500 to-pink-600' },
  deployment_pref: { label: 'Deployment Preferences', icon: <Globe className="w-4 h-4" />, color: 'from-cyan-500 to-blue-600' },
}

export const DEFAULT_CONFIDENCE_LEVELS = {
  firmographic: {
    level: 'High Confidence',
    color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border-emerald-200/50 dark:border-emerald-900/30',
    dot: 'bg-emerald-500',
    warning: null
  },
  technographic: {
    level: 'High Confidence',
    color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border-emerald-200/50 dark:border-emerald-900/30',
    dot: 'bg-emerald-500',
    warning: null
  },
  team_structure: {
    level: 'High Confidence',
    color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border-emerald-200/50 dark:border-emerald-900/30',
    dot: 'bg-emerald-500',
    warning: null
  },
  buying_signals: {
    level: 'High Confidence',
    color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border-emerald-200/50 dark:border-emerald-900/30',
    dot: 'bg-emerald-500',
    warning: null
  },
  compliance: {
    level: 'High Confidence',
    color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border-emerald-200/50 dark:border-emerald-900/30',
    dot: 'bg-emerald-500',
    warning: null
  },
  deployment_pref: {
    level: 'High Confidence',
    color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border-emerald-200/50 dark:border-emerald-900/30',
    dot: 'bg-emerald-500',
    warning: null
  }
}

export const CARD_THEME = {
  firmographic: {
    bg: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500/20',
    ring: 'focus:ring-blue-500/30 focus:border-blue-400 border-slate-200 dark:border-slate-700',
    hover: 'hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20 text-slate-400 dark:text-slate-500',
    cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
    text: 'text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300'
  },
  technographic: {
    bg: 'bg-purple-600 hover:bg-purple-700 focus:ring-purple-500/20',
    ring: 'focus:ring-purple-500/30 focus:border-purple-400 border-slate-200 dark:border-slate-700',
    hover: 'hover:text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950/20 text-slate-400 dark:text-slate-500',
    cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
    text: 'text-purple-600 hover:text-purple-700 dark:text-purple-400 dark:hover:text-purple-300'
  },
  team_structure: {
    bg: 'bg-emerald-600 hover:bg-emerald-700 focus:ring-emerald-500/20',
    ring: 'focus:ring-emerald-500/30 focus:border-emerald-400 border-slate-200 dark:border-slate-700',
    hover: 'hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 text-slate-400 dark:text-slate-500',
    cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
    text: 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300'
  },
  buying_signals: {
    bg: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500/20',
    ring: 'focus:ring-amber-500/30 focus:border-amber-400 border-slate-200 dark:border-slate-700',
    hover: 'hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 text-slate-400 dark:text-slate-500',
    cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
    text: 'text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300'
  },
  compliance: {
    bg: 'bg-rose-600 hover:bg-rose-700 focus:ring-rose-500/20',
    ring: 'focus:ring-rose-500/30 focus:border-rose-400 border-slate-200 dark:border-slate-700',
    hover: 'hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 text-slate-400 dark:text-slate-500',
    cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
    text: 'text-rose-600 hover:text-rose-700 dark:text-rose-400 dark:hover:text-rose-300'
  },
  deployment_pref: {
    bg: 'bg-cyan-600 hover:bg-cyan-700 focus:ring-cyan-500/20',
    ring: 'focus:ring-cyan-500/30 focus:border-cyan-400 border-slate-200 dark:border-slate-700',
    hover: 'hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-950/20 text-slate-400 dark:text-slate-500',
    cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800',
    text: 'text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300'
  }
}

export function getConfidenceStyles(confidenceText) {
  const text = confidenceText ? confidenceText.toLowerCase() : ''
  if (text.includes('high')) {
    return {
      level: confidenceText || 'High Confidence',
      color: 'bg-emerald-50/60 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-450 border border-emerald-200/50 dark:border-emerald-800/30',
      dot: 'bg-emerald-500'
    }
  } else if (text.includes('low')) {
    return {
      level: confidenceText || 'Low Confidence',
      color: 'bg-rose-50/60 text-rose-700 dark:bg-rose-950/20 dark:text-rose-450 border border-rose-200/50 dark:border-rose-900/30',
      dot: 'bg-rose-500'
    }
  } else {
    return {
      level: confidenceText || 'Medium Confidence',
      color: 'bg-amber-50/60 text-amber-700 dark:bg-amber-950/20 dark:text-amber-450 border border-amber-200/50 dark:border-amber-900/30',
      dot: 'bg-amber-500'
    }
  }
}

function parseIcpBulletPoints(text) {
  if (!text || typeof text !== 'string') return []
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => {
      let cleaned = line.replace(/^[•\-\*\d\.\s]+/, '').trim()
      const colonIndex = cleaned.indexOf(':')
      if (colonIndex > 0) {
        const label = cleaned.slice(0, colonIndex).trim()
        const detail = cleaned.slice(colonIndex + 1).trim()
        return { label, detail }
      }
      return { label: null, detail: cleaned }
    })
}

export default function IcpCard({
  dimensionKey,
  value,
  editing,
  draft,
  onChangeDraft,
  onStartEdit,
  onSave,
  onCancel
}) {
  const meta = CARD_META[dimensionKey] || { label: dimensionKey, icon: null, color: 'from-slate-500 to-slate-600' }
  const theme = CARD_THEME[dimensionKey] || { bg: 'bg-violet-600 hover:bg-violet-700 focus:ring-violet-500/20', ring: 'focus:ring-violet-500/30 focus:border-violet-400 border-slate-200 dark:border-slate-700', hover: 'hover:text-violet-650 hover:bg-violet-50 dark:hover:bg-violet-950/20 text-slate-400 dark:text-slate-500', cancel: 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800', text: 'text-violet-600 hover:text-violet-750 dark:text-violet-400 dark:hover:text-violet-300' }
  const [expanded, setExpanded] = useState(false)

  // Unpack dynamic values safely
  const isObj = typeof value === 'object' && value !== null
  const textValue = isObj ? value.value : value
  const confidenceText = isObj ? value.confidence : null
  const warningText = isObj ? value.warning : null

  // Resolve dynamic confidence styles and custom alert text
  const defaultConf = DEFAULT_CONFIDENCE_LEVELS[dimensionKey] || { level: 'Medium Confidence', color: 'bg-slate-50 dark:bg-slate-900 border-slate-200 text-slate-700', dot: 'bg-slate-400', warning: null }
  const conf = confidenceText
    ? { ...getConfidenceStyles(confidenceText), warning: warningText }
    : defaultConf

  const parsedPoints = parseIcpBulletPoints(textValue)
  const visiblePoints = expanded ? parsedPoints : parsedPoints.slice(0, 3)

  return (
    <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-all duration-300">
      <div className={`h-1.5 bg-gradient-to-r ${meta.color}`} />

      <div className="p-5 flex-1 flex flex-col gap-4">
        {/* Title and Edit Button */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${meta.color} text-white`}>
              {meta.icon}
            </div>
            <span className="text-sm font-extrabold text-slate-800 dark:text-slate-100 tracking-tight">
              {meta.label}
            </span>
          </div>
          {!editing && (
            <button
              onClick={() => onStartEdit(dimensionKey)}
              className={`inline-flex items-center gap-1 py-1 px-2 rounded-lg transition-all cursor-pointer text-xs font-semibold ${theme.hover}`}
            >
              <Pencil className="w-3 h-3" />
              <span>Edit</span>
            </button>
          )}
        </div>

        {/* Confidence Badge */}
        <div className="flex flex-col gap-2.5">
          <div className="flex">
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase border tracking-wider ${conf.color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${conf.dot}`} />
              {conf.level}
            </div>
          </div>

          {/* Alert block if there is a warning */}
          {!editing && conf.warning && (
            <div className="flex items-start gap-2 p-2.5 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-200/50 dark:border-amber-900/30 rounded-xl text-[11px] text-amber-800 dark:text-amber-300 leading-normal">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              <span>{conf.warning}</span>
            </div>
          )}
        </div>

        {/* Content Panel */}
        {editing ? (
          <div className="flex-1 flex flex-col gap-4">
            {/* Bullet Points */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] font-extrabold text-slate-400 dark:text-slate-500 uppercase tracking-wide">
                ICP Specifications (one bullet per line)
              </label>
              <textarea
                rows={6}
                value={draft}
                onChange={e => onChangeDraft(e.target.value)}
                autoFocus
                className={`w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 font-mono leading-relaxed transition-all ${theme.ring}`}
              />
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onSave(dimensionKey)}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-white text-xs font-bold rounded-xl transition-all cursor-pointer focus:outline-none focus:ring-2 ${theme.bg}`}
              >
                <Check className="w-3.5 h-3.5" /> Save Changes
              </button>
              <button
                onClick={onCancel}
                className={`px-4 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer ${theme.cancel}`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col justify-between">
            {parsedPoints.length > 0 ? (
              <div className="space-y-3.5">
                {visiblePoints.map((pt, idx) => (
                  <div key={idx} className="flex flex-col gap-0.5 text-xs">
                    {pt.label ? (
                      <>
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wide">
                          {pt.label}
                        </span>
                        <span className="text-slate-700 dark:text-slate-205 leading-relaxed font-semibold">
                          {pt.detail}
                        </span>
                      </>
                    ) : (
                      <span className="text-slate-700 dark:text-slate-205 leading-relaxed font-semibold">
                        {pt.detail}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs italic text-slate-400">No content generated yet.</p>
            )}

            {/* Expandable Actions */}
            {parsedPoints.length > 3 && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                className={`inline-flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-colors mt-3 ${theme.text}`}
              >
                {expanded ? (
                  <>
                    <ChevronUp className="w-3.5 h-3.5" />
                    <span>Show less</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-3.5 h-3.5" />
                    <span>Show {parsedPoints.length - 3} more</span>
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
