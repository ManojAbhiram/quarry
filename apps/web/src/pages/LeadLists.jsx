import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Download, FolderOpen, Inbox, List, Plus, Search, Trash2, X } from 'lucide-react'
import { api } from '../api'
import { Button, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from '../components/kit'
import { useFlip } from '../components/motion/useFlip'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import ConfirmDialog from './requests/ConfirmDialog'
import ListCard, { DEFAULT_COLOR } from './lists/ListCard'
import LeadRow from './lists/LeadRow'
import CreateListDialog from './lists/CreateListDialog'
import SharedWork from './shared/SharedWork'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

export default function LeadLists() {
  const toast = useToast()
  const pageRef = useRef(null)
  const gridRef = useRef(null)
  const leadsRef = useRef(null)
  const detailRef = useRef(null)
  const detailToken = useRef(0)

  const [lists, setLists] = useState([])
  const [loadState, setLoadState] = useState('loading') // loading | ready | error
  const [selectedListId, setSelectedListId] = useState(null)
  const [listDetail, setListDetail] = useState(null)
  const [detailState, setDetailState] = useState('idle') // idle | loading | ready | error
  const [search, setSearch] = useState('')
  const [selectedLeadIds, setSelectedLeadIds] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [confirm, setConfirm] = useState(null) // { kind: 'list' | 'bulk', list?, ids? }
  const [confirming, setConfirming] = useState(false)
  const [exporting, setExporting] = useState(false)

  const fetchLists = useCallback(async () => {
    setLoadState('loading')
    try {
      const res = await api.getLists()
      setLists(res?.lists || [])
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }, [])

  useEffect(() => {
    fetchLists()
  }, [fetchLists])

  const fetchDetail = useCallback(async (listId) => {
    const token = ++detailToken.current
    setDetailState('loading')
    setSelectedLeadIds([])
    try {
      const res = await api.getList(listId)
      if (token !== detailToken.current) return
      setListDetail(res)
      setDetailState('ready')
    } catch {
      if (token === detailToken.current) setDetailState('error')
    }
  }, [])

  const filteredLists = useMemo(() => lists.filter((l) => (l.name || '').toLowerCase().includes(search.toLowerCase())), [lists, search])
  const filteredLeads = useMemo(() => {
    const q = search.toLowerCase()
    return (listDetail?.leads || []).filter((l) => (l.title || l.url || '').toLowerCase().includes(q) || (l.email || '').toLowerCase().includes(q))
  }, [listDetail, search])
  const selectedList = lists.find((l) => l._id === selectedListId)
  const existingNames = useMemo(() => lists.map((l) => (l.name || '').toLowerCase()), [lists])

  const captureLists = useFlip(gridRef, [filteredLists.map((l) => l._id).join()])
  const captureLeads = useFlip(leadsRef, [filteredLeads.map((l) => l.id).join()])
  useStaggerIn(gridRef, { dependencies: [loadState] })

  const handleSelectList = (listId) => {
    setSelectedListId(listId)
    fetchDetail(listId)
    requestAnimationFrame(() => detailRef.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }))
  }

  const closeDetail = () => {
    detailToken.current++
    setSelectedListId(null)
    setListDetail(null)
    setDetailState('idle')
    setSearch('')
  }

  const handleCreate = async ({ name, color, description }) => {
    try {
      const doc = await api.createList({ name, color, description })
      captureLists()
      setLists((prev) => [doc, ...prev])
      setShowCreate(false)
      toast.push({ type: 'success', message: `Created "${name}".` })
      return null
    } catch (err) {
      return err.message || 'Could not create the list.'
    }
  }

  const handleRename = async (listId, name) => {
    try {
      await api.updateList(listId, { name })
      setLists((prev) => prev.map((l) => (l._id === listId ? { ...l, name } : l)))
      setListDetail((prev) => (prev?._id === listId ? { ...prev, name } : prev))
      toast.push({ type: 'success', message: 'List renamed.' })
      return true
    } catch {
      return false
    }
  }

  const removeLeadsLocally = (ids) => {
    captureLeads()
    setListDetail((prev) => ({ ...prev, leads: (prev.leads || []).filter((l) => !ids.includes(l.id)), lead_ids: (prev.lead_ids || []).filter((id) => !ids.includes(id)) }))
    setLists((prev) => prev.map((l) => (l._id === selectedListId ? { ...l, lead_ids: (l.lead_ids || []).filter((id) => !ids.includes(id)) } : l)))
    setSelectedLeadIds((prev) => prev.filter((id) => !ids.includes(id)))
  }

  const handleRemoveLead = async (lead) => {
    try {
      await api.removeLeadsFromList(selectedListId, [lead.id])
      removeLeadsLocally([lead.id])
      toast.push({ type: 'success', message: 'Removed from the list.' })
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Could not remove that lead.' })
    }
  }

  const runConfirm = async () => {
    if (!confirm) return
    setConfirming(true)
    try {
      if (confirm.kind === 'list') {
        await api.deleteList(confirm.list._id)
        captureLists()
        setLists((prev) => prev.filter((l) => l._id !== confirm.list._id))
        if (selectedListId === confirm.list._id) closeDetail()
        toast.push({ type: 'success', message: `Deleted "${confirm.list.name}". Its leads are untouched.` })
      } else {
        await api.removeLeadsFromList(selectedListId, confirm.ids)
        removeLeadsLocally(confirm.ids)
        toast.push({ type: 'success', message: `Removed ${plural(confirm.ids.length, 'lead', 'leads')}.` })
      }
      setConfirm(null)
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'That did not work. Nothing was changed.' })
      setConfirm(null)
    } finally {
      setConfirming(false)
    }
  }

  const toggleLeadSelect = (leadId) => setSelectedLeadIds((prev) => (prev.includes(leadId) ? prev.filter((id) => id !== leadId) : [...prev, leadId]))

  const handleExport = async () => {
    setExporting(true)
    try {
      const name = (selectedList?.name || 'list').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '_') || 'list'
      await api.exportList(selectedListId, name, 'csv')
    } catch (err) {
      toast.push({ type: 'error', message: err.message || 'Export failed.' })
    } finally {
      setExporting(false)
    }
  }

  const allLeads = listDetail?.leads || []

  return (
    <div id="lead-lists-page" ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 text-white shadow-lg shadow-primary-600/25 ring-1 ring-white/30">
              <List aria-hidden="true" className="h-6 w-6" />
            </span>
            Lead lists
          </span>
        }
        description="Organise your leads into named collections for easy follow-up."
        actions={
          <Button id="create-list-btn" onClick={() => setShowCreate(true)}>
            <Plus aria-hidden="true" className="h-4 w-4" /> New list
          </Button>
        }
      />

      {(lists.length > 0 || search) && (
        <div className="relative mb-6 max-w-sm">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            id="lists-search"
            type="search"
            aria-label={selectedListId ? 'Search leads' : 'Search lists'}
            value={search}
            onChange={(e) => {
              captureLists()
              captureLeads()
              setSearch(e.target.value)
            }}
            placeholder={selectedListId ? 'Search leads…' : 'Search lists…'}
            className="input pl-10"
          />
        </div>
      )}

      <div className={clsx('grid gap-6', selectedListId && 'lg:grid-cols-[18rem_minmax(0,1fr)]')}>
        <div>
          {loadState === 'loading' && (
            <div role="status" aria-label="Loading your lists" className={clsx('grid gap-4', !selectedListId && 'sm:grid-cols-2 xl:grid-cols-3')}>
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-36" />
              ))}
            </div>
          )}
          {loadState === 'error' && (
            <div className="card">
              <ErrorState title="Could not load your lists" message="Check your connection and try again." onRetry={fetchLists} />
            </div>
          )}
          {loadState === 'ready' && lists.length === 0 && (
            <div className="card">
              <EmptyState icon={Inbox} title="No lists yet" description="Create your first list to organise leads you want to follow up." action={{ label: 'Create list', onClick: () => setShowCreate(true) }} />
            </div>
          )}
          {loadState === 'ready' && lists.length > 0 && filteredLists.length === 0 && (
            <div className="card">
              <EmptyState icon={Search} title="No lists match" description={`Nothing is called "${search}".`} action={{ label: 'Clear search', onClick: () => setSearch('') }} />
            </div>
          )}
          <ul ref={gridRef} aria-label="Your lists" className={clsx('grid gap-4', !selectedListId && 'sm:grid-cols-2 xl:grid-cols-3', (loadState !== 'ready' || filteredLists.length === 0) && 'hidden')}>
            {filteredLists.map((list) => (
              <li key={list._id} data-flip-id={list._id} className="min-w-0">
                <ListCard list={list} active={list._id === selectedListId} existingNames={existingNames} onSelect={handleSelectList} onDelete={(l) => setConfirm({ kind: 'list', list: l })} onRename={handleRename} />
              </li>
            ))}
          </ul>
        </div>

        {selectedListId && (
          <section ref={detailRef} aria-label={`Leads in ${selectedList?.name || 'list'}`} className="min-w-0 animate-fade-in">
            <div className="card overflow-hidden p-0">
              <div className="relative flex flex-wrap items-center justify-between gap-3 border-b border-line p-5">
                <div aria-hidden="true" className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ background: `linear-gradient(120deg, ${selectedList?.color || DEFAULT_COLOR}, transparent 70%)` }} />
                <div className="relative flex min-w-0 items-center gap-3">
                  <span className="h-3.5 w-3.5 shrink-0 rounded-full shadow" style={{ background: selectedList?.color || DEFAULT_COLOR }} aria-hidden="true" />
                  <h2 className="min-w-0 break-words text-lg font-black tracking-tight text-ink line-clamp-2" title={selectedList?.name}>
                    {selectedList?.name}
                  </h2>
                  {detailState === 'ready' && <span className="shrink-0 rounded-full bg-head px-2.5 py-1 text-xs font-semibold text-muted ring-1 ring-inset ring-line">{plural(allLeads.length, 'lead', 'leads')}</span>}
                </div>
                <div className="relative flex flex-wrap items-center gap-2">
                  {selectedLeadIds.length > 0 && (
                    <Button size="sm" variant="danger" onClick={() => setConfirm({ kind: 'bulk', ids: selectedLeadIds })}>
                      <Trash2 aria-hidden="true" className="h-3.5 w-3.5" /> Remove {selectedLeadIds.length} selected
                    </Button>
                  )}
                  {allLeads.length > 0 && (
                    <Button size="sm" variant="secondary" loading={exporting} onClick={handleExport} title="Export this list as CSV">
                      {!exporting && <Download aria-hidden="true" className="h-3.5 w-3.5" />} Export CSV
                    </Button>
                  )}
                  <button type="button" onClick={closeDetail} aria-label="Close list" className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-muted hover:bg-head hover:text-ink">
                    <X aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="p-4">
                {detailState === 'loading' && (
                  <div role="status" aria-label="Loading leads" className="space-y-2">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-14" />
                    ))}
                  </div>
                )}
                {detailState === 'error' && <ErrorState title="Could not load this list" message="Check your connection and try again." onRetry={() => fetchDetail(selectedListId)} />}
                {detailState === 'ready' && allLeads.length === 0 && (
                  <EmptyState icon={FolderOpen} title="No leads in this list yet" description='Use "Add to list" on a lead in a request to put it here.' />
                )}
                {detailState === 'ready' && allLeads.length > 0 && filteredLeads.length === 0 && (
                  <EmptyState icon={Search} title="No leads match" description={`Nothing matches "${search}".`} action={{ label: 'Clear search', onClick: () => setSearch('') }} />
                )}
                <ul ref={leadsRef} aria-label="Leads" className="space-y-1">
                  {detailState === 'ready' &&
                    filteredLeads.map((lead) => (
                      <LeadRow key={lead.id} lead={lead} selected={selectedLeadIds.includes(lead.id)} onToggleSelect={toggleLeadSelect} onRemove={handleRemoveLead} />
                    ))}
                </ul>
              </div>
            </div>
          </section>
        )}
      </div>

      <SharedWork kind="lists" excludeIds={lists.map((l) => l.id || l._id)} />

      <CreateListDialog open={showCreate} existingNames={existingNames} onCreate={handleCreate} onClose={() => setShowCreate(false)} />
      <ConfirmDialog
        open={!!confirm}
        destructive
        loading={confirming}
        title={confirm?.kind === 'list' ? 'Delete this list?' : `Remove ${plural(confirm?.ids?.length || 0, 'lead', 'leads')} from this list?`}
        description={confirm?.kind === 'list' ? `"${confirm.list.name}" will be deleted. The leads in it are not removed.` : 'They stay in their requests; only this list changes.'}
        confirmLabel={confirm?.kind === 'list' ? 'Delete list' : 'Remove'}
        onConfirm={runConfirm}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
