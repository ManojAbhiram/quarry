import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import {
  Plus, Trash2, Edit3, Check, X, ChevronRight, Loader2,
  List, Users, Tag, Search, FolderOpen, BookmarkCheck,
  ExternalLink, MoreVertical, Copy, Download, Inbox,
  CheckSquare, Square
} from 'lucide-react'

// ─── Color palette for lists ─────────────────────────────────────────────────
const LIST_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
  '#84cc16', '#f97316',
]

// ─── Email badge component ─────────────────────────────────────────────────
function EmailBadge({ verified, confidence }) {
  if (verified === null || verified === undefined) return null
  if (!verified) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
        <X className="w-3 h-3" /> Invalid
      </span>
    )
  }
  const cls =
    confidence === 'high'
      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400'
      : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${cls}`}>
      <Check className="w-3 h-3" />
      {confidence === 'high' ? 'Verified' : 'Likely Valid'}
    </span>
  )
}

// ─── Single list card ─────────────────────────────────────────────────────
function ListCard({ list, onSelect, onDelete, onRename }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [newName, setNewName] = useState(list.name)

  const submitRename = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    await onRename(list._id, newName.trim())
    setRenaming(false)
  }

  return (
    <div
      className="group relative bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-slate-800/50 shadow-soft dark:shadow-2xl p-5 cursor-pointer hover:shadow-lg transition-all duration-200 hover:-translate-y-0.5"
      onClick={() => !renaming && onSelect(list._id)}
    >
      {/* Color stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-1 rounded-t-2xl"
        style={{ background: list.color || '#6366f1' }}
      />

      <div className="flex items-start justify-between mt-2">
        <div className="flex-1 min-w-0">
          {renaming ? (
            <form onSubmit={submitRename} onClick={(e) => e.stopPropagation()}>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full text-sm font-semibold bg-transparent border-b border-slate-300 dark:border-slate-600 outline-none text-slate-800 dark:text-white"
                onBlur={() => setRenaming(false)}
                onKeyDown={(e) => e.key === 'Escape' && setRenaming(false)}
              />
            </form>
          ) : (
            <h3 className="font-semibold text-slate-800 dark:text-white truncate text-base">{list.name}</h3>
          )}
          {list.description && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 truncate">{list.description}</p>
          )}
        </div>

        {/* Menu */}
        <div className="relative ml-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-opacity"
          >
            <MoreVertical className="w-4 h-4 text-slate-400" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[140px]">
              <button
                className="w-full text-left px-4 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700 flex items-center gap-2 text-slate-700 dark:text-slate-300"
                onClick={() => { setRenaming(true); setMenuOpen(false) }}
              >
                <Edit3 className="w-3.5 h-3.5" /> Rename
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm hover:bg-rose-50 dark:hover:bg-rose-900/20 flex items-center gap-2 text-rose-600"
                onClick={() => { onDelete(list._id); setMenuOpen(false) }}
              >
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
          <Users className="w-3.5 h-3.5" />
          <span className="text-sm font-medium">{(list.lead_ids || []).length} leads</span>
        </div>
        <div
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ background: list.color || '#6366f1' }}
        />
      </div>

      <div className="mt-3 flex items-center text-xs text-slate-400 dark:text-slate-500">
        <span>Created {new Date(list.created_at).toLocaleDateString()}</span>
        <ChevronRight className="w-3 h-3 ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  )
}

// ─── Lead row inside a list detail view ─────────────────────────────────
function LeadRow({ lead, listId, onRemove, selected, onToggleSelect }) {
  const [verifying, setVerifying] = useState(false)
  const [verif, setVerif] = useState({
    verified: lead.email_verified ?? null,
    confidence: lead.email_confidence ?? null,
  })

  const handleVerify = async (e) => {
    e.stopPropagation()
    if (!lead.id) return
    setVerifying(true)
    try {
      const res = await api.verifyAndSaveLeadEmail(lead.id)
      setVerif({ verified: res.verified, confidence: res.confidence })
    } catch (err) {
      console.error('Verify email error:', err)
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
      selected
        ? 'border-indigo-300 dark:border-indigo-600 bg-indigo-50 dark:bg-indigo-900/20'
        : 'border-transparent hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
    }`} onClick={() => onToggleSelect(lead.id)}>
      <div onClick={(e) => { e.stopPropagation(); onToggleSelect(lead.id) }}>
        {selected
          ? <CheckSquare className="w-4 h-4 text-indigo-500" />
          : <Square className="w-4 h-4 text-slate-300" />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-slate-800 dark:text-white truncate">{lead.title || lead.url}</p>
        {lead.email && (
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-slate-400 truncate">{lead.email}</span>
            <EmailBadge verified={verif.verified} confidence={verif.confidence} />
          </div>
        )}
      </div>

      {lead.match_score !== null && lead.match_score !== undefined && (
        <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400">
          {Math.round(Number(lead.match_score))}%
        </span>
      )}

      {lead.email && (
        <button
          onClick={handleVerify}
          disabled={verifying}
          title="Verify email"
          className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-emerald-500 transition-colors"
        >
          {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <BookmarkCheck className="w-3.5 h-3.5" />}
        </button>
      )}

      <a
        href={lead.url}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-400 hover:text-blue-500 transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </a>

      <button
        onClick={(e) => { e.stopPropagation(); onRemove(lead.id) }}
        className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 text-slate-400 hover:text-rose-500 transition-colors"
        title="Remove from list"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────
export default function LeadLists() {
  const navigate = useNavigate()
  const [lists, setLists] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedListId, setSelectedListId] = useState(null)
  const [listDetail, setListDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedLeadIds, setSelectedLeadIds] = useState([])

  // Create list modal
  const [showCreate, setShowCreate] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [newListColor, setNewListColor] = useState(LIST_COLORS[0])
  const [newListDesc, setNewListDesc] = useState('')
  const [creating, setCreating] = useState(false)

  const fetchLists = useCallback(async () => {
    try {
      const res = await api.getLists()
      setLists(res.lists || [])
    } catch (err) {
      console.error('Failed to load lists:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLists() }, [fetchLists])

  const fetchDetail = useCallback(async (listId) => {
    setDetailLoading(true)
    setSelectedLeadIds([])
    try {
      const res = await api.getList(listId)
      setListDetail(res)
    } catch (err) {
      console.error('Failed to load list detail:', err)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const handleSelectList = (listId) => {
    setSelectedListId(listId)
    fetchDetail(listId)
  }

  const handleCreateList = async (e) => {
    e.preventDefault()
    if (!newListName.trim()) return
    setCreating(true)
    try {
      const doc = await api.createList({ name: newListName.trim(), color: newListColor, description: newListDesc.trim() || null })
      setLists(prev => [doc, ...prev])
      setShowCreate(false)
      setNewListName('')
      setNewListDesc('')
      setNewListColor(LIST_COLORS[0])
    } catch (err) {
      console.error('Failed to create list:', err)
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteList = async (listId) => {
    if (!window.confirm('Delete this list? Leads will not be removed.')) return
    try {
      await api.deleteList(listId)
      setLists(prev => prev.filter(l => l._id !== listId))
      if (selectedListId === listId) { setSelectedListId(null); setListDetail(null) }
    } catch (err) {
      console.error('Failed to delete list:', err)
    }
  }

  const handleRenameList = async (listId, name) => {
    try {
      const updated = await api.updateList(listId, { name })
      setLists(prev => prev.map(l => l._id === listId ? { ...l, name } : l))
      if (listDetail?._id === listId) setListDetail(prev => ({ ...prev, name }))
    } catch (err) {
      console.error('Failed to rename list:', err)
    }
  }

  const handleRemoveLead = async (leadId) => {
    if (!selectedListId) return
    try {
      await api.removeLeadsFromList(selectedListId, [leadId])
      setListDetail(prev => ({
        ...prev,
        leads: prev.leads.filter(l => l.id !== leadId),
        lead_ids: prev.lead_ids.filter(id => id !== leadId),
      }))
      setLists(prev => prev.map(l =>
        l._id === selectedListId
          ? { ...l, lead_ids: (l.lead_ids || []).filter(id => id !== leadId) }
          : l
      ))
    } catch (err) {
      console.error('Failed to remove lead:', err)
    }
  }

  const handleRemoveSelected = async () => {
    if (!selectedListId || !selectedLeadIds.length) return
    try {
      await api.removeLeadsFromList(selectedListId, selectedLeadIds)
      setListDetail(prev => ({
        ...prev,
        leads: prev.leads.filter(l => !selectedLeadIds.includes(l.id)),
        lead_ids: prev.lead_ids.filter(id => !selectedLeadIds.includes(id)),
      }))
      setLists(prev => prev.map(l =>
        l._id === selectedListId
          ? { ...l, lead_ids: (l.lead_ids || []).filter(id => !selectedLeadIds.includes(id)) }
          : l
      ))
      setSelectedLeadIds([])
    } catch (err) {
      console.error('Failed to bulk remove leads:', err)
    }
  }

  const toggleLeadSelect = (leadId) => {
    setSelectedLeadIds(prev =>
      prev.includes(leadId) ? prev.filter(id => id !== leadId) : [...prev, leadId]
    )
  }

  const [exporting, setExporting] = useState(false)
  const handleExportList = async (format = 'csv') => {
    if (!selectedListId) return
    setExporting(true)
    try {
      const name = (selectedList?.name || 'list').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_') || 'list'
      await api.exportList(selectedListId, name, format)
    } catch (err) {
      console.error('Failed to export list:', err)
    } finally {
      setExporting(false)
    }
  }

  const filteredLists = lists.filter(l =>
    l.name.toLowerCase().includes(search.toLowerCase())
  )

  const filteredLeads = (listDetail?.leads || []).filter(l =>
    (l.title || l.url || '').toLowerCase().includes(search.toLowerCase()) ||
    (l.email || '').toLowerCase().includes(search.toLowerCase())
  )

  const selectedList = lists.find(l => l._id === selectedListId)

  return (
    <div id="lead-lists-page" className="h-full overflow-y-auto animate-fade-in pb-12 page-container">
      {/* Header */}
      <div className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl shadow-md">
              <List className="w-6 h-6 text-white" />
            </div>
            Lead Lists
          </h1>
          <p className="text-base text-slate-500 dark:text-slate-400 mt-2 font-medium">
            Organise your leads into named collections for easy follow-up.
          </p>
        </div>
        <button
          id="create-list-btn"
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-semibold rounded-xl shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-4 h-4" /> New List
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-6 max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          id="lists-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={selectedListId ? 'Search leads…' : 'Search lists…'}
          className="w-full pl-9 pr-4 py-2.5 bg-white/80 dark:bg-slate-900/80 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 transition"
        />
      </div>

      <div className="flex gap-6">
        {/* List sidebar */}
        <div className={`${selectedListId ? 'w-72 flex-shrink-0' : 'w-full'}`}>
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
            </div>
          ) : filteredLists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="p-4 rounded-2xl bg-slate-100 dark:bg-slate-800 mb-4">
                <Inbox className="w-10 h-10 text-slate-400" />
              </div>
              <p className="text-slate-500 dark:text-slate-400 font-medium">No lists yet</p>
              <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">Create your first list to organise leads</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 transition"
              >
                <Plus className="w-4 h-4" /> Create List
              </button>
            </div>
          ) : (
            <div className={`grid gap-4 ${selectedListId ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
              {filteredLists.map(list => (
                <ListCard
                  key={list._id}
                  list={list}
                  onSelect={handleSelectList}
                  onDelete={handleDeleteList}
                  onRename={handleRenameList}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedListId && (
          <div className="flex-1 min-w-0">
            <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-2xl border border-white/50 dark:border-slate-800/50 shadow-soft dark:shadow-2xl">
              {/* Detail header */}
              <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ background: selectedList?.color || '#6366f1' }} />
                  <h2 className="font-bold text-slate-800 dark:text-white">{selectedList?.name}</h2>
                  <span className="text-xs text-slate-400 dark:text-slate-500">
                    {(listDetail?.leads || []).length} leads
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {selectedLeadIds.length > 0 && (
                    <button
                      onClick={handleRemoveSelected}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 hover:bg-rose-100 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove {selectedLeadIds.length} selected
                    </button>
                  )}
                  {(listDetail?.leads || []).length > 0 && (
                    <button
                      onClick={() => handleExportList('csv')}
                      disabled={exporting}
                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition"
                      title="Export this list as CSV"
                    >
                      {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                      Export CSV
                    </button>
                  )}
                  <button
                    onClick={() => { setSelectedListId(null); setListDetail(null); setSearch('') }}
                    className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Leads */}
              <div className="p-4">
                {detailLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
                  </div>
                ) : filteredLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <FolderOpen className="w-10 h-10 text-slate-300 dark:text-slate-600 mb-3" />
                    <p className="text-slate-400 dark:text-slate-500 text-sm">No leads in this list yet.</p>
                    <p className="text-slate-400 dark:text-slate-500 text-xs mt-1">
                      Use the "Add to List" action on a lead card to add leads here.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {filteredLeads.map(lead => (
                      <LeadRow
                        key={lead.id}
                        lead={lead}
                        listId={selectedListId}
                        onRemove={handleRemoveLead}
                        selected={selectedLeadIds.includes(lead.id)}
                        onToggleSelect={toggleLeadSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Create list modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 dark:border-slate-800">
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <h2 className="text-lg font-bold text-slate-800 dark:text-white">Create New List</h2>
                <button onClick={() => setShowCreate(false)} className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <form onSubmit={handleCreateList} className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    List Name *
                  </label>
                  <input
                    id="new-list-name"
                    autoFocus
                    value={newListName}
                    onChange={(e) => setNewListName(e.target.value)}
                    placeholder="e.g. Enterprise Accounts Q3"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 transition"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-400 mb-1.5">
                    Description (optional)
                  </label>
                  <input
                    id="new-list-desc"
                    value={newListDesc}
                    onChange={(e) => setNewListDesc(e.target.value)}
                    placeholder="Hot leads to follow up this week"
                    className="w-full px-4 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-indigo-300 dark:focus:ring-indigo-700 transition"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                    Color
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {LIST_COLORS.map(color => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setNewListColor(color)}
                        className={`w-7 h-7 rounded-full transition-transform ${newListColor === color ? 'scale-125 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900' : 'hover:scale-110'}`}
                        style={{ background: color, ringColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* Preview */}
                <div className="p-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: newListColor }} />
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    {newListName || 'Your list name'}
                  </span>
                </div>

                <div className="flex gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-sm font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    Cancel
                  </button>
                  <button
                    id="submit-create-list"
                    type="submit"
                    disabled={creating || !newListName.trim()}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white text-sm font-semibold hover:shadow-lg disabled:opacity-50 transition"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                    Create List
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
