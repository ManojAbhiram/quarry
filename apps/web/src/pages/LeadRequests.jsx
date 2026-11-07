import { useEffect, useState, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLeads } from '../context/LeadContext'
import {
  Search, ChevronDown, Eye, Copy, Trash2, ChevronLeft, ChevronRight, Plus
} from 'lucide-react'

const ITEMS_PER_PAGE = 10

function StatusBadge({ status }) {
  const cfg = {
    Active: 'bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/50',
    Draft: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/50',
    Completed: 'bg-slate-100 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700/50',
    Failed: 'bg-rose-50 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/50',
  }
  const dot = {
    Active: 'bg-emerald-500',
    Draft: 'bg-amber-500',
    Completed: 'bg-slate-400',
    Failed: 'bg-rose-500',
  }
  const cls = cfg[status] || cfg.Draft
  const dotCls = dot[status] || dot.Draft
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotCls}`} />
      {status}
    </span>
  )
}

function IcpMatchBar({ score }) {
  if (score == null) return <span className="text-xs text-slate-400">—</span>
  const color = score >= 90 ? 'bg-emerald-500' : score >= 80 ? 'bg-amber-400' : 'bg-orange-400'
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 w-9 text-right">{score}%</span>
    </div>
  )
}

function StatCard({ label, value, color, isActive, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`p-5 min-w-[140px] flex-1 rounded-2xl border transition-all duration-300 cursor-pointer relative overflow-hidden select-none active:scale-[0.98] ${isActive
        ? 'bg-gradient-to-br from-violet-650 to-indigo-600 border-violet-600 text-white shadow-lg shadow-violet-500/20 dark:shadow-none'
        : 'bg-white dark:bg-slate-900/80 border-slate-200/80 dark:border-slate-700/60 text-slate-900 dark:text-white hover:border-violet-500/40 hover:shadow-md'
        }`}
    >
      <p className={`text-xs font-semibold uppercase tracking-wider ${isActive ? 'text-violet-100' : 'text-slate-500 dark:text-slate-400'}`}>{label}</p>
      <p className={`text-3xl font-black mt-2 tracking-tight ${isActive ? 'text-white' : color}`}>{value}</p>
      {/* Decorative ambient background shape */}
      <div className={`absolute -bottom-6 -right-6 w-16 h-16 rounded-full blur-xl opacity-20 transition-colors ${isActive ? 'bg-white' : 'bg-violet-500'}`} />
    </div>
  )
}

export default function LeadRequests() {
  const navigate = useNavigate()
  const location = useLocation()
  const { requests, stats, refreshRequests, deleteRequest, globalSearchQuery, setGlobalSearchQuery } = useLeads()
  const [sortBy, setSortBy] = useState('Last Updated')
  const [page, setPage] = useState(1)
  const [deletingId, setDeletingId] = useState(null)
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState({ show: false, id: null })

  const [statusFilter, setStatusFilter] = useState('All')

  // Set the filter if navigated from dashboard
  useEffect(() => {
    if (location.state?.filter) {
      setStatusFilter(location.state.filter)
      // Clear the state to avoid re-applying on reload/back
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location.state, navigate])

  useEffect(() => {
    refreshRequests()
  }, [refreshRequests])

  // Filter and sort
  const filtered = useMemo(() => {
    let list = [...requests]
    if (statusFilter !== 'All') {
      list = list.filter(r => r.status === statusFilter)
    }
    if (globalSearchQuery && globalSearchQuery.trim()) {
      const q = globalSearchQuery.toLowerCase()
      list = list.filter(r =>
        r.title?.toLowerCase().includes(q) ||
        r.business_type?.toLowerCase().includes(q) ||
        r.goal?.toLowerCase().includes(q)
      )
    }
    if (sortBy === 'Last Updated') {
      list.sort((a, b) => {
        const tA = Date.parse(a.updated_at || a.date) || 0
        const tB = Date.parse(b.updated_at || b.date) || 0
        return tB - tA
      })
    } else if (sortBy === 'Name') {
      list.sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    } else if (sortBy === 'Status') {
      list.sort((a, b) => (a.status || '').localeCompare(b.status || ''))
    }
    return list
  }, [requests, globalSearchQuery, sortBy, statusFilter])

  const totalPages = Math.ceil(filtered.length / ITEMS_PER_PAGE)
  const paginated = filtered.slice((page - 1) * ITEMS_PER_PAGE, page * ITEMS_PER_PAGE)

  const activeCount = requests.filter(r => r.status === 'Active').length
  const draftCount = requests.filter(r => r.status === 'Draft').length
  const failedCount = requests.filter(r => r.status === 'Failed').length
  const completedCount = requests.filter(r => r.status === 'Completed').length

  const handleDeleteClick = (id, e) => {
    e.stopPropagation()
    setDeleteConfirm({ show: true, id })
  }

  const handleConfirmDelete = async () => {
    const id = deleteConfirm.id
    if (!id) return
    setDeleteConfirm({ show: false, id: null })
    setDeletingId(id)
    try { await deleteRequest(id) } catch { }
    setDeletingId(null)
  }

  const handleView = (id, status, e, requestType) => {
    if (e) e.stopPropagation()
    const sClean = (status || 'Pending').toLowerCase()
    if (sClean === 'draft' || sClean === 'pending') {
      // Direct-companies requests use a dedicated workflow, not the ICP intake wizard.
      if (requestType === 'direct_companies') {
        navigate(sClean === 'draft' ? `/request/${id}/companies` : `/request/${id}`)
      } else {
        navigate(`/request/${id}/intake`)
      }
    } else {
      navigate(`/request/${id}`)
    }
  }

  const truncate = (str, n = 18) => str && str.length > n ? str.slice(0, n) + '…' : str

  return (
    <div id="lead-requests-page" className="animate-fade-in max-w-7xl mx-auto p-4 sm:p-6 lg:p-8 overflow-y-auto h-full pb-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">Lead Requests</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Manage and track all your lead generation requests</p>
        </div>
        <button
          onClick={() => navigate('/new-request')}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-violet-500/20 transition-all active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* Stats Row */}
      <div className="flex flex-wrap gap-4 mb-8">
        <StatCard
          label="Active"
          value={activeCount}
          color="text-emerald-600 dark:text-emerald-400"
          isActive={statusFilter === 'Active'}
          onClick={() => { setStatusFilter(prev => prev === 'Active' ? 'All' : 'Active'); setPage(1); }}
        />
        <StatCard
          label="Draft"
          value={draftCount}
          color="text-amber-500 dark:text-amber-400"
          isActive={statusFilter === 'Draft'}
          onClick={() => { setStatusFilter(prev => prev === 'Draft' ? 'All' : 'Draft'); setPage(1); }}
        />
        <StatCard
          label="Failed"
          value={failedCount}
          color="text-rose-600 dark:text-rose-400"
          isActive={statusFilter === 'Failed'}
          onClick={() => { setStatusFilter(prev => prev === 'Failed' ? 'All' : 'Failed'); setPage(1); }}
        />
        <StatCard
          label="Completed"
          value={completedCount}
          color="text-slate-700 dark:text-slate-300"
          isActive={statusFilter === 'Completed'}
          onClick={() => { setStatusFilter(prev => prev === 'Completed' ? 'All' : 'Completed'); setPage(1); }}
        />
      </div>

      {/* Active Filter Pill */}
      {statusFilter !== 'All' && (
        <div className="flex items-center gap-2 mb-6 animate-fade-in select-none">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Active Filter:</span>
          <button
            onClick={() => { setStatusFilter('All'); setPage(1); }}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-violet-50 hover:bg-violet-100 dark:bg-violet-955/20 dark:hover:bg-violet-955/35 text-violet-750 dark:text-violet-400 text-xs font-black rounded-full border border-violet-200/50 dark:border-violet-850/80 transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            {statusFilter}
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-violet-500 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      {/* Search & Sort Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="lead-search"
            type="text"
            placeholder="Search lead requests..."
            value={globalSearchQuery}
            onChange={(e) => { setGlobalSearchQuery(e.target.value); setPage(1) }}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
          />
        </div>
        {/* Sort Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowSortDropdown(p => !p)}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all"
          >
            {sortBy}
            <ChevronDown className="w-4 h-4 text-slate-400" />
          </button>
          {showSortDropdown && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl overflow-hidden min-w-[160px]">
              {['Last Updated', 'Name', 'Status'].map(opt => (
                <button
                  key={opt}
                  onClick={() => { setSortBy(opt); setShowSortDropdown(false) }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${sortBy === opt ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 font-semibold' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                >
                  {opt}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl overflow-hidden shadow-sm">
        {/* Table Header */}
        <div className="grid grid-cols-[2fr_1fr_1fr_1fr_80px_80px_160px_120px_100px] gap-2 px-5 py-3 border-b border-slate-100 dark:border-slate-800">
          {['Name', 'Status', 'Template', 'Goal', 'Companies', 'Contacts', 'ICP Match', 'Updated', 'Actions'].map(h => (
            <span key={h} className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">{h}</span>
          ))}
        </div>

        {/* Rows */}
        {paginated.length === 0 ? (
          <div className="py-16 text-center text-slate-400 dark:text-slate-500">
            <p className="text-base font-medium">No lead requests yet</p>
            <p className="text-sm mt-1">Create your first lead request to get started.</p>
            <button
              onClick={() => navigate('/new-request')}
              className="mt-4 inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl shadow-sm shadow-violet-500/20 transition-all active:scale-[0.98]"
            >
              <Plus className="w-4 h-4" />
              New Request
            </button>
          </div>
        ) : (
          paginated.map((req, i) => (
            <div
              key={req.id}
              onClick={(e) => handleView(req.id, req.status, e, req.request_type)}
              className={`grid grid-cols-[2fr_1fr_1fr_1fr_80px_80px_160px_120px_100px] gap-2 px-5 py-4 items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors ${i < paginated.length - 1 ? 'border-b border-slate-100 dark:border-slate-800/60' : ''}`}
            >
              {/* Name */}
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{req.title || 'Untitled'}</p>
                <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">
                  {req.description || req.business_type || '—'}
                </p>
              </div>
              {/* Status */}
              <StatusBadge status={req.status} />
              {/* Template */}
              <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
                {truncate(req.template || '—', 16)}
              </span>
              {/* Goal */}
              <span className="text-xs text-slate-600 dark:text-slate-400 truncate">
                {truncate(req.goal || req.primary_goal || '—', 16)}
              </span>
              {/* Companies */}
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {req.companies_count > 0 ? req.companies_count : '—'}
              </span>
              {/* Contacts */}
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {req.contacts_count > 0 ? req.contacts_count : '—'}
              </span>
              {/* ICP Match */}
              <IcpMatchBar score={req.icp_match_score} />
              {/* Updated */}
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {req.updated_at || req.date || '—'}
              </span>
              {/* Actions */}
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button
                  onClick={(e) => handleView(req.id, req.status, e, req.request_type)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="View"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(req.id) }}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                  title="Copy ID"
                >
                  <Copy className="w-4 h-4" />
                </button>
                <button
                  onClick={(e) => handleDeleteClick(req.id, e)}
                  disabled={deletingId === req.id}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors disabled:opacity-40"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-4 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Showing {(page - 1) * ITEMS_PER_PAGE + 1}–{Math.min(page * ITEMS_PER_PAGE, filtered.length)} of {filtered.length} lead requests
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors ${p === page ? 'bg-violet-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                >
                  {p}
                </button>
              ))}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Custom Confirmation Modal */}
      {deleteConfirm.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden transform scale-100 transition-all">
            {/* Top red alert stripe */}
            <div className="h-1.5 bg-gradient-to-r from-rose-500 to-red-600" />

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 flex items-center justify-center text-rose-500 shrink-0">
                  <Trash2 className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-850 dark:text-white">Delete Lead Request</h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500">Confirm permanent deletion</p>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold leading-relaxed">
                Are you sure you want to permanently delete this lead request? This action cannot be undone and all scraped insights and prospects will be lost.
              </p>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setDeleteConfirm({ show: false, id: null })}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700/80 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-black transition-all active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-black transition-all active:scale-[0.98] shadow-md shadow-rose-200 dark:shadow-none"
                >
                  Confirm Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
