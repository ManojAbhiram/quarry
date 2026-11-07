import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useLeads } from '../context/LeadContext'
import { ArrowRight, Loader2, ChevronDown, Sparkles, Building2, CheckCircle2 } from 'lucide-react'

const FLOW_TYPES = [
  {
    id: 'icp',
    title: 'Generate from ICP',
    description: 'Describe your product, generate an Ideal Customer Profile, and let Quarry discover matching companies and decision makers.',
    icon: Sparkles,
  },
  {
    id: 'direct_companies',
    title: 'I already have companies',
    description: 'Provide one company, a comma-separated list, or a CSV. We find direct decision makers for the roles you choose.',
    icon: Building2,
  },
]

const PRIMARY_GOALS = [
  'Generate Pipeline',
  'Account Expansion',
  'Book Meetings',
  'Competitive Displacement',
  'Brand Awareness',
]

const TEAM_SIZES = [
  '1–10',
  '11–50',
  '51–200',
  '201–500',
  '500+',
]

export default function CreateLeadRequest() {
  const navigate = useNavigate()
  const { refreshRequests, requests } = useLeads()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryGoal, setPrimaryGoal] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [flowType, setFlowType] = useState('icp')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const hasRequests = requests && requests.length > 0

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Lead Request name is required.')
      return
    }
    setError('')
    setLoading(true)
    try {
      const result = await api.createLeadRequest({
        name: name.trim(),
        description: description.trim() || null,
        primary_goal: primaryGoal || null,
        target_team_size: teamSize || null,
        request_type: flowType,
      })
      await refreshRequests()
      // Route to the matching workflow based on the selected flow type.
      if (flowType === 'direct_companies') {
        navigate(`/request/${result.id}/companies`)
      } else {
        navigate(`/request/${result.id}/intake`)
      }
    } catch (err) {
      setError(err.message || 'Failed to create lead request.')
    } finally {
      setLoading(false)
    }
  }

  const handleSkip = () => {
    navigate('/lead-requests')
  }

  return (
    <div className="h-full w-full relative overflow-y-auto flex items-center justify-center bg-gradient-to-br from-slate-100 via-blue-50 to-slate-50 dark:from-[#0f172a] dark:via-[#1a1f35] dark:to-[#0f172a]">
      {/* Pastel gradient blobs */}
      <div className="absolute inset-0 pointer-events-none select-none overflow-hidden">
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-gradient-to-br from-blue-200/50 to-indigo-200/30 dark:from-blue-900/20 dark:to-indigo-900/10 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-32 w-80 h-80 bg-gradient-to-bl from-pink-200/40 to-purple-200/30 dark:from-pink-900/15 dark:to-purple-900/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-16 left-1/3 w-96 h-72 bg-gradient-to-tr from-amber-200/40 to-yellow-100/30 dark:from-amber-900/15 dark:to-yellow-900/10 rounded-full blur-3xl" />
        {/* Decorative dots */}
        <div className="absolute top-1/4 left-12 w-2.5 h-2.5 rounded-full bg-yellow-300/70 dark:bg-yellow-500/40" />
        <div className="absolute top-1/2 left-8 w-2 h-2 rounded-full bg-indigo-400/60 dark:bg-indigo-400/30" />
        <div className="absolute top-2/3 right-16 w-2 h-2 rounded-full bg-slate-300/80 dark:bg-slate-500/40" />
        <div className="absolute bottom-1/4 right-1/4 w-2 h-2 rounded-full bg-blue-300/60 dark:bg-blue-400/30" />
        <div className="absolute top-1/3 left-1/4 w-1.5 h-1.5 rounded-full bg-pink-300/60 dark:bg-pink-400/30" />
      </div>

      {/* Card */}
      <div className="relative z-10 w-full max-w-2xl mx-auto px-4 py-10 animate-fade-in">
        {/* Heading */}
        <div className="mb-8">
          <h1 className="text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight">
            {hasRequests ? 'Create Lead Request' : 'Create Your First Lead Request'}
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-lg leading-relaxed">
            {hasRequests
              ? 'Specify your target B2B criteria, ideal team profiles, and value drivers to launch a customized high-intent lead search.'
              : 'Welcome to Quarry! Start by creating your first lead generation request. Choose a template or start from scratch.'}
          </p>
        </div>

        {/* Form Card */}
        <form
          onSubmit={handleCreate}
          className="bg-white dark:bg-slate-900/90 backdrop-blur-xl border border-slate-200/80 dark:border-slate-700/60 rounded-2xl shadow-lg p-8 space-y-6"
        >
          {/* Error */}
          {error && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-700 dark:text-rose-400 text-sm font-medium">
              {error}
            </div>
          )}

          {/* Flow type selector */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              How do you want to find leads? <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FLOW_TYPES.map((f) => {
                const Icon = f.icon
                const selected = flowType === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFlowType(f.id)}
                    className={`relative text-left p-4 rounded-xl border-2 transition-all cursor-pointer ${
                      selected
                        ? 'border-violet-500 bg-violet-50/60 dark:bg-violet-950/20'
                        : 'border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-slate-800/40'
                    }`}
                  >
                    {selected && (
                      <CheckCircle2 className="absolute top-3 right-3 w-4 h-4 text-violet-600" />
                    )}
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-2 ${selected ? 'bg-violet-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'}`}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">{f.title}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">{f.description}</p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Lead Request Name */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Lead Request name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              id="lead-request-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Enterprise Outreach"
              className="w-full px-4 py-2.5 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all"
            />
            <p className="text-xs text-slate-400 dark:text-slate-500">This will appear in your lead request selector.</p>
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Description
            </label>
            <textarea
              id="lead-request-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is the goal of this lead request?"
              className="w-full px-4 py-3 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all resize-none"
            />
          </div>

          {/* Primary goal + Target team size — 2 columns (ICP flow only) */}
          {flowType === 'icp' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Primary Goal */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Primary goal
              </label>
              <div className="relative">
                <select
                  id="primary-goal"
                  value={primaryGoal}
                  onChange={(e) => setPrimaryGoal(e.target.value)}
                  className="w-full appearance-none px-4 py-2.5 pr-10 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all cursor-pointer"
                >
                  <option value="">Select a goal</option>
                  {PRIMARY_GOALS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>

            {/* Target Team Size */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">
                Target team size
              </label>
              <div className="relative">
                <select
                  id="target-team-size"
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value)}
                  className="w-full appearance-none px-4 py-2.5 pr-10 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-400 transition-all cursor-pointer"
                >
                  <option value="">Select team size</option>
                  {TEAM_SIZES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
          </div>
          )}
        </form>

        {/* Actions — outside the card, below */}
        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={handleSkip}
            className="px-5 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer select-none"
          >
            {hasRequests ? 'Cancel' : 'Skip for now'}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={loading}
            id="create-lead-request-btn"
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 active:scale-95 text-white text-sm font-semibold rounded-xl shadow-md shadow-violet-500/20 transition-all disabled:opacity-60"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                Create Lead Request
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
