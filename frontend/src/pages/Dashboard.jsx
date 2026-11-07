import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLeads } from '../context/LeadContext'
import { useNavigate } from 'react-router-dom'
import {
  FileText, Clock, CheckCircle2, XCircle, ArrowRight,
  Zap, Loader2, FileSearch, Sparkles, Target, Users, TrendingUp,
} from 'lucide-react'

function StatCard({ id, label, value, icon, gradient, onClick }) {
  return (
    <div
      id={id}
      onClick={onClick}
      className="card-hover p-6 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-slate-800/50 shadow-soft dark:shadow-2xl flex items-start justify-between group cursor-pointer transition-all duration-300 relative overflow-hidden"
    >
      <div className="relative z-10">
        <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{label}</p>
        <p className="text-2xl font-bold text-slate-800 dark:text-white mt-2 tracking-tight">{value}</p>
      </div>
      <div className={`p-3 rounded-2xl bg-gradient-to-br ${gradient} shadow-md relative z-10 transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
        {icon}
      </div>
      <div className={`absolute -bottom-4 -right-4 w-24 h-24 bg-gradient-to-br ${gradient} rounded-full blur-2xl opacity-0 group-hover:opacity-20 transition-opacity duration-500`} />
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const { stats, requests, refreshRequests } = useLeads()
  const navigate = useNavigate()

  useEffect(() => {
    refreshRequests()
  }, [refreshRequests])

  const activeRequest = requests.find(
    r => r.status === 'Pending' || r.status === 'pending' ||
         r.status === 'Active' || r.status === 'active'
  ) || null

  return (
    <div id="dashboard-page" className="h-full overflow-y-auto animate-fade-in pb-12 pr-2">
      {/* Header */}
      <div id="dashboard-header" className="mb-10 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Overview</h1>
          <p className="text-base text-slate-500 dark:text-slate-400 mt-2 font-medium">
            Welcome back, <span className="text-primary-600 font-bold">{user?.name}</span>. Here's your lead generation summary.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div id="summary" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-10">
        <StatCard id="summary-total" label="Total Generations" value={stats.totalLeads}
          gradient="from-blue-500 to-indigo-600"
          icon={<FileText className="w-6 h-6 text-white" />}
          onClick={() => navigate('/lead-requests', { state: { filter: 'All' } })}
        />
        <StatCard id="summary-pending" label="In Progress" value={stats.pending}
          gradient="from-amber-400 to-orange-500"
          icon={<Clock className="w-6 h-6 text-white" />}
          onClick={() => navigate('/lead-requests', { state: { filter: 'Active' } })}
        />
        <StatCard id="summary-completed" label="Successful" value={stats.completed}
          gradient="from-emerald-400 to-teal-500"
          icon={<CheckCircle2 className="w-6 h-6 text-white" />}
          onClick={() => navigate('/lead-requests', { state: { filter: 'Completed' } })}
        />
        <StatCard id="summary-failed" label="Failed" value={stats.failed}
          gradient="from-rose-400 to-red-500"
          icon={<XCircle className="w-6 h-6 text-white" />}
          onClick={() => navigate('/lead-requests', { state: { filter: 'Failed' } })}
        />
      </div>

      {/* CTA + Pipeline */}
      <div id="workspace" className="grid grid-cols-1 xl:grid-cols-12 gap-8">

        {/* ── CTA Card ─────────────────────────────────────────────────────── */}
        <div id="cta-card" className="xl:col-span-7 card p-8 bg-gradient-to-br from-primary-600 via-indigo-600 to-violet-700 text-white border-0 shadow-2xl shadow-primary-500/30 relative overflow-hidden">
          {/* Background decoration */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-10 -left-10 w-48 h-48 bg-white/5 rounded-full blur-2xl pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-3 bg-white/15 backdrop-blur-sm rounded-2xl border border-white/20 shadow-md">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <span className="text-sm font-bold uppercase tracking-widest text-white/70">AI-Powered Lead Generation</span>
            </div>

            <h2 className="text-2xl font-black tracking-tight mb-3 leading-snug">
              Ready to Find Your<br />Next Customers?
            </h2>
            <p className="text-white/75 text-sm font-medium mb-8 leading-relaxed max-w-md">
              Define your ideal customer, generate a professional AI-crafted ICP, and let our pipeline deliver highly qualified leads straight to your database.
            </p>

            {/* Feature highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[
                { icon: <Target className="w-4 h-4" />, label: 'AI ICP Builder', desc: 'Auto-generate industry-standard profiles' },
                { icon: <Users className="w-4 h-4" />, label: 'Smart Scraping', desc: 'Deep data from across the web' },
                { icon: <TrendingUp className="w-4 h-4" />, label: 'Lead Scoring', desc: 'Ranked by ICP fit & buying signals' },
              ].map(({ icon, label, desc }) => (
                <div key={label} className="flex items-start gap-2.5 p-3 bg-white/10 rounded-xl border border-white/15">
                  <div className="p-1.5 bg-white/15 rounded-lg mt-0.5 flex-shrink-0">{icon}</div>
                  <div>
                    <p className="text-xs font-bold text-white">{label}</p>
                    <p className="text-xs text-white/60 mt-0.5 leading-snug">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => navigate('/new-request')}
              className="inline-flex items-center gap-2.5 px-7 py-3.5 bg-white text-primary-700 rounded-2xl text-sm font-extrabold shadow-xl shadow-black/20 hover:shadow-2xl hover:shadow-black/30 hover:bg-white/95 active:scale-[0.98] transition-all duration-200"
            >
              <Zap className="w-5 h-5" />
              Start Lead Generation
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Active Pipeline Status ──────────────────────────────────────── */}
        <div id="result-panel" className="xl:col-span-5 card p-8 flex flex-col bg-gradient-to-b from-white to-slate-50/50 dark:from-slate-900 dark:to-slate-800/50 relative overflow-hidden">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg text-indigo-600 dark:text-indigo-400">
              <FileSearch className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 dark:text-slate-200">Active Pipeline</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">Most recent generation status.</p>
            </div>
          </div>

          {activeRequest ? (
            <div id="result-content" className="flex-1 space-y-5 animate-slide-up">
              <div className={`p-5 rounded-2xl shadow-sm border transition-colors ${
                activeRequest.status?.toLowerCase() === 'completed'
                  ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50'
                  : activeRequest.status?.toLowerCase() === 'failed'
                  ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-800/50'
                  : 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50'
              }`}>
                <div className="flex items-center gap-2 mb-3">
                  {activeRequest.status?.toLowerCase() === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                  ) : activeRequest.status?.toLowerCase() === 'failed' ? (
                    <XCircle className="w-5 h-5 text-rose-600" />
                  ) : (
                    <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                  )}
                  <p className={`text-sm font-bold ${
                    activeRequest.status?.toLowerCase() === 'completed' ? 'text-emerald-800 dark:text-emerald-400' :
                    activeRequest.status?.toLowerCase() === 'failed' ? 'text-rose-800 dark:text-rose-400' :
                    'text-blue-800 dark:text-blue-400'
                  }`}>
                    {activeRequest.status?.toLowerCase() === 'completed' ? 'Pipeline Successful!' :
                     activeRequest.status?.toLowerCase() === 'failed' ? 'Pipeline Failed' :
                     'Pipeline In Progress…'}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500 dark:text-slate-400 font-semibold">Request ID</span>
                    <span className="font-mono text-slate-700 dark:text-slate-300 bg-white/50 dark:bg-slate-800/50 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs">
                      {activeRequest.id}
                    </span>
                  </div>
                  {activeRequest.title && (
                    <div className="flex justify-between items-center text-sm">
                      <span className="text-slate-500 dark:text-slate-400 font-semibold">Request</span>
                      <span className="text-slate-700 dark:text-slate-300 text-xs truncate max-w-[140px]">{activeRequest.title}</span>
                    </div>
                  )}
                </div>
              </div>

              {(activeRequest.status === 'Pending' || activeRequest.status === 'Active') && (
                <div className="flex items-center gap-3 text-sm font-medium text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/20 p-4 rounded-xl border border-primary-100 dark:border-primary-800/50">
                  <Loader2 className="w-5 h-5 animate-spin flex-shrink-0" />
                  Extracting and enriching lead data…
                </div>
              )}

              {activeRequest.status === 'Completed' && (
                <button
                  onClick={() => navigate('/lead-requests', { state: { filter: 'Completed' } })}
                  className="w-full flex items-center justify-center gap-2 p-4 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
                >
                  View Generated Leads
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}

              {activeRequest.status === 'Failed' && (
                <button
                  onClick={() => navigate('/new-request')}
                  className="w-full flex items-center justify-center gap-2 p-4 bg-primary-600 text-white rounded-xl font-bold hover:bg-primary-700 transition-colors"
                >
                  Try Again
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>
          ) : (
            <div id="result-empty" className="flex-1 flex flex-col items-center justify-center text-center py-12 px-6 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-2xl bg-white/50 dark:bg-slate-800/50">
              <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full mb-4">
                <Zap className="w-8 h-8 text-slate-400 dark:text-slate-500" />
              </div>
              <p className="text-base font-semibold text-slate-700 dark:text-slate-300">No Active Pipeline</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 max-w-[240px]">
                Start a new generation from the Lead Generation page.
              </p>
              <button
                onClick={() => navigate('/new-request')}
                className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 bg-primary-600 text-white rounded-xl text-sm font-bold hover:bg-primary-700 transition-colors shadow-md shadow-primary-500/20"
              >
                <Zap className="w-4 h-4" />
                Start Now
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
