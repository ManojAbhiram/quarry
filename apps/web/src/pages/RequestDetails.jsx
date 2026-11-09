import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { useLeads } from '../context/LeadContext'
import { api } from '../api'
import { extractPersonaOptions } from '../utils/decisionMakers'
import { EmptyState, ErrorState, Skeleton, useToast } from '../components/kit'
import { normalizeCompetitor } from './request-details/competitors'
import { bulkMark, deriveRunState, leadKey, toggleMembership } from './request-details/leadHelpers'
import Reveal from '../components/motion/Reveal'
import { TabBar } from './request-details/ui'
import RunHeader, { RunBanner } from './request-details/RunHeader'
import RunDetailsPanel from './request-details/RunDetailsPanel'
import CompaniesTab from './request-details/CompaniesTab'
import CompetitorsPanel from './request-details/CompetitorsPanel'
import DecisionMakersPanel from './request-details/DecisionMakersPanel'
import LeadDrawer from './request-details/LeadDrawer'

const RUNNING_POLL_MS = 5000

function loadErrorFrom(err) {
  if (err?.status === 404) return { notFound: true }
  if (err?.isNetworkError) return { message: "Can't reach Quarry. Check your connection and try again." }
  return { message: 'The results could not be loaded. Please try again.' }
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading results">
      <Skeleton className="mb-3 h-5 w-32" />
      <Skeleton className="mb-3 h-8 w-2/3 max-w-md" />
      <Skeleton className="mb-6 h-5 w-48" />
      <Skeleton className="mb-4 h-10 w-full max-w-lg" />
      <div className="card space-y-2 p-3">
        {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}
      </div>
    </div>
  )
}

export default function RequestDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { requests, getResults, refreshRequests, globalSearchQuery } = useLeads()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [competitorsData, setCompetitorsData] = useState([])
  const [activeTab, setActiveTab] = useState('companies')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [openIndex, setOpenIndex] = useState(null)

  const [lists, setLists] = useState({ saved: [], excluded: [], valid: [], invalid: [] })
  const [manualAdds, setManualAdds] = useState([])

  const [dmCompany, setDmCompany] = useState(null)
  const [dmDataMap, setDmDataMap] = useState({})
  const [dmLoading, setDmLoading] = useState(false)
  const [dmError, setDmError] = useState(null)

  const currentRequest = requests.find((r) => r.id === id)
  const isDirect = currentRequest?.request_type === 'direct_companies'
  const personaOptions = useMemo(() => extractPersonaOptions(currentRequest?.icp_dimensions), [currentRequest?.icp_dimensions])

  const leads = useMemo(() => (data?.leads || []).map((lead, i) => ({ ...lead, _originalIndex: i })), [data])
  const runState = deriveRunState(currentRequest?.status, leads.length)
  const running = runState === 'running'

  // Keep the list marks in step with the server copy of the request.
  useEffect(() => {
    if (!currentRequest) return
    setLists({
      saved: currentRequest.saved_companies || [],
      excluded: currentRequest.excluded_companies || [],
      valid: currentRequest.valid_leads || [],
      invalid: currentRequest.invalid_leads || [],
    })
    setManualAdds(currentRequest.manual_adds || [])
  }, [currentRequest])

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      await refreshRequests()
      const results = await getResults(id)
      setData(results)
      if (Array.isArray(results?.competitors)) setCompetitorsData(results.competitors.map(normalizeCompetitor))
      const first = results?.leads?.[0]
      if (first) setDmCompany((current) => current || leadKey(first))
    } catch (err) {
      console.error('Failed to fetch results:', err)
      setError(loadErrorFrom(err))
    } finally {
      setLoading(false)
    }
  }, [id, getResults, refreshRequests])

  useEffect(() => {
    load()
  }, [load])

  // The run reached a final state: fetch the full results (the snapshot may predate the last step).
  useEffect(() => {
    if (!id || !currentRequest) return
    const s = currentRequest.status?.toLowerCase()
    if (s === 'completed' || s === 'failed') {
      getResults(id)
        .then((results) => {
          setData(results)
          if (Array.isArray(results?.competitors) && results.competitors.length > 0) setCompetitorsData(results.competitors.map(normalizeCompetitor))
        })
        .catch(console.error)
    }
  }, [id, currentRequest?.status, getResults]) // eslint-disable-line react-hooks/exhaustive-deps

  // While the run is in progress, check on it every few seconds so new companies and the final status show up.
  useEffect(() => {
    if (!id || !running) return undefined
    const timer = setInterval(() => {
      refreshRequests()
      getResults(id).then(setData).catch(() => {})
    }, RUNNING_POLL_MS)
    return () => clearInterval(timer)
  }, [id, running, getResults, refreshRequests])

  // Competitors run in the background and can finish after the page loads: poll until they arrive.
  useEffect(() => {
    if (!id || isDirect) return undefined
    if (competitorsData.length > 0) return undefined
    if (currentRequest?.status?.toLowerCase() === 'failed') return undefined

    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 40 // about 2 minutes at 3s intervals
    let timer

    const poll = async () => {
      if (cancelled) return
      attempts += 1
      try {
        const resp = await api.findCompetitors(id)
        if (cancelled) return
        if (Array.isArray(resp?.results) && resp.results.length > 0) {
          setCompetitorsData(resp.results.map(normalizeCompetitor))
          return
        }
        const cStatus = (resp?.status || '').toLowerCase()
        if (cStatus === 'completed' || cStatus === 'failed') return
      } catch {
        // 404 = the analysis is not created yet; keep polling
      }
      if (!cancelled && attempts < MAX_ATTEMPTS) timer = setTimeout(poll, 3000)
    }

    timer = setTimeout(poll, 1500)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [id, isDirect, currentRequest?.status, competitorsData.length])

  const fetchDecisionMakers = useCallback(async () => {
    if (!id) return
    setDmLoading(true)
    setDmError(null)
    try {
      const result = await api.getDecisionMakers(id)
      const grouped = {}
      for (const dm of result.decision_makers || []) {
        const key = dm.company_name || 'Unknown'
        if (!grouped[key]) grouped[key] = []
        grouped[key].push(dm)
      }
      setDmDataMap(grouped)
    } catch (err) {
      console.error('Failed to fetch decision makers:', err)
      setDmError(err?.isNetworkError ? "Can't reach Quarry. Check your connection and try again." : 'The contacts could not be loaded.')
    } finally {
      setDmLoading(false)
    }
  }, [id])

  const showDecisionMakers = (company) => {
    if (company) setDmCompany(company)
    setOpenIndex(null)
    setActiveTab('decision_makers')
    fetchDecisionMakers()
  }

  const saveLists = async (nextLists, nextManual) => {
    const previous = { lists, manualAdds }
    setLists(nextLists)
    setManualAdds(nextManual)
    try {
      await api.updateRequestLists(id, {
        saved_companies: nextLists.saved,
        excluded_companies: nextLists.excluded,
        manual_adds: nextManual,
        valid_leads: nextLists.valid,
        invalid_leads: nextLists.invalid,
      })
    } catch (err) {
      console.error('Failed to sync lists:', err)
      setLists(previous.lists)
      setManualAdds(previous.manualAdds)
      toast.push({ type: 'error', message: 'Could not save that change. It was undone.' })
    }
  }

  const patchLead = (index, patch) => setData((d) => ({ ...d, leads: d.leads.map((l, i) => (i === index ? { ...l, ...patch } : l)) }))
  const goEdit = () => navigate(isDirect ? `/request/${id}/companies` : `/request/${id}/intake`)

  let content
  if (loading && !data) {
    content = <PageSkeleton />
  } else if (error && !data) {
    content = error.notFound ? (
      <EmptyState icon={SearchX} title="Lead request not found" description="It may have been deleted, or the link is wrong." action={{ label: 'Back to lead requests', onClick: () => navigate('/lead-requests') }} />
    ) : (
      <ErrorState title="Could not load this run" message={error.message} onRetry={load} />
    )
  } else if (!currentRequest) {
    content = <EmptyState icon={SearchX} title="Lead request not found" description="It may have been deleted, or the link is wrong." action={{ label: 'Back to lead requests', onClick: () => navigate('/lead-requests') }} />
  } else {
    const tabs = [
      { id: 'companies', label: 'Companies', count: leads.length },
      ...(isDirect ? [] : [{ id: 'competitors', label: 'Competitors', count: competitorsData.length }]),
      { id: 'decision_makers', label: 'Decision makers' },
    ]
    const openLead = openIndex != null ? leads[openIndex] : null
    const flagsFor = (name) => ({ saved: lists.saved.includes(name), excluded: lists.excluded.includes(name), valid: lists.valid.includes(name), invalid: lists.invalid.includes(name) })

    content = (
      <Reveal>
        <RunHeader request={currentRequest} runState={runState} leads={leads} isDirect={isDirect} onEdit={goEdit} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen(!detailsOpen)} />
        <RunBanner runState={runState} request={currentRequest} leadCount={leads.length} onEdit={goEdit} />
        {detailsOpen && !isDirect && <RunDetailsPanel icpDimensions={currentRequest.icp_dimensions} queries={data?.queries || []} onClose={() => setDetailsOpen(false)} />}

        {runState !== 'failed' && (
        <>
        <TabBar
          label="Results"
          layoutId="results-tab-underline"
          active={activeTab}
          onSelect={(tabId) => (tabId === 'decision_makers' ? showDecisionMakers() : setActiveTab(tabId))}
          tabs={tabs.map((tab) => ({ ...tab, props: { id: `tab-${tab.id}`, 'aria-controls': `panel-${tab.id}` } }))}
        />

        <div id="panel-companies" role="tabpanel" aria-labelledby="tab-companies" hidden={activeTab !== 'companies'}>
          <CompaniesTab
            leads={leads}
            lists={lists}
            manualAdds={manualAdds}
            onManualChange={(next) => saveLists(lists, next)}
            onToggleFlag={(name, kind) => saveLists(toggleMembership(lists, name, kind), manualAdds)}
            onBulkMark={(names, kind) => saveLists(bulkMark(lists, names, kind), manualAdds)}
            onOpen={(lead) => setOpenIndex(lead._originalIndex)}
            onEdit={goEdit}
            onViewDecisionMakers={showDecisionMakers}
            runState={runState}
            requestId={id}
            isDirect={isDirect}
            globalSearch={globalSearchQuery}
          />
        </div>
        {!isDirect && activeTab === 'competitors' && (
          <div id="panel-competitors" role="tabpanel" aria-labelledby="tab-competitors">
            <CompetitorsPanel competitors={competitorsData} isRunning={running} requestId={id} />
          </div>
        )}
        {activeTab === 'decision_makers' && (
          <div id="panel-decision_makers" role="tabpanel" aria-labelledby="tab-decision_makers">
            <DecisionMakersPanel leads={leads} dmDataMap={dmDataMap} dmLoading={dmLoading} dmError={dmError} onRefresh={fetchDecisionMakers} company={dmCompany} onSelectCompany={setDmCompany} personaOptions={personaOptions} requestId={id} isRunning={running} />
          </div>
        )}
        </>
        )}

        {openLead && (
          <LeadDrawer
            lead={openLead}
            requestId={id}
            flags={flagsFor(leadKey(openLead))}
            onToggleFlag={(name, kind) => saveLists(toggleMembership(lists, name, kind), manualAdds)}
            onClose={() => setOpenIndex(null)}
            onPatch={patchLead}
            onRefresh={load}
            onViewDecisionMakers={() => showDecisionMakers(leadKey(openLead))}
          />
        )}
      </Reveal>
    )
  }

  return (
    <div id="request-details-page" className="h-full overflow-y-auto">
      <div className="page-container pb-12">{content}</div>
    </div>
  )
}
