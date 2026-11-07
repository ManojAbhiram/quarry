import { useState, useEffect, Fragment } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useLeads } from '../context/LeadContext'
import { api } from '../api'
import { UI } from '../config/constants'
import IntentPanel, { IntentScoreBadge } from '../components/intent/IntentPanel'
import { decorateDecisionMakerContacts, extractPersonaOptions, getPersonaBadgeClass } from '../utils/decisionMakers'
import {
  ArrowLeft, Search, Loader2, Inbox, CheckCircle2, XCircle,
  Briefcase, Mail, Phone, MapPin, Zap, Link as LinkIcon, ExternalLink,
  Copy, Check, ChevronDown, ShieldCheck, Users, Trash2,
  Terminal, Sparkles, Filter, ChevronRight, SlidersHorizontal,
  CheckSquare, Square, X, Compass, Globe, Star, MailCheck,
  Ban, Bookmark, User, TrendingUp, Download, ChevronsLeft, ChevronsRight, Building,
  ThumbsUp, ThumbsDown, List, Plus, BookmarkCheck
} from 'lucide-react'

export default function RequestDetails() {
  const { id } = useParams()
  const requestId = id
  const navigate = useNavigate()
  const [activeExportDropdown, setActiveExportDropdown] = useState(null) // 'companies', 'competitors', 'decision_makers', or null
  const { requests, getResults, deleteRequest, refreshRequests, globalSearchQuery } = useLeads()

  const [loading, setLoading] = useState(true)
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [competitorsData, setCompetitorsData] = useState([])
  const [competitorsLoaded, setCompetitorsLoaded] = useState(false)

  // Navigation & Output Tabs
  const [activeTab, setActiveTab] = useState('companies') // 'companies', 'competitors', 'decision_makers'
  const [showAgentConsole, setShowAgentConsole] = useState(false)
  const [showAllAiQueries, setShowAllAiQueries] = useState(false)
  const [copiedQueries, setCopiedQueries] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)

  // Companies Tab States
  const [companySearch, setCompanySearch] = useState('')
  const [industryFilter, setIndustryFilter] = useState('All')
  const [fundingFilter, setFundingFilter] = useState('All')
  const [geoFilter, setGeoFilter] = useState('All')
  const [headcountFilter, setHeadcountFilter] = useState('All')
  const [techStackFilter, setTechStackFilter] = useState('')
  const [signalsFilter, setSignalsFilter] = useState('All')
  const [growthFilter, setGrowthFilter] = useState('All')

  const [companySubTab, setCompanySubTab] = useState('Recommended') // 'Recommended', 'Saved', 'Excluded', 'Valid', 'Invalid', 'Manual Adds'
  const [savedCompanyNames, setSavedCompanyNames] = useState([])
  const [excludedCompanyNames, setExcludedCompanyNames] = useState([])
  const [validLeadNames, setValidLeadNames] = useState([])
  const [invalidLeadNames, setInvalidLeadNames] = useState([])
  const [manualAdds, setManualAdds] = useState([])
  const [newManualCompany, setNewManualCompany] = useState({ company_name: '', website: '' })
  const [selectedCompanyRowIds, setSelectedCompanyRowIds] = useState([])
  const [showCompanyDetails, setShowCompanyDetails] = useState(false)
  const [companyDetailsLead, setCompanyDetailsLead] = useState(null)
  const [companyDetailsIndex, setCompanyDetailsIndex] = useState(null)

  // Lead Lists state
  const [userLists, setUserLists] = useState([])
  const [listPickerOpenFor, setListPickerOpenFor] = useState(null) // lead index
  const [listPickerLoading, setListPickerLoading] = useState(false)
  const [addingToList, setAddingToList] = useState(false)
  const [emailVerifyState, setEmailVerifyState] = useState({}) // keyed by lead index

  const handleCompanyRowClick = (rawIdx, lead) => {
    setCompanyDetailsLead(lead)
    setCompanyDetailsIndex(rawIdx)
    setShowCompanyDetails(true)
  }

  // Competitors Tab States
  const [competitorSearch, setCompetitorSearch] = useState('')
  const [activeCompetitorTab, setActiveCompetitorTab] = useState('All') // 'All', 'Direct', 'Adjacent', 'DIY'
  const [selectedCompareList, setSelectedCompareList] = useState([])
  const [showCompareDrawer, setShowCompareDrawer] = useState(false)

  // Competitor Filters
  const [compDeployment, setCompDeployment] = useState('All')
  const [compPricing, setCompPricing] = useState('All')
  const [compFunding, setCompFunding] = useState('All')
  const [compGeo, setCompGeo] = useState('All')
  const [compSize, setCompSize] = useState('All')
  const [compRating, setCompRating] = useState('All')
  const [compOverlap, setCompOverlap] = useState(0)

  // Decision Makers Tab States
  const [selectedDecisionMakerCompany, setSelectedDecisionMakerCompany] = useState(null)
  const [dmSearchQuery, setDmSearchQuery] = useState('')
  const [dmSeniority, setDmSeniority] = useState('All')
  const [dmDepartment, setDmDepartment] = useState('All')
  const [dmPersona, setDmPersona] = useState('All')
  const [dmVerifiedOnly, setDmVerifiedOnly] = useState(false)
  const [dmCompanySearch, setDmCompanySearch] = useState('')
  const [selectedContacts, setSelectedContacts] = useState([])
  const [dmLoading, setDmLoading] = useState(false)
  const [dmDataMap, setDmDataMap] = useState({}) // keyed by company_name

  // Deletion States
  const [deleting, setDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Custom Alert states and helper
  const [customAlert, setCustomAlert] = useState({ show: false, title: '', message: '', type: 'info' })
  const triggerAlert = (message, title = 'Notification', type = 'info') => {
    setCustomAlert({ show: true, message, title, type })
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteRequest(id)
      navigate('/lead-requests')
    } catch (err) {
      console.error('Failed to delete request:', err)
      setError('Failed to delete the lead request. Please try again.')
      setShowDeleteConfirm(false)
    } finally {
      setDeleting(false)
    }
  }

  const fetchDecisionMakers = async () => {
    if (!id) return
    setDmLoading(true)
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
    } finally {
      setDmLoading(false)
    }
  }

  const loadCompetitors = async () => {
    // Only skip if we already have competitors — never lock on an empty result,
    // because the competitor pipeline may still be running in the background.
    if (competitorsData.length > 0) return
    try {
      const compResp = await api.findCompetitors(id)
      if (Array.isArray(compResp?.results) && compResp.results.length > 0) {
        setCompetitorsData(compResp.results.map(normalizeCompetitor))
        setCompetitorsLoaded(true)
      }
    } catch (err) {
      console.error('Failed to fetch competitors:', err)
    }
  }

  const handleCopyQueries = () => {
    if (!data?.queries || data.queries.length === 0) return
    navigator.clipboard.writeText(data.queries.join('\n'))
    setCopiedQueries(true)
    setTimeout(() => setCopiedQueries(false), UI.COPY_FEEDBACK_MS)
  }

  const currentRequest = requests.find(r => r.id === id)
  // Direct-Companies requests skip ICP/queries/competitors — the detail page
  // hides that ICP-only UI and reframes copy around the user-supplied companies.
  const isDirect = currentRequest?.request_type === 'direct_companies'
  const personaOptions = extractPersonaOptions(currentRequest?.icp_dimensions)

  useEffect(() => {
    if (currentRequest) {
      setSavedCompanyNames(currentRequest.saved_companies || [])
      setExcludedCompanyNames(currentRequest.excluded_companies || [])
      setValidLeadNames(currentRequest.valid_leads || [])
      setInvalidLeadNames(currentRequest.invalid_leads || [])
      setManualAdds(currentRequest.manual_adds || [])
    }
  }, [currentRequest])

  const handleUpdateLists = async (updates) => {
    try {
      await api.updateRequestLists(id, {
        saved_companies: updates.savedCompanyNames ?? savedCompanyNames,
        excluded_companies: updates.excludedCompanyNames ?? excludedCompanyNames,
        manual_adds: updates.manualAdds ?? manualAdds,
        valid_leads: updates.validLeadNames ?? validLeadNames,
        invalid_leads: updates.invalidLeadNames ?? invalidLeadNames,
      })
    } catch (err) {
      console.error("Failed to sync lists:", err)
      triggerAlert('Failed to sync changes.', 'Error', 'error')
    }
  }

  const normalizeCompetitor = (result) => {
    const website = result.company_website || result.website || '--'
    let name = result.company_name || '--'
    if (name === '--' && result.title) {
      const parts = result.title.split(/\s*[|—\-]\s*/)
      const last = parts[parts.length - 1].trim()
      if (last) name = last
    }
    if (name === '--') {
      try {
        const domain = new URL(website).hostname.replace(/^www\./, '')
        const root = domain.split('.')[0]
        name = root.charAt(0).toUpperCase() + root.slice(1)
      } catch { name = '--' }
    }
    const score = typeof result.overlap_score === 'number' ? result.overlap_score
      : (typeof result.match_score === 'number' ? result.match_score : 0)
    const tier = result.tier || (score >= 80 ? 'Direct' : score >= 55 ? 'Adjacent' : 'DIY/Build')
    const g2 = (result.g2_rating !== undefined && result.g2_rating !== null && result.g2_rating !== '') ? result.g2_rating : '--'
    const cap = (result.capterra_rating !== undefined && result.capterra_rating !== null && result.capterra_rating !== '') ? result.capterra_rating : '--'
    return {
      name,
      website,
      description: result.description || '--',
      tier,
      overlap_score: score,
      employee_count: result.company_size || result.employee_count || '--',
      headquarters: result.headquarters || result.location || '--',
      g2_rating: g2,
      capterra_rating: cap,
      reason: result.reason || '',
      linkedin_url: result.linkedin_url || '--',
      industry: result.industry || '--',
      company_type: result.company_type || '--',
      founded: result.founded || '--',
      specialties: result.specialties || '--',
    }
  }

  useEffect(() => {
    async function fetchData() {
      if (!id) return
      setLoading(true)
      try {
        await refreshRequests()
        const results = await getResults(id)
        setData(results)
        if (Array.isArray(results?.competitors)) {
          setCompetitorsData(results.competitors.map(normalizeCompetitor))
          setCompetitorsLoaded(results.competitors.length > 0)
        }
        const firstLead = results?.leads?.[0]
        if (firstLead) {
          setSelectedDecisionMakerCompany(firstLead.company_name || firstLead.name || firstLead.title)
        }
      } catch (err) {
        console.error('Failed to fetch results:', err)
        setError('Failed to load lead intelligence.')
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [id, getResults, refreshRequests])

  // Re-fetch full results when SSE-driven status changes to a terminal state
  useEffect(() => {
    if (!id || !currentRequest) return
    const s = currentRequest.status?.toLowerCase()
    if (s === 'completed' || s === 'failed') {
      getResults(id).then(results => {
        setData(results)
        // Also refresh competitors — the previous data snapshot may have been
        // captured while the competitor pipeline was still running.
        if (Array.isArray(results?.competitors) && results.competitors.length > 0) {
          setCompetitorsData(results.competitors.map(normalizeCompetitor))
          setCompetitorsLoaded(true)
        }
      }).catch(console.error)
    }
  }, [id, currentRequest?.status, getResults])

  // Poll for competitors until they arrive. The competitor pipeline runs in the
  // background and can complete after the initial page load, so without this the
  // competitors tab stays empty until a manual page reload.
  useEffect(() => {
    if (!id || isDirect) return
    if (competitorsData.length > 0) return
    const reqStatus = currentRequest?.status?.toLowerCase()
    if (reqStatus === 'failed') return

    let cancelled = false
    let attempts = 0
    const MAX_ATTEMPTS = 40 // ~2 minutes at 3s intervals
    let timer

    const poll = async () => {
      if (cancelled) return
      attempts += 1
      try {
        const resp = await api.findCompetitors(id)
        if (cancelled) return
        if (Array.isArray(resp?.results) && resp.results.length > 0) {
          setCompetitorsData(resp.results.map(normalizeCompetitor))
          setCompetitorsLoaded(true)
          return // done — stop polling
        }
        const cStatus = (resp?.status || '').toLowerCase()
        if (cStatus === 'completed' || cStatus === 'failed') {
          setCompetitorsLoaded(true)
          return // analysis finished with no competitors — stop polling
        }
      } catch (err) {
        // 404 = analysis not created yet; keep polling
      }
      if (!cancelled && attempts < MAX_ATTEMPTS) {
        timer = setTimeout(poll, 3000)
      }
    }

    timer = setTimeout(poll, 1500)
    return () => { cancelled = true; if (timer) clearTimeout(timer) }
  }, [id, isDirect, currentRequest?.status, competitorsData.length])

  if (!currentRequest && !loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in">
        <XCircle className="w-16 h-16 text-rose-500 mb-4" />
        <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Lead Request Not Found</h2>
        <p className="text-slate-500 dark:text-slate-400 mt-2 mb-8">The requested lead generation entry could not be found.</p>
        <button onClick={() => navigate('/lead-requests')} className="btn-primary px-8">
          <ArrowLeft className="w-5 h-5" />
          Back to Lead Requests
        </button>
      </div>
    )
  }

  return (
    <div id="request-details-page" className="animate-fade-in flex flex-col h-full w-full overflow-hidden bg-slate-50/10 dark:bg-[#0f172a]/10">

      {/* Main Core Layout */}
      <div id="details-content" className="flex-1 flex overflow-hidden w-full items-center justify-center h-full">
        {loading ? (
          <div className="flex flex-col items-center justify-center w-full h-full flex-1 text-primary-600 dark:text-primary-400">
            <div className="relative mb-6">
              <Loader2 className="w-14 h-14 animate-spin" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-3 h-3 bg-primary-600 dark:bg-primary-400 rounded-full animate-ping" />
              </div>
            </div>
            <p className="font-extrabold text-xl text-slate-750 dark:text-slate-200 tracking-tight">{isDirect ? 'Finding decision makers...' : 'Sourcing ICP & Competitors...'}</p>
            <p className="text-slate-400 dark:text-slate-500 mt-2 font-medium">{isDirect ? 'Resolving your companies and sourcing direct contacts...' : 'Researching real-time signals, databases and GTM matrix...'}</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 bg-rose-50/50 dark:bg-rose-900/10 rounded-3xl border border-rose-100 dark:border-rose-900/30 animate-fade-in">
            <div className="mx-auto w-16 h-16 bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8" />
            </div>
            <h4 className="text-xl font-bold text-rose-900 dark:text-rose-400 mb-2 animate-pulse">Intelligence Sourcing Offline</h4>
            <p className="text-slate-600 dark:text-slate-400 max-w-md mx-auto font-medium">
              We encountered an issue retrieving the live lead metrics. Please retry below.
            </p>
            <button onClick={() => window.location.reload()} className="mt-6 btn-primary bg-rose-600 hover:bg-rose-700 shadow-rose-200 dark:shadow-none">
              Retry Sourcing
            </button>
          </div>
        ) : data ? (() => {

          const rawLeads = data.leads || []
          const leadsWithIndex = rawLeads.map((lead, i) => ({ ...lead, _originalIndex: i }))
          const filteredLeads = leadsWithIndex
            .filter(lead => {
              const nameText = (lead.company_name || lead.name || lead.title || '').toLowerCase()
              const indText = (lead.industry || '').toLowerCase()
              const locText = (lead.location || '').toLowerCase()
              const techText = (lead.tech_stack || []).join(' ').toLowerCase()
              const sigText = (
                (lead.signals || []).join(' ') + 
                ' ' + 
                (lead.intent_signals || []).map(s => `${s.type} ${s.title} ${s.summary}`).join(' ')
              ).toLowerCase()
              const s = (companySearch || globalSearchQuery).toLowerCase()

              const matchesSearch = nameText.includes(s) || indText.includes(s) || locText.includes(s)
              const matchesIndustry = industryFilter === 'All' || lead.industry === industryFilter
              const matchesFunding = fundingFilter === 'All' || lead.funding_stage === fundingFilter
              const matchesGeo = geoFilter === 'All' || (lead.location && lead.location.includes(geoFilter)) || (lead.url && lead.url.toLowerCase().includes(geoFilter.toLowerCase()))

              // Headcount check
              const matchesHeadcount = headcountFilter === 'All' ||
                (headcountFilter === '10-50' && parseInt(lead.employee_size_estimate) >= 10 && parseInt(lead.employee_size_estimate) <= 50) ||
                (headcountFilter === '50-200' && parseInt(lead.employee_size_estimate) > 50 && parseInt(lead.employee_size_estimate) <= 200) ||
                (headcountFilter === '200-500' && parseInt(lead.employee_size_estimate) > 200 && parseInt(lead.employee_size_estimate) <= 500) ||
                (headcountFilter === '500-1000' && parseInt(lead.employee_size_estimate) > 500 && parseInt(lead.employee_size_estimate) <= 1000) ||
                (headcountFilter === '1000+' && parseInt(lead.employee_size_estimate) > 1000)

              const matchesTechStack = !techStackFilter || techText.includes(techStackFilter.toLowerCase())
              const matchesSignals = signalsFilter === 'All' || sigText.includes(signalsFilter.toLowerCase())
              const matchesGrowth = growthFilter === 'All' ||
                (growthFilter === '+10%+' && parseFloat(lead.growth) >= 10) ||
                (growthFilter === '+25%+' && parseFloat(lead.growth) >= 25) ||
                (growthFilter === '+50%+' && parseFloat(lead.growth) >= 50)

              // Sub-tab filter logic
              const compKey = lead.company_name || lead.name || lead.title
              const isSaved = savedCompanyNames.includes(compKey)
              const isExcluded = excludedCompanyNames.includes(compKey)
              const isValid = validLeadNames.includes(compKey)
              const isInvalid = invalidLeadNames.includes(compKey)
              const baseFilters = matchesSearch && matchesIndustry && matchesFunding && matchesGeo && matchesHeadcount && matchesTechStack && matchesSignals && matchesGrowth

              if (companySubTab === 'Recommended') {
                return baseFilters && !isSaved && !isExcluded && !isValid && !isInvalid
              } else if (companySubTab === 'Saved') {
                return baseFilters && isSaved
              } else if (companySubTab === 'Excluded') {
                return baseFilters && isExcluded
              } else if (companySubTab === 'Valid') {
                return baseFilters && isValid
              } else if (companySubTab === 'Invalid') {
                return baseFilters && isInvalid
              } else if (companySubTab === 'Manual Adds') {
                return false
              }

              return baseFilters
            })
            .sort((a, b) => (parseInt(b.match_score) || 0) - (parseInt(a.match_score) || 0));

          // Unique filter options for dropdowns
          const industries = ['All', ...new Set(rawLeads.map(l => l.industry).filter(Boolean))]
          const fundingStages = ['All', ...new Set(rawLeads.map(l => l.funding_stage).filter(Boolean))]
          const geographies = ['All', 'US', 'Europe', 'Canada', 'UK', 'Asia']

          // Competitors
          const rawCompetitors = competitorsData
          const filteredCompetitors = rawCompetitors.filter(c => {
            const term = (competitorSearch || globalSearchQuery).toLowerCase()
            const matchesSearch = c.name.toLowerCase().includes(term) ||
              c.description.toLowerCase().includes(term)

            const matchesTab = activeCompetitorTab === 'All' ||
              (activeCompetitorTab === 'Direct' && c.tier === 'Direct') ||
              (activeCompetitorTab === 'Adjacent' && c.tier === 'Adjacent') ||
              (activeCompetitorTab === 'DIY' && c.tier.includes('DIY'))

            const matchesDeployment = compDeployment === 'All' || c.deployment_model === compDeployment
            const matchesPricing = compPricing === 'All' || (c.pricing_model !== '--' && c.pricing_model.toLowerCase().includes(compPricing.toLowerCase()))
            const matchesFunding = compFunding === 'All' || c.funding_stage === compFunding
            const matchesGeo = compGeo === 'All' || (c.headquarters !== '--' && c.headquarters.includes(compGeo))
            const matchesSize = compSize === 'All' ||
              (compSize === '10-50' && parseInt(c.employee_count) >= 10 && parseInt(c.employee_count) <= 50) ||
              (compSize === '50-200' && parseInt(c.employee_count) > 50 && parseInt(c.employee_count) <= 200) ||
              (compSize === '200+' && parseInt(c.employee_count) > 200)
            const matchesRating = compRating === 'All' || (typeof c.g2_rating === 'number' && c.g2_rating >= parseFloat(compRating))
            const matchesOverlap = c.overlap_score >= compOverlap

            return matchesSearch && matchesTab && matchesDeployment && matchesPricing && matchesFunding && matchesGeo && matchesSize && matchesRating && matchesOverlap
          })

          // Contacts for selected decision maker company
          const selectedLead = rawLeads.find(l => (l.company_name || l.name || l.title) === selectedDecisionMakerCompany) || rawLeads[0]
          const activeContacts = decorateDecisionMakerContacts(
            (Object.keys(dmDataMap).length > 0
              ? dmDataMap[selectedDecisionMakerCompany]
              : null) ?? (selectedLead?.decision_makers || []),
            {
              leadMatchScore: selectedLead?.match_score,
              personaOptions,
            },
          )

          // Complete progress matching sidebar design
          let sidebarProgress = 14
          let sidebarStepLabel = "1/7"
          if (activeTab === 'competitors') {
            sidebarProgress = 28
            sidebarStepLabel = "2/7"
          } else if (activeTab === 'decision_makers') {
            sidebarProgress = 42
            sidebarStepLabel = "3/7"
          }

          const isPipelineRunning = ['pending', 'active'].includes(currentRequest?.status?.toLowerCase())

          return (
            <div className="flex-1 flex w-full h-full overflow-hidden animate-slide-up select-none">

              {/* LEFT PAGE-SPECIFIC COLLAPSIBLE SIDEBAR */}
              <div className={`bg-white dark:bg-slate-900 border-r border-slate-200/60 dark:border-slate-850 flex flex-col ${isDirect ? 'justify-start' : 'justify-between'} transition-all duration-300 shrink-0 h-full overflow-y-auto ${isSidebarCollapsed
                  ? 'w-[72px] px-3 py-6 items-center space-y-6'
                  : 'w-[260px] p-6 space-y-8'
                }`}>

                {/* Sidebar Header / Toggle */}
                <div className={`flex items-center w-full ${isSidebarCollapsed ? 'justify-center' : 'justify-end'}`}>
                  <button
                    type="button"
                    onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                    className="p-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-850 text-slate-450 hover:text-violet-500 hover:bg-violet-50/50 transition-all cursor-pointer"
                    title={isSidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
                  >
                    {isSidebarCollapsed ? <ChevronsRight className="w-4 h-4 text-violet-500" /> : <ChevronsLeft className="w-4 h-4 text-violet-500" />}
                  </button>
                </div>

                {/* Workflow Section */}
                <div className="space-y-4 w-full">
                  {!isSidebarCollapsed && (
                    <span className="text-[11.5px] font-bold text-slate-400 dark:text-slate-500 block pl-2">Workflow</span>
                  )}

                  <div className={`relative ${isSidebarCollapsed ? 'flex flex-col items-center py-2' : 'pl-3'}`}>
                    {/* Connecting Vertical Line */}
                    <div className={`absolute ${isSidebarCollapsed ? 'left-[10px] top-4 bottom-4' : 'left-[21px] top-4 bottom-4'
                      } w-[1.5px] bg-slate-100 dark:bg-slate-800/60 z-0`}></div>

                    <div className="space-y-5">
                      {isDirect ? (
                        /* Companies Input (Direct-Companies flow) */
                        <div className="flex items-center gap-3 relative z-10">
                          <div
                            onClick={() => navigate(`/request/${id}/companies`)}
                            className="w-5.5 h-5.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-sm cursor-pointer active:scale-95 transition-all"
                            title="Companies Input (Completed) - Click to edit"
                          >
                            <Check className="w-3 h-3 text-white" strokeWidth={3.5} />
                          </div>
                          {!isSidebarCollapsed && (
                            <button
                              type="button"
                              onClick={() => navigate(`/request/${id}/companies`)}
                              className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                            >
                              Companies Input
                            </button>
                          )}
                        </div>
                      ) : (
                        <>
                          {/* Product Input */}
                          <div className="flex items-center gap-3 relative z-10">
                            <div
                              onClick={() => navigate(`/request/${id}/intake`)}
                              className="w-5.5 h-5.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-sm cursor-pointer active:scale-95 transition-all"
                              title="Product Input (Completed) - Click to edit"
                            >
                              <Check className="w-3 h-3 text-white" strokeWidth={3.5} />
                            </div>
                            {!isSidebarCollapsed && (
                              <button
                                type="button"
                                onClick={() => navigate(`/request/${id}/intake`)}
                                className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                              >
                                Product Input
                              </button>
                            )}
                          </div>

                          {/* ICP Definition */}
                          <div className="flex items-center gap-3 relative z-10">
                            <div
                              onClick={() => navigate(`/request/${id}/intake`)}
                              className="w-5.5 h-5.5 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center shadow-sm cursor-pointer active:scale-95 transition-all"
                              title="ICP Definition (Completed) - Click to edit"
                            >
                              <Check className="w-3 h-3 text-white" strokeWidth={3.5} />
                            </div>
                            {!isSidebarCollapsed && (
                              <button
                                type="button"
                                onClick={() => navigate(`/request/${id}/intake`)}
                                className="text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                              >
                                ICP Definition
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Output Section */}
                <div className="space-y-3 w-full">
                  {!isSidebarCollapsed && (
                    <span className="text-[11.5px] font-bold text-slate-400 dark:text-slate-500 block pl-2">Output</span>
                  )}

                  <div className={`space-y-2.5 ${isSidebarCollapsed ? 'flex flex-col items-center pt-2' : ''}`}>
                    {/* Companies Tab */}
                    <button
                      type="button"
                      onClick={() => setActiveTab('companies')}
                      className={`flex items-center transition-all cursor-pointer ${isSidebarCollapsed
                          ? `w-10 h-10 rounded-xl justify-center relative ${activeTab === 'companies'
                            ? 'bg-violet-50 dark:bg-violet-955/20 text-violet-600 border border-violet-200/60 dark:border-violet-850'
                            : 'bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/40 border border-transparent'
                          }`
                          : `w-full px-3 py-2 text-xs font-semibold rounded-2xl border ${activeTab === 'companies'
                            ? 'bg-violet-50/90 dark:bg-violet-950/30 text-violet-650 dark:text-violet-400 border-violet-100/60 dark:border-violet-900/10 shadow-sm'
                            : 'bg-transparent text-slate-650 dark:text-slate-400 border-transparent hover:bg-slate-50/70 dark:hover:bg-slate-800/20 hover:text-slate-900 dark:hover:text-white'
                          }`
                        }`}
                      title={isSidebarCollapsed ? "Companies" : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm border transition-all ${activeTab === 'companies'
                            ? 'bg-white dark:bg-slate-900 border-violet-100 dark:border-violet-800 text-violet-600'
                            : 'bg-slate-100/80 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700 text-slate-500'
                          }`}>
                          <Building className="w-4 h-4 text-violet-500" />
                        </div>
                        {!isSidebarCollapsed && <span>Companies</span>}
                      </div>
                    </button>

                    {/* Competitors Tab — ICP flow only */}
                    {!isDirect && (
                    <button
                      type="button"
                      onClick={() => { setActiveTab('competitors'); loadCompetitors() }}
                      className={`flex items-center transition-all cursor-pointer ${isSidebarCollapsed
                          ? `w-10 h-10 rounded-xl justify-center relative ${activeTab === 'competitors'
                            ? 'bg-violet-50 dark:bg-violet-955/20 text-violet-600 border border-violet-200/60 dark:border-violet-850'
                            : 'bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/40 border border-transparent'
                          }`
                          : `w-full px-3 py-2 text-xs font-semibold rounded-2xl border ${activeTab === 'competitors'
                            ? 'bg-violet-50/90 dark:bg-violet-950/30 text-violet-650 dark:text-violet-400 border-violet-100/60 dark:border-violet-900/10 shadow-sm'
                            : 'bg-transparent text-slate-650 dark:text-slate-400 border-transparent hover:bg-slate-50/70 dark:hover:bg-slate-800/20 hover:text-slate-900 dark:hover:text-white'
                          }`
                        }`}
                      title={isSidebarCollapsed ? "Competitors" : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm border transition-all ${activeTab === 'competitors'
                            ? 'bg-white dark:bg-slate-900 border-violet-100 dark:border-violet-800 text-violet-600'
                            : 'bg-slate-100/80 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700 text-slate-500'
                          }`}>
                          <Building className="w-4 h-4 text-violet-500" />
                        </div>
                        {!isSidebarCollapsed && <span>Competitors</span>}
                      </div>
                    </button>
                    )}

                    {/* Decision Makers Tab */}
                    <button
                      type="button"
                      onClick={() => { setActiveTab('decision_makers'); fetchDecisionMakers() }}
                      className={`flex items-center transition-all cursor-pointer ${isSidebarCollapsed
                          ? `w-10 h-10 rounded-xl justify-center relative ${activeTab === 'decision_makers'
                            ? 'bg-violet-50 dark:bg-violet-955/20 text-violet-600 border border-violet-200/60 dark:border-violet-850'
                            : 'bg-transparent text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/40 border border-transparent'
                          }`
                          : `w-full px-3 py-2 text-xs font-semibold rounded-2xl border ${activeTab === 'decision_makers'
                            ? 'bg-violet-50/90 dark:bg-violet-950/30 text-violet-650 dark:text-violet-400 border-violet-100/60 dark:border-violet-900/10 shadow-sm'
                            : 'bg-transparent text-slate-650 dark:text-slate-400 border-transparent hover:bg-slate-50/70 dark:hover:bg-slate-800/20 hover:text-slate-900 dark:hover:text-white'
                          }`
                        }`}
                      title={isSidebarCollapsed ? "Decision Makers" : undefined}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm border transition-all ${activeTab === 'decision_makers'
                            ? 'bg-white dark:bg-slate-900 border-violet-100 dark:border-violet-800 text-violet-600'
                            : 'bg-slate-100/80 dark:bg-slate-800 border-slate-200/50 dark:border-slate-700 text-slate-500'
                          }`}>
                          <User className="w-4 h-4 text-violet-500" />
                        </div>
                        {!isSidebarCollapsed && <span>Decision Makers</span>}
                      </div>
                    </button>
                  </div>
                </div>

                {/* Progress / Logs Section — ICP flow only (direct flow has no queries/ICP dimensions) */}
                {!isDirect && (
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 w-full space-y-4">
                  {!isSidebarCollapsed ? (
                    <>
                      {/* Expanded Progress Bar */}
                      <div>
                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-450 dark:text-slate-500 mb-1.5">
                          <span>Progress</span>
                          <span>{sidebarStepLabel} {sidebarProgress}%</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-850 rounded-full h-1.5 overflow-hidden shadow-inner">
                          <div
                            className="bg-gradient-to-r from-primary-500 to-indigo-500 h-1.5 rounded-full transition-all duration-500"
                            style={{ width: `${sidebarProgress}%` }}
                          />
                        </div>
                      </div>

                      {/* Expanded Logs console toggler */}
                      <button
                        type="button"
                        onClick={() => setShowAgentConsole(!showAgentConsole)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-xl border text-left text-[11px] font-bold transition-all group cursor-pointer ${showAgentConsole
                            ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-400'
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-950/40 dark:hover:bg-slate-900/40 border-slate-200 dark:border-slate-800/40 text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400'
                          }`}
                      >
                        <div className="flex items-center gap-2">
                          <Terminal className="w-3.5 h-3.5 text-slate-400 group-hover:text-primary-500 transition-colors" />
                          <span>Logs Console</span>
                        </div>
                        <ChevronDown className={`w-3 h-3 transition-transform duration-305 ${showAgentConsole ? 'rotate-180 text-primary-500' : 'text-slate-400'}`} />
                      </button>
                    </>
                  ) : (
                    <div className="flex flex-col items-center">
                      <button
                        type="button"
                        onClick={() => setShowAgentConsole(!showAgentConsole)}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all cursor-pointer border ${showAgentConsole
                            ? 'bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800/40 text-violet-700 dark:text-violet-400'
                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-950/40 dark:hover:bg-slate-900/40 border-slate-200 dark:border-slate-800/40 text-slate-500 dark:text-slate-400 hover:text-violet-600 dark:hover:text-violet-400'
                          }`}
                        title="Toggle logs console"
                      >
                        <Terminal className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
                )}

              </div>

              {/* RIGHT CONTENT PANEL (DYNAMIC INTERFACE) */}
              <div className="flex-1 overflow-y-auto px-8 py-8 space-y-6 bg-slate-50/20 dark:bg-[#0c1222]/30">

                {/* Optional Agent Console Drawer */}
                {showAgentConsole && (
                  <div className="bg-[#090d16] text-slate-200 rounded-[2.25rem] border border-slate-850 shadow-2xl p-6 relative overflow-hidden font-mono animate-slide-up mb-6">
                    <div className="flex items-center justify-between pb-4 border-b border-slate-800/80 mb-4 select-none">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-rose-500 inline-block"></span>
                        <span className="w-3 h-3 rounded-full bg-amber-500 inline-block"></span>
                        <span className="w-3 h-3 rounded-full bg-emerald-500 inline-block"></span>
                        <span className="text-[11px] text-slate-500 ml-2">quarry-agent-dorker.sh</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {data?.queries?.length > 0 && (
                          <button
                            type="button"
                            onClick={handleCopyQueries}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[10px] font-bold border transition-all ${copiedQueries
                                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                                : 'bg-slate-800/50 border-slate-700/50 hover:bg-slate-700/50 text-slate-300'
                              }`}
                          >
                            {copiedQueries ? <><CheckCircle2 className="w-3 h-3" /> Copied</> : <><Copy className="w-3 h-3" /> Copy Prompts</>}
                          </button>
                        )}
                        <button onClick={() => setShowAgentConsole(false)} className="text-slate-500 hover:text-slate-300 p-1.5 hover:bg-slate-900 rounded-lg">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar text-xs leading-relaxed space-y-3.5 pr-2">

                      {/* ICP Dimensions Section */}
                      {currentRequest?.icp_dimensions && (() => {
                        const dims = currentRequest.icp_dimensions
                        const dimLabels = {
                          firmographic: 'Firmographic',
                          technographic: 'Technographic',
                          team_structure: 'Team & Decision Makers',
                          buying_signals: 'Buying Signals',
                          compliance: 'Compliance',
                          deployment_pref: 'Deployment Preferences'
                        }
                        const dimEntries = Object.entries(dims).filter(([k]) => dimLabels[k])
                        if (dimEntries.length === 0) return null
                        return (
                          <>
                            <div className="flex items-center gap-2 text-[10px] text-violet-400 bg-violet-950/20 border border-violet-900/30 rounded-lg px-2.5 py-1 w-fit">
                              <Sparkles className="w-3 h-3" />
                              <span>ICP Generated — {dimEntries.length} dimensions</span>
                            </div>
                            {dimEntries.map(([key, val]) => {
                              const label = dimLabels[key]
                              const isObj = typeof val === 'object' && val !== null
                              const textVal = isObj ? val.value : val
                              const confidence = isObj ? val.confidence : null
                              const warning = isObj ? val.warning : null
                              const bullets = (textVal || '').split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
                              return (
                                <div key={key} className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-900">
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-violet-400 font-bold text-[11px]">{label}</span>
                                    {confidence && (
                                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md ${confidence.toLowerCase().includes('high')
                                          ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/40'
                                          : confidence.toLowerCase().includes('low')
                                            ? 'bg-rose-950/30 text-rose-400 border border-rose-900/40'
                                            : 'bg-amber-950/30 text-amber-400 border border-amber-900/40'
                                        }`}>
                                        {confidence}
                                      </span>
                                    )}
                                  </div>
                                  {warning && (
                                    <div className="text-[10px] text-amber-400/80 bg-amber-950/20 border border-amber-900/30 rounded-lg px-2 py-1 mb-2">
                                      ⚠ {warning}
                                    </div>
                                  )}
                                  {bullets.length > 0 ? (
                                    <div className="space-y-1">
                                      {bullets.map((b, i) => (
                                        <div key={i} className="flex gap-2 text-slate-300">
                                          <span className="text-slate-600 select-none shrink-0">•</span>
                                          <span>{b}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-slate-500 italic">No data</span>
                                  )}
                                </div>
                              )
                            })}
                            <div className="border-t border-slate-800/50 my-2" />
                          </>
                        )
                      })()}

                      {/* Dorking Queries Section */}
                      <div className="flex items-center gap-2 text-[10px] text-emerald-400 bg-emerald-950/20 border border-emerald-900/30 rounded-lg px-2.5 py-1 w-fit">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block animate-ping"></span>
                        <span>Dorking engine synthesized {data.queries?.length || 0} pathways</span>
                      </div>

                      {data?.queries?.length > 0 ? (
                        (showAllAiQueries ? data.queries : data.queries.slice(0, 3)).map((query, index) => (
                          <div key={index} className="flex gap-2.5 bg-slate-950/60 p-3.5 rounded-xl border border-slate-900 font-mono text-slate-300 break-all leading-normal">
                            <span className="text-slate-600 select-none">[{index + 1}]</span>
                            <span>{query}</span>
                          </div>
                        ))
                      ) : (
                        <div className="text-slate-500 italic py-4"># No queries executed. Standard API scraping fallback applied.</div>
                      )}

                      {data?.queries?.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setShowAllAiQueries(!showAllAiQueries)}
                          className="text-primary-400 hover:text-primary-300 text-[10px] font-bold mt-2"
                        >
                          {showAllAiQueries ? 'Collapse agent logs' : `Show all ${data.queries.length} pathways ->`}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* 1. COMPANIES TAB */}
                {activeTab === 'companies' && (
                  <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-6 shadow-xl shadow-slate-100/50 dark:shadow-none space-y-6 animate-fade-in">

                    {/* Tab Header */}
                    <div>
                      <h2 className="text-2xl font-black text-slate-850 dark:text-white tracking-tight">{isDirect ? 'Target Companies' : 'Company Sourcing'}</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">{isDirect ? 'Companies you provided, resolved and enriched with their decision makers.' : 'Verify qualified target companies based on the ICP Blueprint.'}</p>
                    </div>

                    {/* Pipeline Running Banner */}
                    {isPipelineRunning && (
                      <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl">
                        <div className="relative shrink-0 w-2.5 h-2.5">
                          <div className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-75" />
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-black text-amber-700 dark:text-amber-400">Pipeline Running</span>
                          <span className="text-xs text-amber-600/80 dark:text-amber-500/80 ml-2 font-semibold">Sourcing and scoring companies — results will appear as analysis completes</span>
                        </div>
                        <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                      </div>
                    )}

                    {/* TOP ADVANCED FILTER BAR */}
                    <div className="flex flex-wrap items-center gap-3 bg-slate-50/50 dark:bg-slate-950/30 p-3 rounded-2xl border border-slate-200/60 dark:border-slate-800/80">

                      {/* Industry Filter */}
                      <div className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-violet-400 dark:hover:border-violet-650 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Briefcase className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <select
                          value={industryFilter}
                          onChange={(e) => setIndustryFilter(e.target.value)}
                          className="appearance-none bg-transparent w-full focus:outline-none cursor-pointer text-xs font-black pr-2 text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">Industry: All</option>
                          {industries.filter(i => i !== 'All').map(ind => (
                            <option key={ind} value={ind} className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">{ind}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>

                      {/* Headcount Filter */}
                      <div className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-violet-400 dark:hover:border-violet-650 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Users className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <select
                          value={headcountFilter}
                          onChange={(e) => setHeadcountFilter(e.target.value)}
                          className="appearance-none bg-transparent w-full focus:outline-none cursor-pointer text-xs font-black pr-2 text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">Headcount: All</option>
                          <option value="10-50" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">10-50</option>
                          <option value="50-200" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">50-200</option>
                          <option value="200-500" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">200-500</option>
                          <option value="500-1000" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">500-1000</option>
                          <option value="1000+" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">1000+</option>
                        </select>
                        <ChevronDown className="absolute right-3 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>

                      {/* Funding Filter */}
                      <div className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-violet-400 dark:hover:border-violet-650 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Globe className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <select
                          value={fundingFilter}
                          onChange={(e) => setFundingFilter(e.target.value)}
                          className="appearance-none bg-transparent w-full focus:outline-none cursor-pointer text-xs font-black pr-2 text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">Funding: All</option>
                          {fundingStages.filter(f => f !== 'All').map(stage => (
                            <option key={stage} value={stage} className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">{stage}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>

                      {/* Geo Filter */}
                      <div className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-violet-400 dark:hover:border-violet-650 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300">
                        <MapPin className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <select
                          value={geoFilter}
                          onChange={(e) => setGeoFilter(e.target.value)}
                          className="appearance-none bg-transparent w-full focus:outline-none cursor-pointer text-xs font-black pr-2 text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">Geo: All</option>
                          <option value="US" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">United States</option>
                          <option value="Europe" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Europe</option>
                          <option value="Canada" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Canada</option>
                          <option value="UK" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">United Kingdom</option>
                          <option value="Asia" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Asia</option>
                        </select>
                        <ChevronDown className="absolute right-3 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>

                      {/* Tech Stack Search */}
                      <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm grow min-w-[140px]">
                        <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 animate-pulse" />
                        <input
                          type="text"
                          value={techStackFilter}
                          onChange={(e) => setTechStackFilter(e.target.value)}
                          placeholder="Tech stack..."
                          className="bg-transparent focus:outline-none text-xs font-bold w-full text-slate-700 dark:text-slate-300 placeholder-slate-400"
                        />
                      </div>

                      {/* Signals Filter */}
                      <div className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-violet-400 dark:hover:border-violet-650 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300">
                        <Zap className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <select
                          value={signalsFilter}
                          onChange={(e) => setSignalsFilter(e.target.value)}
                          className="appearance-none bg-transparent w-full focus:outline-none cursor-pointer text-xs font-black pr-2 text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">Signals: All</option>
                          <option value="Hiring" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Hiring</option>
                          <option value="Funding" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Funding</option>
                          <option value="Expanding" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Expanding</option>
                          <option value="Jobs" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Jobs</option>
                          <option value="Tech" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Tech</option>
                          <option value="Events" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Events</option>
                        </select>
                        <ChevronDown className="absolute right-3 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>

                      {/* Growth Filter */}
                      <div className="relative flex items-center gap-1.5 pl-3 pr-8 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm hover:border-violet-400 dark:hover:border-violet-650 transition-colors text-xs font-bold text-slate-700 dark:text-slate-300">
                        <TrendingUp className="w-3.5 h-3.5 text-violet-500 shrink-0" />
                        <select
                          value={growthFilter}
                          onChange={(e) => setGrowthFilter(e.target.value)}
                          className="appearance-none bg-transparent w-full focus:outline-none cursor-pointer text-xs font-black pr-2 text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-350">Growth: Any</option>
                          <option value="+10%+" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Growth &gt; 10%</option>
                          <option value="+25%+" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Growth &gt; 25%</option>
                          <option value="+50%+" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Growth &gt; 50%</option>
                        </select>
                        <ChevronDown className="absolute right-3 w-3 h-3 text-slate-400 pointer-events-none" />
                      </div>

                    </div>

                    {/* SUB-TAB CONTAINER */}
                    <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-150 dark:border-slate-800/80 pb-3">

                      {/* Recommended Sub-Tab */}
                      <button
                        type="button"
                        onClick={() => setCompanySubTab('Recommended')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${companySubTab === 'Recommended'
                            ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-900/30'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 border border-transparent'
                          }`}
                      >
                        <Star className={`w-3.5 h-3.5 ${companySubTab === 'Recommended' ? 'fill-violet-600 dark:fill-violet-400 text-violet-600 dark:text-violet-400' : ''}`} />
                        <span>Recommended</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${companySubTab === 'Recommended' ? 'bg-violet-200/50 dark:bg-violet-900/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                          {rawLeads.filter(lead => {
                            const k = lead.company_name || lead.name || lead.title
                            return !savedCompanyNames.includes(k) && !excludedCompanyNames.includes(k) && !validLeadNames.includes(k) && !invalidLeadNames.includes(k)
                          }).length}
                        </span>
                      </button>

                      {/* Saved Sub-Tab */}
                      <button
                        type="button"
                        onClick={() => setCompanySubTab('Saved')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${companySubTab === 'Saved'
                            ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-900/30'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 border border-transparent'
                          }`}
                      >
                        <Bookmark className={`w-3.5 h-3.5 ${companySubTab === 'Saved' ? 'fill-violet-600 dark:fill-violet-400 text-violet-600 dark:text-violet-400' : ''}`} />
                        <span>Saved</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${companySubTab === 'Saved' ? 'bg-violet-200/50 dark:bg-violet-900/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                          {savedCompanyNames.length}
                        </span>
                      </button>

                      {/* Excluded Sub-Tab */}
                      <button
                        type="button"
                        onClick={() => setCompanySubTab('Excluded')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${companySubTab === 'Excluded'
                            ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-900/30'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 border border-transparent'
                          }`}
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Excluded</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${companySubTab === 'Excluded' ? 'bg-violet-200/50 dark:bg-violet-900/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                          {excludedCompanyNames.length}
                        </span>
                      </button>

                      {/* Valid Leads Sub-Tab */}
                      <button
                        type="button"
                        onClick={() => setCompanySubTab('Valid')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${companySubTab === 'Valid'
                            ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-900/30'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 border border-transparent'
                          }`}
                      >
                        <ThumbsUp className={`w-3.5 h-3.5 ${companySubTab === 'Valid' ? 'fill-emerald-600 dark:fill-emerald-400 text-emerald-600 dark:text-emerald-400' : ''}`} />
                        <span>Valid</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${companySubTab === 'Valid' ? 'bg-emerald-200/50 dark:bg-emerald-900/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                          {validLeadNames.length}
                        </span>
                      </button>

                      {/* Invalid Leads Sub-Tab */}
                      <button
                        type="button"
                        onClick={() => setCompanySubTab('Invalid')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${companySubTab === 'Invalid'
                            ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-900/30'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 border border-transparent'
                          }`}
                      >
                        <ThumbsDown className={`w-3.5 h-3.5 ${companySubTab === 'Invalid' ? 'fill-rose-600 dark:fill-rose-400 text-rose-600 dark:text-rose-400' : ''}`} />
                        <span>Invalid</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-black ${companySubTab === 'Invalid' ? 'bg-rose-200/50 dark:bg-rose-900/50' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                          }`}>
                          {invalidLeadNames.length}
                        </span>
                      </button>

                      {/* Manual Adds Sub-Tab */}
                      <button
                        type="button"
                        onClick={() => setCompanySubTab('Manual Adds')}
                        className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black transition-all ${companySubTab === 'Manual Adds'
                            ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 border border-violet-100 dark:border-violet-900/30'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-250 border border-transparent'
                          }`}
                      >
                        <User className="w-3.5 h-3.5" />
                        <span>Manual Adds</span>
                      </button>

                    </div>

                    {/* ACTION SUB-HEADER */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">

                      {/* Search box within Action Bar */}
                      <div className="relative max-w-[280px] grow">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          value={companySearch}
                          onChange={(e) => setCompanySearch(e.target.value)}
                          placeholder="Search companies..."
                          className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none"
                        />
                      </div>

                      {/* Right buttons */}
                      <div className="flex items-center gap-2">
                        {/* Export Button */}
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setActiveExportDropdown(activeExportDropdown === 'companies' ? null : 'companies')}
                            className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 rounded-xl shadow-sm text-xs font-extrabold text-slate-650 dark:text-slate-350 transition-all cursor-pointer select-none active:scale-95"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-450" />
                            <span>Export</span>
                            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${activeExportDropdown === 'companies' ? 'rotate-180' : ''}`} />
                          </button>

                          {activeExportDropdown === 'companies' && (
                            <>
                              <div 
                                className="fixed inset-0 z-40 cursor-default" 
                                onClick={() => setActiveExportDropdown(null)} 
                              />
                              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1.5 animate-slide-up">
                                <div className="px-3 py-1 text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">
                                  Choose Format
                                </div>
                                
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setActiveExportDropdown(null);
                                    try {
                                      await api.exportCompanies(requestId, 'csv');
                                    } catch (err) {
                                      console.error("Export failed:", err);
                                      alert("Failed to export CSV.");
                                    }
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                  <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                                  <span>CSV (.csv)</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={async () => {
                                    setActiveExportDropdown(null);
                                    try {
                                      await api.exportCompanies(requestId, 'xlsx');
                                    } catch (err) {
                                      console.error("Export failed:", err);
                                      alert("Failed to export Excel spreadsheet.");
                                    }
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                                  <span>Excel (.xlsx)</span>
                                </button>

                                <button
                                  type="button"
                                  onClick={async () => {
                                    setActiveExportDropdown(null);
                                    try {
                                      await api.exportCompanies(requestId, 'pdf');
                                    } catch (err) {
                                      console.error("Export failed:", err);
                                      alert("Failed to export PDF Report.");
                                    }
                                  }}
                                  className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                >
                                  <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                                  <span>PDF Report (.pdf)</span>
                                </button>
                              </div>
                            </>
                          )}
                        </div>

                        {/* Save View */}
                        <button
                          type="button"
                          className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 rounded-xl shadow-sm text-xs font-extrabold text-slate-650 dark:text-slate-350"
                        >
                          <Bookmark className="w-3.5 h-3.5 text-slate-450" />
                          <span>Save View</span>
                        </button>

                        {/* Sort */}
                        <button
                          type="button"
                          className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-950 rounded-xl shadow-sm text-xs font-extrabold text-slate-650 dark:text-slate-350"
                        >
                          <SlidersHorizontal className="w-3.5 h-3.5 text-slate-450" />
                          <span>Sort</span>
                        </button>

                      </div>

                    </div>

                    {/* Companies Table list */}
                    {companySubTab === 'Manual Adds' ? (
                      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6">
                        <div className="mb-6">
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-4">Add Company Manually</h4>
                          <div className="flex flex-col sm:flex-row gap-4">
                            <input
                              type="text"
                              placeholder="Company Name (Required)"
                              value={newManualCompany.company_name}
                              onChange={e => setNewManualCompany({...newManualCompany, company_name: e.target.value})}
                              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                            />
                            <input
                              type="text"
                              placeholder="Website (Optional)"
                              value={newManualCompany.website}
                              onChange={e => setNewManualCompany({...newManualCompany, website: e.target.value})}
                              className="flex-1 px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-sm font-medium text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
                            />
                            <button
                              onClick={() => {
                                if (!newManualCompany.company_name.trim()) return
                                const next = [...manualAdds, { ...newManualCompany, added_at: new Date().toISOString() }]
                                setManualAdds(next)
                                handleUpdateLists({ manualAdds: next })
                                setNewManualCompany({ company_name: '', website: '' })
                              }}
                              disabled={!newManualCompany.company_name.trim()}
                              className="px-6 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:hover:bg-violet-600 text-white font-bold rounded-xl text-sm transition-all active:scale-[0.98] shadow-sm shadow-violet-200 dark:shadow-none"
                            >
                              Add Company
                            </button>
                          </div>
                        </div>

                        {manualAdds.length > 0 ? (
                          <div className="space-y-3">
                            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Added Companies</div>
                            {manualAdds.map((comp, i) => (
                              <div key={i} className="flex items-center justify-between p-4 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors">
                                <div className="flex items-center gap-4">
                                  <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-900/20 text-violet-600 dark:text-violet-400 flex items-center justify-center shrink-0">
                                    <Building className="w-5 h-5" />
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-800 dark:text-slate-200">{comp.company_name}</div>
                                    {comp.website && (
                                      <a href={comp.website.startsWith('http') ? comp.website : `https://${comp.website}`} target="_blank" rel="noreferrer" className="text-xs font-medium text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 flex items-center gap-1 mt-0.5">
                                        <ExternalLink className="w-3 h-3" />
                                        {comp.website}
                                      </a>
                                    )}
                                  </div>
                                </div>
                                <button
                                  onClick={() => {
                                    const next = manualAdds.filter((_, idx) => idx !== i)
                                    setManualAdds(next)
                                    handleUpdateLists({ manualAdds: next })
                                  }}
                                  className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg transition-colors"
                                  title="Remove"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-center py-10 bg-slate-50/50 dark:bg-slate-950/30 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800">
                            <div className="w-12 h-12 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center mx-auto mb-3 text-slate-400">
                              <Building className="w-6 h-6" />
                            </div>
                            <div className="text-sm font-semibold text-slate-600 dark:text-slate-400">No manually added companies</div>
                            <div className="text-xs text-slate-500 mt-1">Companies you add manually will appear here.</div>
                          </div>
                        )}
                      </div>
                    ) : filteredLeads.length > 0 ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200/80 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/20 shadow-sm">
                        <table className="w-full text-sm text-left">

                          <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-850/80 text-[10px] font-black uppercase tracking-[0.15em] text-slate-450 dark:text-slate-500">
                            <tr>

                              {/* Checkbox selector header */}
                              <th className="px-5 py-4 w-12 text-center">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (selectedCompanyRowIds.length === filteredLeads.length) {
                                      setSelectedCompanyRowIds([])
                                    } else {
                                      setSelectedCompanyRowIds(filteredLeads.map((_, i) => i))
                                    }
                                  }}
                                  className="text-slate-450 hover:text-violet-600 transition-colors inline-block"
                                >
                                  {selectedCompanyRowIds.length === filteredLeads.length ? (
                                    <CheckSquare className="w-4.5 h-4.5 text-violet-600 fill-violet-50 dark:fill-transparent" />
                                  ) : (
                                    <Square className="w-4.5 h-4.5 text-slate-400" />
                                  )}
                                </button>
                              </th>

                              <th className="px-5 py-4">Company</th>
                              <th className="px-5 py-4 text-center">ICP Fit</th>
                              <th className="px-5 py-4">Industry</th>
                              <th className="px-5 py-4 text-center">Emp.</th>
                              <th className="px-5 py-4 text-center">Growth</th>
                              <th className="px-5 py-4">Funding</th>
                              <th className="px-5 py-4 text-center">Tech Stack</th>
                              <th className="px-5 py-4">Signals</th>
                              <th className="px-5 py-4">Intent</th>
                              <th className="px-5 py-4 text-center">Actions</th>

                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-150 dark:divide-slate-850/60 bg-white dark:bg-slate-900/40">
                            {filteredLeads.map((lead, idx) => {
                              const isSelected = selectedCompanyRowIds.includes(idx)
                              const compName = lead.company_name || lead.name || lead.title || 'Unknown Entity'

                              return (
                                <tr
                                  key={lead._originalIndex}
                                  onClick={() => handleCompanyRowClick(lead._originalIndex, lead)}
                                  className={`hover:bg-slate-50/70 dark:hover:bg-slate-950/20 transition-colors cursor-pointer ${isSelected ? 'bg-violet-50/20 dark:bg-violet-950/10' : ''
                                    }`}
                                >

                                  {/* Checkbox column */}
                                  <td className="px-5 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isSelected) {
                                          setSelectedCompanyRowIds(selectedCompanyRowIds.filter(id => id !== idx))
                                        } else {
                                          setSelectedCompanyRowIds([...selectedCompanyRowIds, idx])
                                        }
                                      }}
                                      className="text-slate-450 hover:text-violet-650 transition-colors inline-block"
                                    >
                                      {isSelected ? (
                                        <CheckSquare className="w-4.5 h-4.5 text-violet-600 fill-violet-50 dark:fill-transparent" />
                                      ) : (
                                        <Square className="w-4.5 h-4.5 text-slate-450 dark:text-slate-650" />
                                      )}
                                    </button>
                                  </td>

                                  {/* Company Profile favicon + Name */}
                                  <td className="px-5 py-4">
                                    <div className="flex items-center gap-3">
                                      {lead.url && lead.url !== 'null' ? (
                                        <div className="w-8 h-8 rounded-lg bg-white border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
                                          <img
                                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(lead.url)}&sz=64`}
                                            alt=""
                                            className="w-5.5 h-5.5 object-contain"
                                            onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                                          />
                                        </div>
                                      ) : (
                                        <div className="w-8 h-8 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 font-bold text-xs text-slate-400">
                                          {compName[0].toUpperCase()}
                                        </div>
                                      )}
                                      <div className="min-w-0">
                                        <div className="font-extrabold text-slate-800 dark:text-slate-200 text-xs truncate max-w-[140px]" title={compName}>
                                          {compName}
                                        </div>
                                        <div className="flex items-center gap-1 mt-1.5 flex-wrap max-w-[280px]">
                                          {/* Website */}
                                          {lead.url && lead.url !== 'null' && (
                                            <a
                                              href={lead.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-violet-600 transition-colors flex items-center gap-1"
                                              title={lead.url}
                                            >
                                              <Globe className="w-2.5 h-2.5" /> Web
                                            </a>
                                          )}

                                          {/* LinkedIn */}
                                          {lead.linkedin_url && lead.linkedin_url !== 'null' && (
                                            <a
                                              href={lead.linkedin_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 hover:text-blue-700 transition-colors flex items-center gap-1"
                                              title="LinkedIn Profile"
                                            >
                                              <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.761 0 5-2.239 5-5v-14c0-2.761-2.239-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                                              LinkedIn
                                            </a>
                                          )}

                                          {/* Crunchbase */}
                                          {lead.crunchbase_url && lead.crunchbase_url !== 'null' && (
                                            <a
                                              href={lead.crunchbase_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 hover:text-cyan-700 transition-colors flex items-center gap-1"
                                              title="Crunchbase"
                                            >
                                              CB
                                            </a>
                                          )}

                                          {/* Twitter/X */}
                                          {(lead.x_url || lead.twitter_url) && (lead.x_url !== 'null' && lead.twitter_url !== 'null') && (
                                            <a
                                              href={lead.x_url || lead.twitter_url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              onClick={(e) => e.stopPropagation()}
                                              className="text-[9px] font-black uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:text-slate-900 transition-colors flex items-center gap-1"
                                              title="X / Twitter"
                                            >
                                              <svg className="w-2.5 h-2.5 fill-current" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                              X
                                            </a>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </td>

                                  {/* ICP Fit Match badge */}
                                  <td className="px-5 py-4 text-center">
                                    <span className="inline-block px-2.5 py-1 bg-gradient-to-br from-indigo-50 to-violet-50 dark:from-indigo-950/40 dark:to-violet-950/20 text-[10px] font-black text-violet-750 dark:text-violet-400 rounded-lg border border-violet-100/50 dark:border-violet-900/20">
                                      {lead.match_score} Match
                                    </span>
                                  </td>

                                  {/* Industry */}
                                  <td className="px-5 py-4">
                                    <span className={`text-xs font-bold truncate max-w-[100px] inline-block ${lead.industry ? 'text-slate-600 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'}`}>
                                      {lead.industry || '—'}
                                    </span>
                                  </td>

                                  {/* Employee count estimate */}
                                  <td className="px-5 py-4 text-center">
                                    <span className={`text-xs font-bold ${lead.employee_size_estimate ? 'text-slate-650 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'}`}>
                                      {lead.employee_size_estimate || '—'}
                                    </span>
                                  </td>

                                  {/* Growth metric */}
                                  <td className="px-5 py-4 text-center">
                                    {lead.growth ? (
                                      <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-450">
                                        {lead.growth}
                                      </span>
                                    ) : (
                                      <span className="text-xs font-bold text-slate-300 dark:text-slate-600">—</span>
                                    )}
                                  </td>

                                  {/* Funding Stage */}
                                  <td className="px-5 py-4">
                                    {lead.funding_stage ? (
                                      <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-450 border border-amber-100/50 dark:border-amber-900/20">
                                        {lead.funding_stage}
                                      </span>
                                    ) : (
                                      <span className="text-xs font-bold text-slate-300 dark:text-slate-600">—</span>
                                    )}
                                  </td>

                                  {/* Tech stack tags */}
                                  <td className="px-5 py-4">
                                    {(lead.tech_stack || []).length > 0 ? (
                                      <div className="flex items-center justify-center gap-1 flex-wrap max-w-[130px]">
                                        {lead.tech_stack.slice(0, 2).map((tech, i) => (
                                          <span key={i} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-tighter">
                                            {tech}
                                          </span>
                                        ))}
                                        {lead.tech_stack.length > 2 && (
                                          <span className="text-[9px] font-bold text-slate-455 dark:text-slate-550 shrink-0">
                                            +{lead.tech_stack.length - 2}
                                          </span>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="flex justify-center"><span className="text-xs font-bold text-slate-300 dark:text-slate-600">—</span></div>
                                    )}
                                  </td>

                                  {/* Signals */}
                                  <td className="px-5 py-4">
                                    {(lead.signals || []).length > 0 ? (
                                      <div className="flex items-center gap-1 flex-wrap max-w-[120px]">
                                        {lead.signals.slice(0, 2).map((sig, i) => (
                                          <span key={i} className="px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/20 text-[9px] font-black text-blue-600 dark:text-blue-450">
                                            {sig}
                                          </span>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="text-xs font-bold text-slate-300 dark:text-slate-600">—</span>
                                    )}
                                  </td>

                                  {/* Intent */}
                                  <td className="px-5 py-4">
                                    {lead.intent_score != null ? (
                                      <IntentScoreBadge score={lead.intent_score} band={lead.intent_band} small={true} />
                                    ) : (
                                      <div className="flex items-center gap-1 flex-wrap max-w-[120px]">
                                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[9px] font-black text-slate-500 dark:text-slate-400">
                                          Unanalyzed
                                        </span>
                                      </div>
                                    )}
                                  </td>

                                  {/* Action buttons */}
                                  <td className="px-5 py-4 text-center" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex items-center justify-center gap-1.5">
                                      {/* Mark Valid Button */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (validLeadNames.includes(compName)) {
                                            const nextValid = validLeadNames.filter(n => n !== compName)
                                            setValidLeadNames(nextValid)
                                            handleUpdateLists({ validLeadNames: nextValid })
                                          } else {
                                            const nextValid = [...validLeadNames, compName]
                                            const nextInvalid = invalidLeadNames.filter(n => n !== compName)
                                            const nextSaved = savedCompanyNames.filter(n => n !== compName)
                                            const nextExcluded = excludedCompanyNames.filter(n => n !== compName)
                                            setValidLeadNames(nextValid)
                                            setInvalidLeadNames(nextInvalid)
                                            setSavedCompanyNames(nextSaved)
                                            setExcludedCompanyNames(nextExcluded)
                                            handleUpdateLists({ validLeadNames: nextValid, invalidLeadNames: nextInvalid, savedCompanyNames: nextSaved, excludedCompanyNames: nextExcluded })
                                          }
                                        }}
                                        className={`p-1.5 rounded-lg border transition-all ${validLeadNames.includes(compName)
                                            ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/30 text-emerald-600'
                                            : 'border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 text-slate-400 hover:text-emerald-500'
                                          }`}
                                        title={validLeadNames.includes(compName) ? "Marked Valid" : "Mark as Valid Lead"}
                                      >
                                        <ThumbsUp className="w-3.5 h-3.5" />
                                      </button>

                                      {/* Mark Invalid Button */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (invalidLeadNames.includes(compName)) {
                                            const nextInvalid = invalidLeadNames.filter(n => n !== compName)
                                            setInvalidLeadNames(nextInvalid)
                                            handleUpdateLists({ invalidLeadNames: nextInvalid })
                                          } else {
                                            const nextInvalid = [...invalidLeadNames, compName]
                                            const nextValid = validLeadNames.filter(n => n !== compName)
                                            const nextSaved = savedCompanyNames.filter(n => n !== compName)
                                            const nextExcluded = excludedCompanyNames.filter(n => n !== compName)
                                            setInvalidLeadNames(nextInvalid)
                                            setValidLeadNames(nextValid)
                                            setSavedCompanyNames(nextSaved)
                                            setExcludedCompanyNames(nextExcluded)
                                            handleUpdateLists({ invalidLeadNames: nextInvalid, validLeadNames: nextValid, savedCompanyNames: nextSaved, excludedCompanyNames: nextExcluded })
                                          }
                                        }}
                                        className={`p-1.5 rounded-lg border transition-all ${invalidLeadNames.includes(compName)
                                            ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30 text-rose-600'
                                            : 'border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-500'
                                          }`}
                                        title={invalidLeadNames.includes(compName) ? "Marked Invalid" : "Mark as Invalid Lead"}
                                      >
                                        <ThumbsDown className="w-3.5 h-3.5" />
                                      </button>

                                      {/* Save Button */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (savedCompanyNames.includes(compName)) {
                                            const next = savedCompanyNames.filter(n => n !== compName)
                                            setSavedCompanyNames(next)
                                            handleUpdateLists({ savedCompanyNames: next })
                                          } else {
                                            const nextSaved = [...savedCompanyNames, compName]
                                            const nextExcluded = excludedCompanyNames.filter(n => n !== compName)
                                            setSavedCompanyNames(nextSaved)
                                            setExcludedCompanyNames(nextExcluded)
                                            handleUpdateLists({ savedCompanyNames: nextSaved, excludedCompanyNames: nextExcluded })
                                          }
                                        }}
                                        className={`p-1.5 rounded-lg border transition-all ${savedCompanyNames.includes(compName)
                                            ? 'bg-violet-50 dark:bg-violet-950/20 border-violet-200 dark:border-violet-900/30 text-violet-600'
                                            : 'border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 text-slate-400 hover:text-violet-500'
                                          }`}
                                        title={savedCompanyNames.includes(compName) ? "Saved" : "Save Company"}
                                      >
                                        <Bookmark className="w-3.5 h-3.5" />
                                      </button>

                                      {/* Exclude Button */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (excludedCompanyNames.includes(compName)) {
                                            const next = excludedCompanyNames.filter(n => n !== compName)
                                            setExcludedCompanyNames(next)
                                            handleUpdateLists({ excludedCompanyNames: next })
                                          } else {
                                            const nextExcluded = [...excludedCompanyNames, compName]
                                            const nextSaved = savedCompanyNames.filter(n => n !== compName)
                                            setExcludedCompanyNames(nextExcluded)
                                            setSavedCompanyNames(nextSaved)
                                            handleUpdateLists({ excludedCompanyNames: nextExcluded, savedCompanyNames: nextSaved })
                                          }
                                        }}
                                        className={`p-1.5 rounded-lg border transition-all ${excludedCompanyNames.includes(compName)
                                            ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/30 text-rose-600'
                                            : 'border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 text-slate-400 hover:text-rose-500'
                                          }`}
                                        title={excludedCompanyNames.includes(compName) ? "Excluded" : "Exclude Company"}
                                      >
                                        <Ban className="w-3.5 h-3.5" />
                                      </button>

                                      {/* Add to List Button */}
                                      <div className="relative">
                                        <button
                                          type="button"
                                          onClick={async (e) => {
                                            e.stopPropagation()
                                            if (listPickerOpenFor === idx) {
                                              setListPickerOpenFor(null)
                                              return
                                            }
                                            setListPickerOpenFor(idx)
                                            if (userLists.length === 0) {
                                              setListPickerLoading(true)
                                              try {
                                                const res = await api.getLists()
                                                setUserLists(res.lists || [])
                                              } catch(err) { console.error(err) }
                                              finally { setListPickerLoading(false) }
                                            }
                                          }}
                                          className="p-1.5 rounded-lg border border-slate-100 hover:bg-indigo-50 dark:border-slate-800 dark:hover:bg-indigo-950/20 text-slate-400 hover:text-indigo-600 transition-colors"
                                          title="Add to List"
                                        >
                                          <List className="w-3.5 h-3.5" />
                                        </button>

                                        {listPickerOpenFor === idx && (
                                          <div
                                            className="absolute right-0 bottom-full mb-2 z-50 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-2 animate-fade-in"
                                            onClick={(e) => e.stopPropagation()}
                                          >
                                            <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 mb-1">
                                              Add to List
                                            </p>
                                            {listPickerLoading ? (
                                              <div className="flex justify-center py-3">
                                                <Loader2 className="w-4 h-4 text-indigo-500 animate-spin" />
                                              </div>
                                            ) : userLists.length === 0 ? (
                                              <div className="px-3 py-2 text-xs text-slate-400">
                                                No lists yet.
                                                <a href="/lead-lists" className="text-indigo-500 hover:underline ml-1">Create one →</a>
                                              </div>
                                            ) : (
                                              userLists.map(lst => (
                                                <button
                                                  key={lst._id}
                                                  type="button"
                                                  disabled={addingToList}
                                                  onClick={async () => {
                                                    if (!lead._id && !lead.id) return
                                                    const leadId = lead._id || lead.id
                                                    setAddingToList(true)
                                                    try {
                                                      await api.addLeadsToList(lst._id, [String(leadId)])
                                                      triggerAlert(`Added to "${lst.name}"`, 'Lead Lists', 'info')
                                                    } catch(err) {
                                                      triggerAlert('Failed to add to list.', 'Error', 'error')
                                                    } finally {
                                                      setAddingToList(false)
                                                      setListPickerOpenFor(null)
                                                    }
                                                  }}
                                                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                                                >
                                                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: lst.color || '#6366f1' }} />
                                                  <span className="truncate">{lst.name}</span>
                                                  <span className="ml-auto text-[10px] text-slate-400">{(lst.lead_ids || []).length}</span>
                                                </button>
                                              ))
                                            )}
                                          </div>
                                        )}
                                      </div>

                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedDecisionMakerCompany(compName)
                                          setActiveTab('decision_makers')
                                          fetchDecisionMakers()
                                        }}
                                        className="p-1.5 rounded-lg border border-slate-100 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800 text-slate-400 hover:text-violet-650 dark:hover:text-violet-400 transition-colors"
                                      >
                                        <ChevronRight className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </td>

                                </tr>
                              )
                            })}
                          </tbody>

                        </table>
                      </div>
                    ) : isPipelineRunning ? (
                      <div className="text-center py-20 bg-gradient-to-b from-violet-50/60 to-slate-50/30 dark:from-violet-950/10 dark:to-slate-950/20 rounded-2xl border-2 border-dashed border-violet-200/70 dark:border-violet-900/40">
                        <div className="relative w-16 h-16 mx-auto mb-6">
                          <div className="absolute inset-0 rounded-full border-[3px] border-violet-100 dark:border-violet-900/40" />
                          <div className="absolute inset-0 rounded-full border-[3px] border-violet-500 border-t-transparent animate-spin" />
                          <div className="absolute inset-[5px] rounded-full bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center">
                            <Building className="w-5 h-5 text-violet-500" />
                          </div>
                        </div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Sourcing Companies...</h4>
                        <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1.5 font-medium">
                          Your AI pipeline is actively analyzing and scoring companies against your ICP. Results will appear here once sourcing completes.
                        </p>
                        <div className="flex items-center justify-center gap-1.5 mt-5">
                          <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-20 bg-slate-50/50 dark:bg-slate-950/30 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                        <Inbox className="w-10 h-10 text-slate-350 dark:text-slate-650 mx-auto mb-4" />
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-300">No matching target companies</h4>
                        <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1 font-medium">Refine your search parameters or query filters to expand pipeline discovery.</p>
                      </div>
                    )}

                    {showCompanyDetails && companyDetailsLead && (
                      <div className="fixed inset-0 z-[110] bg-slate-900/70 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                        <div className="relative w-full max-w-4xl max-h-[90vh] overflow-hidden rounded-3xl border border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-br from-white to-slate-50 dark:from-slate-950 dark:to-slate-900 shadow-2xl flex flex-col">
                          {/* Header */}
                          <div className="flex items-start justify-between gap-4 px-8 py-6 border-b border-slate-200/50 dark:border-slate-800/50 bg-gradient-to-r from-white to-slate-50/50 dark:from-slate-950 dark:to-slate-900/80">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <div className="w-10 h-10 rounded-2xl bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center shrink-0">
                                  <Building className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                                </div>
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-violet-600 dark:text-violet-400">Company Profile</div>
                              </div>
                              <h3 className="text-2xl md:text-3xl font-black text-slate-950 dark:text-white truncate">
                                {companyDetailsLead.company_name || companyDetailsLead.name || companyDetailsLead.title || 'Unknown Company'}
                              </h3>
                              <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                                {companyDetailsLead.industry || 'Industry information not available'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => setShowCompanyDetails(false)}
                              className="rounded-full p-2.5 text-slate-500 hover:bg-slate-200 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white transition shrink-0"
                              aria-label="Close company details"
                            >
                              <X className="w-6 h-6" />
                            </button>
                          </div>

                          {/* Content */}
                          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6 px-8 py-6">
                            {/* Key Metrics Grid */}
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                              <div className="rounded-2xl bg-gradient-to-br from-indigo-50 to-indigo-50/50 dark:from-indigo-950/30 dark:to-indigo-950/10 p-4 border border-indigo-200/50 dark:border-indigo-800/30">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-600 dark:text-indigo-400 mb-2">ICP Fit</div>
                                <div className="text-2xl font-black text-slate-900 dark:text-white">{companyDetailsLead.match_score || '—'}</div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Match Score</p>
                              </div>
                              <div className="rounded-2xl bg-gradient-to-br from-blue-50 to-blue-50/50 dark:from-blue-950/30 dark:to-blue-950/10 p-4 border border-blue-200/50 dark:border-blue-800/30">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600 dark:text-blue-400 mb-2">Employees</div>
                                <div className="text-2xl font-black text-slate-900 dark:text-white">{companyDetailsLead.employee_size_estimate || '—'}</div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Team Size</p>
                              </div>
                              <div className="rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-50/50 dark:from-emerald-950/30 dark:to-emerald-950/10 p-4 border border-emerald-200/50 dark:border-emerald-800/30">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-emerald-600 dark:text-emerald-400 mb-2">Growth</div>
                                <div className="text-2xl font-black text-slate-900 dark:text-white">{companyDetailsLead.growth || '—'}</div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">YoY Growth</p>
                              </div>
                              <div className="rounded-2xl bg-gradient-to-br from-amber-50 to-amber-50/50 dark:from-amber-950/30 dark:to-amber-950/10 p-4 border border-amber-200/50 dark:border-amber-800/30">
                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-amber-600 dark:text-amber-400 mb-2">Funding</div>
                                <div className="text-2xl font-black text-slate-900 dark:text-white truncate">{companyDetailsLead.funding_stage || '—'}</div>
                                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">Stage</p>
                              </div>
                            </div>

                            {/* Location & Source */}
                            <div className="grid gap-4 sm:grid-cols-2">
                              <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/50 p-5">
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                                  <MapPin className="w-3.5 h-3.5" /> Location
                                </div>
                                <p className={`text-sm font-bold ${companyDetailsLead.location ? 'text-slate-800 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600'}`}>{companyDetailsLead.location || '—'}</p>
                              </div>
                              <div className="rounded-2xl bg-slate-100 dark:bg-slate-800/50 p-5">
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                                  <Globe className="w-3.5 h-3.5" /> Source
                                </div>
                                <p className={`text-sm font-bold truncate ${companyDetailsLead.source_url ? 'text-slate-800 dark:text-slate-200' : 'text-slate-300 dark:text-slate-600'}`} title={companyDetailsLead.source_url}>{companyDetailsLead.source_url || '—'}</p>
                              </div>
                            </div>

                            {/* Links Section */}
                            {(companyDetailsLead.url || companyDetailsLead.linkedin_url || companyDetailsLead.crunchbase_url || companyDetailsLead.x_url || companyDetailsLead.twitter_url) && (
                              <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                                  <ExternalLink className="w-3.5 h-3.5" /> External Links
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {companyDetailsLead.url && (
                                    <a href={companyDetailsLead.url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-slate-100 dark:bg-slate-800/50 px-4 py-3 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition group">
                                      <Globe className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-200 shrink-0" />
                                      <span className="text-sm font-bold truncate">Website</span>
                                    </a>
                                  )}
                                  {companyDetailsLead.linkedin_url && (
                                    <a href={companyDetailsLead.linkedin_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-blue-50 dark:bg-blue-950/30 px-4 py-3 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition group">
                                      <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.761 0 5-2.239 5-5v-14c0-2.761-2.239-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                                      <span className="text-sm font-bold truncate">LinkedIn</span>
                                    </a>
                                  )}
                                  {companyDetailsLead.crunchbase_url && (
                                    <a href={companyDetailsLead.crunchbase_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-cyan-50 dark:bg-cyan-950/30 px-4 py-3 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/50 transition group">
                                      <span className="text-xs font-black shrink-0">CB</span>
                                      <span className="text-sm font-bold truncate">Crunchbase</span>
                                    </a>
                                  )}
                                  {(companyDetailsLead.x_url || companyDetailsLead.twitter_url) && (
                                    <a href={companyDetailsLead.x_url || companyDetailsLead.twitter_url} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-2xl bg-slate-100 dark:bg-slate-800/50 px-4 py-3 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition group">
                                      <svg className="w-4 h-4 fill-current shrink-0" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" /></svg>
                                      <span className="text-sm font-bold truncate">Social</span>
                                    </a>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Email Verification */}
                            {companyDetailsLead.email && (
                              <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                                  <Mail className="w-3.5 h-3.5" /> Contact Email
                                </div>
                                <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300 flex-1 truncate">{companyDetailsLead.email}</span>
                                  {companyDetailsLead.email_verified !== undefined && companyDetailsLead.email_verified !== null ? (
                                    companyDetailsLead.email_verified ? (
                                      <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${companyDetailsLead.email_confidence === 'high' ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400' : 'bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400'}`}>
                                        <Check className="w-3 h-3" />
                                        {companyDetailsLead.email_confidence === 'high' ? 'Verified' : 'Likely Valid'}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400">
                                        <X className="w-3 h-3" /> Invalid
                                      </span>
                                    )
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (!companyDetailsLead._id && !companyDetailsLead.id) return
                                        const leadId = companyDetailsLead._id || companyDetailsLead.id
                                        try {
                                          const res = await api.verifyAndSaveLeadEmail(String(leadId))
                                          setCompanyDetailsLead(prev => ({ ...prev, email_verified: res.verified, email_confidence: res.confidence }))
                                        } catch(err) { console.error(err) }
                                      }}
                                      className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 hover:bg-indigo-100 transition"
                                    >
                                      <MailCheck className="w-3.5 h-3.5" /> Verify Email
                                    </button>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Tech Stack */}
                            <div>
                              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                                <Sparkles className="w-3.5 h-3.5" /> Technology Stack
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {Array.isArray(companyDetailsLead.tech_stack) && companyDetailsLead.tech_stack.length > 0 ? (
                                  companyDetailsLead.tech_stack.map((tech, i) => (
                                    <span key={i} className="inline-block rounded-full bg-slate-900 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white dark:bg-slate-700">
                                      {tech}
                                    </span>
                                  ))
                                ) : (
                                  <>
                                    <span className="inline-block rounded-full bg-slate-900 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white dark:bg-slate-700">AWS</span>
                                    <span className="inline-block rounded-full bg-slate-900 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white dark:bg-slate-700">Mixpanel</span>
                                    <span className="inline-block rounded-full bg-slate-900 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white dark:bg-slate-700">Google Analytics</span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Signals */}
                            <div>
                              <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
                                <Zap className="w-3.5 h-3.5" /> Growth Signals
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {Array.isArray(companyDetailsLead.signals) && companyDetailsLead.signals.length > 0 ? (
                                  companyDetailsLead.signals.map((signal, i) => (
                                    <span key={i} className="inline-block rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white">
                                      {signal}
                                    </span>
                                  ))
                                ) : (
                                  <>
                                    <span className="inline-block rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white">Hiring</span>
                                    <span className="inline-block rounded-full bg-gradient-to-r from-blue-500 to-blue-600 px-4 py-1.5 text-xs font-black uppercase tracking-[0.12em] text-white">Expansion</span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Intent Analysis Panel */}
                            <div className="mt-8 pt-8 border-t border-slate-200 dark:border-slate-800">
                              <IntentPanel
                                lead={companyDetailsLead}
                                requestId={id}
                                leadIndex={companyDetailsIndex}
                                onUpdate={(newIntentData) => {
                                  if (companyDetailsIndex !== null && companyDetailsIndex >= 0) {
                                    Object.assign(rawLeads[companyDetailsIndex], newIntentData)
                                    setCompanyDetailsLead({ ...rawLeads[companyDetailsIndex] })
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* STICKY FOOTER ACTION ROW */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-950 border border-slate-200/60 dark:border-slate-800/80 rounded-2xl mt-4 select-none">
                      <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                        {selectedCompanyRowIds.length === 0
                          ? 'No companies selected'
                          : `${selectedCompanyRowIds.length} compan${selectedCompanyRowIds.length === 1 ? 'y' : 'ies'} selected`}
                      </span>
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Bulk Mark Valid */}
                        <button
                          type="button"
                          disabled={selectedCompanyRowIds.length === 0}
                          onClick={() => {
                            const selectedNames = filteredLeads
                              .filter((_, i) => selectedCompanyRowIds.includes(i))
                              .map(l => l.company_name || l.name || l.title)
                            const nextValid = [...new Set([...validLeadNames, ...selectedNames])]
                            const nextInvalid = invalidLeadNames.filter(n => !selectedNames.includes(n))
                            const nextSaved = savedCompanyNames.filter(n => !selectedNames.includes(n))
                            const nextExcluded = excludedCompanyNames.filter(n => !selectedNames.includes(n))
                            setValidLeadNames(nextValid)
                            setInvalidLeadNames(nextInvalid)
                            setSavedCompanyNames(nextSaved)
                            setExcludedCompanyNames(nextExcluded)
                            handleUpdateLists({ validLeadNames: nextValid, invalidLeadNames: nextInvalid, savedCompanyNames: nextSaved, excludedCompanyNames: nextExcluded })
                            setSelectedCompanyRowIds([])
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-extrabold shadow-sm transition-all"
                        >
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Mark Valid</span>
                        </button>

                        {/* Bulk Mark Invalid */}
                        <button
                          type="button"
                          disabled={selectedCompanyRowIds.length === 0}
                          onClick={() => {
                            const selectedNames = filteredLeads
                              .filter((_, i) => selectedCompanyRowIds.includes(i))
                              .map(l => l.company_name || l.name || l.title)
                            const nextInvalid = [...new Set([...invalidLeadNames, ...selectedNames])]
                            const nextValid = validLeadNames.filter(n => !selectedNames.includes(n))
                            const nextSaved = savedCompanyNames.filter(n => !selectedNames.includes(n))
                            const nextExcluded = excludedCompanyNames.filter(n => !selectedNames.includes(n))
                            setInvalidLeadNames(nextInvalid)
                            setValidLeadNames(nextValid)
                            setSavedCompanyNames(nextSaved)
                            setExcludedCompanyNames(nextExcluded)
                            handleUpdateLists({ invalidLeadNames: nextInvalid, validLeadNames: nextValid, savedCompanyNames: nextSaved, excludedCompanyNames: nextExcluded })
                            setSelectedCompanyRowIds([])
                          }}
                          className="flex items-center gap-1.5 px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-extrabold shadow-sm transition-all"
                        >
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>Mark Invalid</span>
                        </button>

                        {/* Bulk Add to List */}
                        <div className="relative">
                          <button
                            type="button"
                            disabled={selectedCompanyRowIds.length === 0}
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (userLists.length === 0) {
                                setListPickerLoading(true)
                                try {
                                  const res = await api.getLists()
                                  setUserLists(res.lists || [])
                                } catch(err) { console.error(err) }
                                finally { setListPickerLoading(false) }
                              }
                              setListPickerOpenFor('bulk')
                            }}
                            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-extrabold shadow-sm transition-all"
                          >
                            <List className="w-3.5 h-3.5" />
                            <span>Add to List</span>
                          </button>
                          {listPickerOpenFor === 'bulk' && (
                            <div className="absolute bottom-full mb-2 left-0 z-50 w-52 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-2 animate-fade-in" onClick={(e) => e.stopPropagation()}>
                              <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800 mb-1">Add Selected to List</p>
                              {listPickerLoading ? (
                                <div className="flex justify-center py-3"><Loader2 className="w-4 h-4 text-indigo-500 animate-spin" /></div>
                              ) : userLists.length === 0 ? (
                                <div className="px-3 py-2 text-xs text-slate-400">No lists. <a href="/lead-lists" className="text-indigo-500 hover:underline">Create one →</a></div>
                              ) : (
                                userLists.map(lst => (
                                  <button key={lst._id} type="button" disabled={addingToList}
                                    onClick={async () => {
                                      const selectedLeads = filteredLeads.filter((_, i) => selectedCompanyRowIds.includes(i))
                                      const leadIds = selectedLeads.map(l => String(l._id || l.id)).filter(Boolean)
                                      if (!leadIds.length) return
                                      setAddingToList(true)
                                      try {
                                        await api.addLeadsToList(lst._id, leadIds)
                                        triggerAlert(`Added ${leadIds.length} leads to "${lst.name}"`, 'Lead Lists', 'info')
                                      } catch(err) { triggerAlert('Failed to add to list.', 'Error', 'error') }
                                      finally { setAddingToList(false); setListPickerOpenFor(null) }
                                    }}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors"
                                  >
                                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: lst.color || '#6366f1' }} />
                                    <span className="truncate">{lst.name}</span>
                                    <span className="ml-auto text-[10px] text-slate-400">{(lst.lead_ids || []).length}</span>
                                  </button>
                                ))
                              )}
                            </div>
                          )}
                        </div>

                        {/* Source Decision Makers */}
                        <button
                          type="button"
                          onClick={() => {
                            if (selectedCompanyRowIds.length > 0) {
                              const chosen = filteredLeads.find((_, i) => selectedCompanyRowIds.includes(i))
                              if (chosen) setSelectedDecisionMakerCompany(chosen.company_name || chosen.name || chosen.title)
                            } else {
                              if (filteredLeads.length > 0) {
                                setSelectedDecisionMakerCompany(filteredLeads[0].company_name || filteredLeads[0].name || filteredLeads[0].title)
                              }
                            }
                            setActiveTab('decision_makers')
                            fetchDecisionMakers()
                          }}
                          className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-750 text-white rounded-xl text-xs font-extrabold shadow-sm transition-all"
                        >
                          <span>Source Decision Makers</span>
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                  </div>
                )}

                {/* 2. COMPETITORS TAB — ICP flow only */}
                {!isDirect && activeTab === 'competitors' && (
                  <div className="grid grid-cols-1 xl:grid-cols-[240px_1fr] gap-6 items-start animate-fade-in">

                    {/* Side Filter Panel */}
                    <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-xl shadow-slate-100/50 dark:shadow-none space-y-6">

                      <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800/80">
                        <span className="text-xs font-black uppercase text-slate-850 dark:text-white tracking-widest flex items-center gap-2">
                          <Filter className="w-3.5 h-3.5 text-slate-450" />
                          Filters
                        </span>
                        {(compDeployment !== 'All' || compPricing !== 'All' || compFunding !== 'All' || compGeo !== 'All' || compSize !== 'All' || compRating !== 'All' || compOverlap > 0) && (
                          <button
                            type="button"
                            onClick={() => {
                              setCompDeployment('All')
                              setCompPricing('All')
                              setCompFunding('All')
                              setCompGeo('All')
                              setCompSize('All')
                              setCompRating('All')
                              setCompOverlap(0)
                            }}
                            className="text-[10px] font-black text-rose-500 hover:underline"
                          >
                            Clear
                          </button>
                        )}
                      </div>

                      {/* Overlap Score Slider */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 tracking-wider">Overlap Score ({compOverlap}%+)</label>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={compOverlap}
                          onChange={(e) => setCompOverlap(parseInt(e.target.value))}
                          className="w-full accent-violet-600 bg-slate-100 dark:bg-slate-800 rounded-lg cursor-pointer h-1.5"
                        />
                      </div>

                      {/* Deployment Model */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">Deployment Model</label>
                        <div className="relative flex items-center w-full">
                          <select
                            value={compDeployment}
                            onChange={(e) => setCompDeployment(e.target.value)}
                            className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">All Deployments</option>
                            <option value="SaaS" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">SaaS</option>
                            <option value="Hybrid" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Hybrid</option>
                            <option value="On-Premise" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">On-Premise</option>
                          </select>
                          <ChevronDown className="absolute right-3.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Pricing Model */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">Pricing Model</label>
                        <div className="relative flex items-center w-full">
                          <select
                            value={compPricing}
                            onChange={(e) => setCompPricing(e.target.value)}
                            className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">All Pricing</option>
                            <option value="Usage" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Usage-Based</option>
                            <option value="Seat" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seat-Based</option>
                            <option value="Flat" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Flat Rate</option>
                            <option value="Freemium" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Freemium</option>
                          </select>
                          <ChevronDown className="absolute right-3.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Funding Stage */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">Funding Stage</label>
                        <div className="relative flex items-center w-full">
                          <select
                            value={compFunding}
                            onChange={(e) => setCompFunding(e.target.value)}
                            className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">All Stages</option>
                            <option value="Seed" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seed</option>
                            <option value="Series A" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Series A</option>
                            <option value="Series B" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Series B</option>
                            <option value="Series C" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Series C</option>
                            <option value="Series D" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Series D</option>
                            <option value="Public" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Public</option>
                            <option value="Bootstrapped" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Bootstrapped</option>
                          </select>
                          <ChevronDown className="absolute right-3.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Geography */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">Geography</label>
                        <div className="relative flex items-center w-full">
                          <select
                            value={compGeo}
                            onChange={(e) => setCompGeo(e.target.value)}
                            className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">All Locations</option>
                            <option value="New York" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">New York</option>
                            <option value="San Francisco" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">San Francisco</option>
                            <option value="Seattle" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seattle</option>
                            <option value="London" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">London</option>
                          </select>
                          <ChevronDown className="absolute right-3.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Company Size */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">Company Size</label>
                        <div className="relative flex items-center w-full">
                          <select
                            value={compSize}
                            onChange={(e) => setCompSize(e.target.value)}
                            className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">All Sizes</option>
                            <option value="10-50" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">10-50 employees</option>
                            <option value="50-200" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">50-200 employees</option>
                            <option value="200+" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">200+ employees</option>
                          </select>
                          <ChevronDown className="absolute right-3.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                      {/* Review Rating */}
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-500 tracking-wider">G2 Review Rating</label>
                        <div className="relative flex items-center w-full">
                          <select
                            value={compRating}
                            onChange={(e) => setCompRating(e.target.value)}
                            className="appearance-none w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none text-slate-700 dark:text-slate-300 cursor-pointer"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">All Ratings</option>
                            <option value="4.0" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">4.0+ Stars</option>
                            <option value="4.5" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">4.5+ Stars</option>
                          </select>
                          <ChevronDown className="absolute right-3.5 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>
                      </div>

                    </div>

                    {/* Competitor Listing Panel */}
                    <div className="space-y-6">

                      {/* Search & Tabs */}
                      <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-xl shadow-slate-100/50 dark:shadow-none space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div>
                            <h2 className="text-xl font-black text-slate-850 dark:text-white tracking-tight">Competitor Intelligence</h2>
                            <p className="text-[10px] text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mt-0.5">Synthesized Competitor Ecosystem</p>
                          </div>

                          {/* Search Input and Export */}
                          <div className="flex items-center gap-2 self-start md:self-auto">
                            <div className="relative min-w-[200px]">
                              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                              <input
                                type="text"
                                value={competitorSearch}
                                onChange={(e) => setCompetitorSearch(e.target.value)}
                                placeholder="Search competitors..."
                                className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold focus:outline-none focus:border-violet-500 focus:bg-white"
                              />
                            </div>
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setActiveExportDropdown(activeExportDropdown === 'competitors' ? null : 'competitors')}
                                className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-955 rounded-xl shadow-sm text-xs font-extrabold text-slate-650 dark:text-slate-350 transition-all cursor-pointer select-none active:scale-95"
                              >
                                <Download className="w-3.5 h-3.5 text-slate-450" />
                                <span>Export</span>
                                <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${activeExportDropdown === 'competitors' ? 'rotate-180' : ''}`} />
                              </button>

                              {activeExportDropdown === 'competitors' && (
                                <>
                                  <div 
                                    className="fixed inset-0 z-40 cursor-default" 
                                    onClick={() => setActiveExportDropdown(null)} 
                                  />
                                  <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1.5 animate-slide-up">
                                    <div className="px-3 py-1 text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">
                                      Choose Format
                                    </div>
                                    
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setActiveExportDropdown(null);
                                        try {
                                          await api.exportCompetitors(requestId, 'csv');
                                        } catch (err) {
                                          console.error("Export failed:", err);
                                          alert("Failed to export CSV.");
                                        }
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                    >
                                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                                      <span>CSV (.csv)</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setActiveExportDropdown(null);
                                        try {
                                          await api.exportCompetitors(requestId, 'xlsx');
                                        } catch (err) {
                                          console.error("Export failed:", err);
                                          alert("Failed to export Excel spreadsheet.");
                                        }
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                    >
                                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                                      <span>Excel (.xlsx)</span>
                                    </button>

                                    <button
                                      type="button"
                                      onClick={async () => {
                                        setActiveExportDropdown(null);
                                        try {
                                          await api.exportCompetitors(requestId, 'pdf');
                                        } catch (err) {
                                          console.error("Export failed:", err);
                                          alert("Failed to export PDF Report.");
                                        }
                                      }}
                                      className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                                    >
                                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                                      <span>PDF Report (.pdf)</span>
                                    </button>
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Category Tab Pills */}
                        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 dark:border-slate-800/80 pb-2">
                          {[
                            { id: 'All', label: `All Competitors (${rawCompetitors.length})` },
                            { id: 'Direct', label: 'Direct Competitors' },
                            { id: 'Adjacent', label: 'Adjacent Competitors' },
                            { id: 'DIY', label: 'DIY / Build Alternatives' }
                          ].map(tab => {
                            const isActive = activeCompetitorTab === tab.id
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveCompetitorTab(tab.id)}
                                className={`px-3.5 py-1.5 rounded-lg text-xs font-black transition-all border ${isActive
                                    ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-400 border-violet-100/50 dark:border-violet-900/30 shadow-sm'
                                    : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                                  }`}
                              >
                                {tab.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      {/* Pipeline Running Banner */}
                      {isPipelineRunning && (
                        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl">
                          <div className="relative shrink-0 w-2.5 h-2.5">
                            <div className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-75" />
                            <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-black text-amber-700 dark:text-amber-400">Pipeline Running</span>
                            <span className="text-xs text-amber-600/80 dark:text-amber-500/80 ml-2 font-semibold">Mapping competitor ecosystem — results will appear as analysis completes</span>
                          </div>
                          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                        </div>
                      )}

                      {/* Competitor Cards */}
                      {filteredCompetitors.length > 0 ? (
                        <div className="space-y-3">
                          {filteredCompetitors.map((comp, idx) => {
                            const isSelected = selectedCompareList.some(c => c.name === comp.name)
                            const specialtyTags = comp.specialties !== '--'
                              ? comp.specialties.split(', ').filter(Boolean).slice(0, 5)
                              : []
                            const toggleSelect = () => {
                              if (isSelected) {
                                setSelectedCompareList(selectedCompareList.filter(c => c.name !== comp.name))
                              } else {
                                if (selectedCompareList.length >= 3) {
                                  triggerAlert("You can compare up to 3 competitors side-by-side.", "Comparison Limit", "warning")
                                  return
                                }
                                setSelectedCompareList([...selectedCompareList, comp])
                                setShowCompareDrawer(true)
                              }
                            }

                            return (
                              <div
                                key={idx}
                                className={`bg-white dark:bg-slate-900 border rounded-2xl p-5 shadow-sm transition-all duration-200 ${
                                  isSelected
                                    ? 'border-violet-300 dark:border-violet-700/60 shadow-violet-100/50 dark:shadow-none'
                                    : 'border-slate-200/70 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:shadow-md'
                                }`}
                              >
                                <div className="flex items-start gap-3.5">

                                  {/* Checkbox */}
                                  <button
                                    type="button"
                                    onClick={toggleSelect}
                                    className="mt-0.5 shrink-0 text-slate-400 hover:text-violet-600 transition-colors"
                                  >
                                    {isSelected
                                      ? <CheckSquare className="w-4 h-4 text-violet-600 fill-violet-50 dark:fill-transparent" />
                                      : <Square className="w-4 h-4" />
                                    }
                                  </button>

                                  {/* Card body */}
                                  <div className="flex-1 min-w-0 space-y-3">

                                    {/* Row 1 — logo · name · tier · links · compare btn */}
                                    <div className="flex items-start justify-between gap-3">
                                      <div className="flex items-center gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-white border border-slate-200/80 dark:border-slate-800 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
                                          <img
                                            src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(comp.website !== '--' ? comp.website : 'example.com')}&sz=64`}
                                            alt=""
                                            className="w-5 h-5 object-contain"
                                            onError={(e) => { e.target.parentElement.style.display = 'none' }}
                                          />
                                        </div>
                                        <div>
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <span className="text-sm font-black text-slate-850 dark:text-white">{comp.name}</span>
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                                              comp.tier === 'Direct'
                                                ? 'bg-rose-50 dark:bg-rose-950/20 text-rose-600 border border-rose-100/50 dark:border-rose-900/10'
                                                : comp.tier === 'Adjacent'
                                                  ? 'bg-sky-50 dark:bg-sky-950/20 text-sky-600 border border-sky-100/50 dark:border-sky-900/10'
                                                  : 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 border border-amber-100/50 dark:border-amber-900/10'
                                            }`}>{comp.tier}</span>
                                          </div>
                                          <div className="flex items-center gap-2.5 mt-0.5">
                                            {comp.website !== '--' && (
                                              <a
                                                href={comp.website}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-[10px] text-slate-400 hover:text-violet-500 transition-colors"
                                              >
                                                {comp.website.replace(/^https?:\/\/(www\.)?/, '')}
                                              </a>
                                            )}
                                            {comp.linkedin_url !== '--' && (
                                              <a
                                                href={comp.linkedin_url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                onClick={(e) => e.stopPropagation()}
                                                className="text-[9px] font-bold text-blue-500 hover:text-blue-700 flex items-center gap-0.5"
                                              >
                                                <svg className="w-2.5 h-2.5 fill-current shrink-0" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.761 0 5-2.239 5-5v-14c0-2.761-2.239-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                                                LinkedIn
                                              </a>
                                            )}
                                          </div>
                                        </div>
                                      </div>

                                      <button
                                        type="button"
                                        onClick={toggleSelect}
                                        className={`shrink-0 px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wide transition-all border ${
                                          isSelected
                                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white border-transparent shadow-sm'
                                            : 'bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-violet-300 dark:hover:border-violet-700'
                                        }`}
                                      >
                                        {isSelected ? '✓ Added' : 'Compare'}
                                      </button>
                                    </div>

                                    {/* Row 2 — metadata chips */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                                      {comp.headquarters !== '--' && (
                                        <span className="flex items-center gap-1">
                                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                                          {comp.headquarters}
                                        </span>
                                      )}
                                      {comp.employee_count !== '--' && (
                                        <span className="flex items-center gap-1">
                                          <Users className="w-3 h-3 text-slate-400 shrink-0" />
                                          {comp.employee_count}
                                        </span>
                                      )}
                                      {comp.industry !== '--' && (
                                        <span className="flex items-center gap-1">
                                          <Building className="w-3 h-3 text-slate-400 shrink-0" />
                                          {comp.industry}
                                        </span>
                                      )}
                                      {comp.company_type !== '--' && (
                                        <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-100/50 dark:border-amber-900/20 font-bold text-[9px] uppercase">
                                          {comp.company_type}
                                        </span>
                                      )}
                                      {comp.founded && comp.founded !== '--' && (
                                        <span className="font-semibold">Est. {comp.founded}</span>
                                      )}
                                    </div>

                                    {/* Row 3 — description */}
                                    {comp.description !== '--' && (
                                      <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed font-medium line-clamp-2">
                                        {comp.description}
                                      </p>
                                    )}

                                    {/* Row 4 — overlap bar + ratings */}
                                    <div className="flex items-center gap-5 flex-wrap">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider whitespace-nowrap">Overlap</span>
                                        <div className="w-24 bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                          <div
                                            className="bg-violet-500 h-1.5 rounded-full transition-all"
                                            style={{ width: `${comp.overlap_score}%` }}
                                          />
                                        </div>
                                        <span className="text-xs font-black text-violet-600 dark:text-violet-400">{comp.overlap_score}%</span>
                                      </div>

                                      {comp.g2_rating !== '--' && (
                                        <div className="flex items-center gap-1">
                                          <Star className="w-3 h-3 fill-amber-400 text-amber-400 shrink-0" />
                                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{comp.g2_rating}</span>
                                          <span className="text-[9px] text-slate-400">G2</span>
                                        </div>
                                      )}
                                      {comp.capterra_rating !== '--' && (
                                        <div className="flex items-center gap-1">
                                          <Star className="w-3 h-3 fill-blue-400 text-blue-400 shrink-0" />
                                          <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300">{comp.capterra_rating}</span>
                                          <span className="text-[9px] text-slate-400">Capterra</span>
                                        </div>
                                      )}
                                    </div>

                                    {/* Row 5 — specialty tags */}
                                    {specialtyTags.length > 0 && (
                                      <div className="flex flex-wrap gap-1">
                                        {specialtyTags.map((tag, i) => (
                                          <span key={i} className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-[9px] font-bold text-slate-500 dark:text-slate-400 rounded-md">
                                            {tag}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                  </div>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : isPipelineRunning ? (
                        <div className="text-center py-20 bg-gradient-to-b from-violet-50/60 to-slate-50/30 dark:from-violet-950/10 dark:to-slate-950/20 rounded-3xl border-2 border-dashed border-violet-200/70 dark:border-violet-900/40">
                          <div className="relative w-16 h-16 mx-auto mb-6">
                            <div className="absolute inset-0 rounded-full border-[3px] border-violet-100 dark:border-violet-900/40" />
                            <div className="absolute inset-0 rounded-full border-[3px] border-violet-500 border-t-transparent animate-spin" />
                            <div className="absolute inset-[5px] rounded-full bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center">
                              <Compass className="w-5 h-5 text-violet-500" />
                            </div>
                          </div>
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Mapping Competitors...</h4>
                          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1.5 font-medium">
                            Your AI pipeline is actively identifying and classifying competitors. Results will populate once the ecosystem analysis finishes.
                          </p>
                          <div className="flex items-center justify-center gap-1.5 mt-5">
                            <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </div>
                        </div>
                      ) : (
                        <div className="text-center py-20 bg-white dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
                          <Inbox className="w-10 h-10 text-slate-350 dark:text-slate-650 mx-auto mb-4" />
                          <h4 className="text-sm font-bold text-slate-800 dark:text-slate-300">No matching competitors discovered</h4>
                          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1 font-medium">Clear search filters or query parameters to expand dorking discovery.</p>
                        </div>
                      )}

                    </div>

                  </div>
                )}
                {/* 3. DECISION MAKERS TAB */}
                {activeTab === 'decision_makers' && (
                  <div className="space-y-6 animate-fade-in">

                    {/* Top Title Bar */}
                    <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
                      <div>
                        <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Decision Maker Sourcing</h1>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-semibold">
                          Identify and enrich high-intent buyers and influencers across your selected accounts · {Object.keys(dmDataMap).length > 0 ? Object.values(dmDataMap).reduce((acc, dms) => acc + dms.length, 0) : rawLeads.reduce((acc, lead) => acc + (lead.decision_makers?.length || 0), 0)} contacts across {rawLeads.length} companies
                        </p>
                      </div>
                    </div>

                    {/* Pipeline Running Banner */}
                    {isPipelineRunning && (
                      <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 rounded-2xl">
                        <div className="relative shrink-0 w-2.5 h-2.5">
                          <div className="absolute inset-0 rounded-full bg-amber-500 animate-ping opacity-75" />
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-black text-amber-700 dark:text-amber-400">Pipeline Running</span>
                          <span className="text-xs text-amber-600/80 dark:text-amber-500/80 ml-2 font-semibold">Enriching decision maker contacts — results will appear as analysis completes</span>
                        </div>
                        <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                      </div>
                    )}

                    {/* Toolbar Row */}
                    <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50/50 dark:bg-slate-950/20 p-4 rounded-2xl border border-slate-150 dark:border-slate-850">
                      {/* Left part: active company dropdown selector */}
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="relative">
                          <button
                            type="button"
                            className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl px-4 py-2.5 text-xs font-black text-slate-800 dark:text-slate-200 flex items-center gap-2 shadow-sm"
                          >
                            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span>
                            {selectedDecisionMakerCompany || 'Select Company'}
                            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                          </button>
                        </div>

                        {/* Navigation Arrows */}
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const idx = rawLeads.findIndex(l => (l.company_name || l.name || l.title) === selectedDecisionMakerCompany)
                              if (idx > 0) {
                                const prev = rawLeads[idx - 1]
                                setSelectedDecisionMakerCompany(prev.company_name || prev.name || prev.title)
                              }
                            }}
                            disabled={rawLeads.findIndex(l => (l.company_name || l.name || l.title) === selectedDecisionMakerCompany) <= 0}
                            className="p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50"
                          >
                            <ChevronRight className="w-3.5 h-3.5 rotate-180" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const idx = rawLeads.findIndex(l => (l.company_name || l.name || l.title) === selectedDecisionMakerCompany)
                              if (idx >= 0 && idx < rawLeads.length - 1) {
                                const next = rawLeads[idx + 1]
                                setSelectedDecisionMakerCompany(next.company_name || next.name || next.title)
                              }
                            }}
                            disabled={rawLeads.findIndex(l => (l.company_name || l.name || l.title) === selectedDecisionMakerCompany) >= rawLeads.length - 1}
                            className="p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-900 disabled:opacity-50"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Contacts count found */}
                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400 ml-1">
                          {activeContacts.length} contacts found
                        </span>

                        {/* ICP match score bubble */}
                        <span className="px-2.5 py-1 bg-emerald-50 dark:bg-emerald-950/30 text-[10px] font-black text-emerald-700 dark:text-emerald-400 rounded-lg border border-emerald-200/50 dark:border-emerald-900/20">
                          {selectedLead?.match_score || '—'} ICP Match
                        </span>
                      </div>

                      {/* Add Export Buttons Here */}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setActiveExportDropdown(activeExportDropdown === 'decision_makers' ? null : 'decision_makers')}
                          className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-955 rounded-xl shadow-sm text-xs font-extrabold text-slate-650 dark:text-slate-350 transition-all cursor-pointer select-none active:scale-95"
                        >
                          <Download className="w-3.5 h-3.5 text-slate-450" />
                          <span>Export All</span>
                          <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${activeExportDropdown === 'decision_makers' ? 'rotate-180' : ''}`} />
                        </button>

                        {activeExportDropdown === 'decision_makers' && (
                          <>
                            <div 
                              className="fixed inset-0 z-40 cursor-default" 
                              onClick={() => setActiveExportDropdown(null)} 
                            />
                            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-50 py-1.5 animate-slide-up">
                              <div className="px-3 py-1 text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider">
                                Choose Format
                              </div>
                              
                              <button
                                type="button"
                                onClick={async () => {
                                  setActiveExportDropdown(null);
                                  try {
                                    await api.exportDecisionMakers(requestId, 'csv');
                                  } catch (err) {
                                    console.error("Export failed:", err);
                                    alert("Failed to export CSV.");
                                  }
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-400"></span>
                                <span>CSV (.csv)</span>
                              </button>

                              <button
                                type="button"
                                onClick={async () => {
                                  setActiveExportDropdown(null);
                                  try {
                                    await api.exportDecisionMakers(requestId, 'xlsx');
                                  } catch (err) {
                                    console.error("Export failed:", err);
                                    alert("Failed to export Excel spreadsheet.");
                                  }
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                                <span>Excel (.xlsx)</span>
                              </button>

                              <button
                                type="button"
                                onClick={async () => {
                                  setActiveExportDropdown(null);
                                  try {
                                    await api.exportDecisionMakers(requestId, 'pdf');
                                  } catch (err) {
                                    console.error("Export failed:", err);
                                    alert("Failed to export PDF Report.");
                                  }
                                }}
                                className="w-full text-left px-4 py-2 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors cursor-pointer"
                              >
                                <span className="w-2.5 h-2.5 rounded-full bg-rose-500"></span>
                                <span>PDF Report (.pdf)</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Right part: Action buttons with exact names */}
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fetchDecisionMakers()}
                          disabled={dmLoading}
                          className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-black text-slate-700 dark:text-slate-300 flex items-center gap-1.5 shadow-sm disabled:opacity-60"
                        >
                          {dmLoading ? (
                            <Loader2 className="w-3.5 h-3.5 text-violet-500 animate-spin" />
                          ) : (
                            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                            </svg>
                          )}
                          {dmLoading ? 'Loading...' : 'Refresh'}
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (selectedContacts.length === activeContacts.length) {
                              setSelectedContacts([])
                            } else {
                              setSelectedContacts(activeContacts.map(c => c.name))
                            }
                          }}
                          className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-black text-slate-700 dark:text-slate-300 flex items-center gap-1.5 shadow-sm"
                        >
                          <CheckSquare className="w-3.5 h-3.5 text-slate-400" />
                          Bulk Select
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (!activeContacts || activeContacts.length === 0) return
                            const headers = "Name,Title,LinkedIn URL,Company\n"
                            const rows = activeContacts.map(c => `"${c.name}","${c.title}","${c.linkedin_url}","${selectedDecisionMakerCompany}"`).join("\n")
                            const blob = new Blob([headers + rows], { type: 'text/csv' })
                            const url = window.URL.createObjectURL(blob)
                            const a = document.createElement('a')
                            a.setAttribute('href', url)
                            a.setAttribute('download', `${selectedDecisionMakerCompany || 'contacts'}_decision_makers.csv`)
                            a.click()
                          }}
                          className="bg-white hover:bg-slate-50 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-black text-slate-700 dark:text-slate-300 flex items-center gap-1.5 shadow-sm"
                        >
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                          </svg>
                          Export
                        </button>

                        <button
                          type="button"
                          onClick={() => triggerAlert("Creating manual prospect...", "Prospect Creator", "info")}
                          className="bg-violet-100 hover:bg-violet-200 text-violet-950 rounded-xl px-4 py-2.5 text-xs font-black flex items-center gap-1.5 transition-all shadow-sm"
                        >
                          <Users className="w-3.5 h-3.5" />
                          Add Manually
                        </button>
                      </div>
                    </div>

                    {/* Filter and Search Row */}
                    <div className="flex flex-wrap items-center gap-3 bg-slate-50/20 dark:bg-slate-950/10 p-3 rounded-2xl border border-slate-150/50 dark:border-slate-850">
                      {/* Search Contacts Input */}
                      <div className="relative min-w-[200px] flex-1 md:flex-initial">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-405" />
                        <input
                          type="text"
                          value={dmSearchQuery}
                          onChange={(e) => setDmSearchQuery(e.target.value)}
                          placeholder="Search contacts..."
                          className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold focus:outline-none focus:border-primary-500"
                        />
                      </div>

                      {/* Select Dropdown Filters */}
                      <div className="relative min-w-[130px]">
                        <select
                          value={dmSeniority}
                          onChange={(e) => setDmSeniority(e.target.value)}
                          className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none cursor-pointer text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seniority: All</option>
                          <option value="C-Level" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seniority: C-Level</option>
                          <option value="VP" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seniority: VP</option>
                          <option value="Director" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seniority: Director</option>
                          <option value="Manager" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Seniority: Manager</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      </div>

                      <div className="relative min-w-[140px]">
                        <select
                          value={dmDepartment}
                          onChange={(e) => setDmDepartment(e.target.value)}
                          className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none cursor-pointer text-slate-700 dark:text-slate-300"
                        >
                          <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Department: All</option>
                          <option value="Revenue" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Department: Revenue / Sales</option>
                          <option value="Engineering" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Department: Engineering</option>
                          <option value="Operations" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Department: Operations</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                      </div>

                        <div className="relative min-w-[135px]">
                          <select
                            value={dmPersona}
                            onChange={(e) => setDmPersona(e.target.value)}
                            className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-violet-400 dark:hover:border-violet-650 transition-colors rounded-xl pl-3 pr-8 py-2.5 text-xs font-bold focus:outline-none cursor-pointer text-slate-700 dark:text-slate-300"
                          >
                            <option value="All" className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">Persona: All</option>
                            {personaOptions.map(option => (
                              <option key={option} value={option} className="bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-355">
                                Persona: {option}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        </div>

                      {/* Verified Email Only check box */}
                      <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-650 dark:text-slate-400 select-none ml-2">
                        <input
                          type="checkbox"
                          checked={dmVerifiedOnly}
                          onChange={(e) => setDmVerifiedOnly(e.target.checked)}
                          className="w-4 h-4 rounded text-violet-600 focus:ring-violet-500 border-slate-300 cursor-pointer accent-violet-600"
                        />
                        <span>Verified Email Only</span>
                      </label>
                    </div>

                    {/* Split 2-Column Panel Layout */}
                    <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-6 items-start">

                      {/* Left Column (Companies List) */}
                      <div className="bg-slate-50/10 dark:bg-slate-950/20 border border-slate-200/60 dark:border-slate-800 rounded-2xl p-4 space-y-3 shadow-sm">
                        <span className="text-[10px] font-black uppercase text-slate-400 dark:text-slate-550 tracking-wider block pl-1">
                          Companies ({rawLeads.length})
                        </span>

                        {/* Search field */}
                        <div className="relative">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                          <input
                            type="text"
                            value={dmCompanySearch}
                            onChange={(e) => setDmCompanySearch(e.target.value)}
                            placeholder="Search companies..."
                            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold focus:outline-none focus:border-primary-500"
                          />
                        </div>

                        <div className="space-y-1 max-h-[500px] overflow-y-auto custom-scrollbar pr-1">
                          {isPipelineRunning && rawLeads.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-8 text-center">
                              <Loader2 className="w-6 h-6 text-violet-400 animate-spin mb-2" />
                              <p className="text-[11px] font-bold text-slate-400 dark:text-slate-500">Sourcing companies...</p>
                            </div>
                          ) : rawLeads
                            .filter(lead => {
                              const name = lead.company_name || lead.name || lead.title || ''
                              return name.toLowerCase().includes((dmCompanySearch || globalSearchQuery).toLowerCase())
                            })
                            .map((lead, i) => {
                              const name = lead.company_name || lead.name || lead.title || 'Unknown Entity'
                              const isActive = selectedDecisionMakerCompany === name
                              const matchScoreInt = parseInt(lead.match_score) || 80

                              return (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() => setSelectedDecisionMakerCompany(name)}
                                  className={`w-full flex items-center justify-between p-3 rounded-xl transition-all border text-left ${isActive
                                      ? 'bg-violet-50/70 dark:bg-violet-950/20 border-violet-200/60 dark:border-violet-900/40 text-violet-900 dark:text-violet-300 shadow-sm'
                                      : 'bg-transparent border-transparent text-slate-650 dark:text-slate-400 hover:bg-slate-100/50 dark:hover:bg-slate-800/40 hover:text-slate-900 dark:hover:text-slate-200'
                                    }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {lead.url && lead.url !== 'null' ? (
                                      <div className="w-6.5 h-6.5 rounded-md bg-white border border-slate-200 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
                                        <img
                                          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(lead.url)}&sz=32`}
                                          alt=""
                                          className="w-4.5 h-4.5 object-contain"
                                          onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                                        />
                                      </div>
                                    ) : (
                                      <div className="w-6.5 h-6.5 rounded-md bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0 font-bold text-[10px] text-slate-400">
                                        {name[0].toUpperCase()}
                                      </div>
                                    )}
                                    <div className="min-w-0">
                                      <span className="text-xs font-black truncate block">{name}</span>
                                      <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold flex items-center gap-2 mt-0.5">
                                        <Users className="w-2.5 h-2.5 text-slate-400" /> {(Object.keys(dmDataMap).length > 0 ? dmDataMap[lead.company_name || lead.name || lead.title]?.length : null) ?? lead.decision_makers?.length ?? 0}
                                        <span className="text-emerald-600 dark:text-emerald-500 font-black">{lead.match_score || '—'}</span>
                                      </span>
                                    </div>
                                  </div>

                                  {matchScoreInt < 75 && (
                                    <span className="text-amber-500 font-black shrink-0 text-xs" title="Low match score">
                                      ⚠
                                    </span>
                                  )}
                                </button>
                              )
                            })}
                        </div>
                      </div>

                      {/* Right Column (Verified Decision Maker Contacts) */}
                      <div className="space-y-4 flex-1">

                        <div className="flex items-center justify-between bg-slate-50/20 dark:bg-slate-950/10 px-4 py-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                          <span className="text-xs font-bold text-slate-500 dark:text-slate-400">
                            {activeContacts.length} contacts · sorted by relevance
                          </span>
                          <div className="flex items-center gap-3 text-[10px] font-black uppercase text-slate-450 dark:text-slate-500 select-none">
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Relevance</span>
                            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500"></span> Confidence</span>
                          </div>
                        </div>

                        {activeContacts.length > 0 ? (
                          <div className="space-y-3.5 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
                            {activeContacts
                              .filter(contact => {
                                const name = contact.name || ''
                                const title = contact.title || ''
                                const term = (dmSearchQuery || globalSearchQuery).toLowerCase()
                                const matchesSearch = name.toLowerCase().includes(term) || title.toLowerCase().includes(term)

                                const matchesSeniority = dmSeniority === 'All' ||
                                  (dmSeniority === 'C-Level' && (title.toLowerCase().includes('chief') || title.toLowerCase().includes('cxo') || title.toLowerCase().includes('ceo') || title.toLowerCase().includes('cto') || title.toLowerCase().includes('cro') || title.toLowerCase().includes('cfo'))) ||
                                  (dmSeniority === 'VP' && (title.toLowerCase().includes('vp') || title.toLowerCase().includes('vice president'))) ||
                                  (dmSeniority === 'Director' && title.toLowerCase().includes('director')) ||
                                  (dmSeniority === 'Manager' && title.toLowerCase().includes('manager'))

                                const matchesPersona = dmPersona === 'All' || (contact.persona_label || 'Influencer') === dmPersona

                                return matchesSearch && matchesSeniority && matchesPersona
                              })
                              .map((contact, idx) => {
                                                                const isSelected = selectedContacts.includes(contact.name)
                                const relevancePct = contact.relevance_score ?? 0
                                const confidencePct = contact.confidence_score ?? 0
                                const roleTag = contact.persona_label || 'Influencer'
                                const confidenceLabel = contact.confidence_label || 'Review'
                                const confidenceClass = contact.confidence_className || 'bg-slate-50 dark:bg-slate-950/30 text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-slate-800/50'
                                const relevanceBarClass = relevancePct >= 85 ? 'bg-emerald-500' : relevancePct >= 65 ? 'bg-indigo-500' : 'bg-amber-500'

                                const getInitials = (nameStr) => {
                                  if (!nameStr) return 'DM';
                                  const parts = nameStr.trim().split(/\s+/);
                                  if (parts.length >= 2) {
                                    return (parts[0][0] + parts[1][0]).toUpperCase();
                                  }
                                  return nameStr.slice(0, 2).toUpperCase();
                                };
                                const initials = getInitials(contact.name);

                                return (
                                  <div key={idx} className="group bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800 rounded-3xl p-5 hover:border-slate-350 dark:hover:border-slate-700 transition-all duration-300 shadow-sm hover:shadow-md">
                                    <div className="flex items-center gap-4">
                                      {/* Checkbox selector */}
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (isSelected) {
                                            setSelectedContacts(selectedContacts.filter(c => c !== contact.name))
                                          } else {
                                            setSelectedContacts([...selectedContacts, contact.name])
                                          }
                                        }}
                                        className="text-slate-400 hover:text-violet-650 shrink-0"
                                      >
                                        {isSelected ? (
                                          <CheckSquare className="w-5 h-5 text-violet-600 fill-violet-50 dark:fill-transparent" />
                                        ) : (
                                          <Square className="w-5 h-5 text-slate-450 dark:text-slate-650" />
                                        )}
                                      </button>

                                      {/* Dynamic CSS initials avatar */}
                                      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-violet-500/10 to-indigo-600/10 dark:from-violet-500/25 dark:to-indigo-600/25 border border-violet-100 dark:border-violet-900/30 flex items-center justify-center text-violet-600 dark:text-violet-400 font-extrabold text-sm shrink-0 select-none">
                                        {initials}
                                      </div>

                                      {/* Information grid */}
                                      <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-[1.5fr_1.05fr_1.05fr] gap-4 items-center">

                                        {/* Contact Name & Title Info */}
                                        <div className="min-w-0">
                                          <div className="flex items-center gap-2">
                                            <h4 className="text-sm font-black text-slate-850 dark:text-white truncate">{contact.name}</h4>

                                            {/* Mail, Phone, and LinkedIn links */}
                                            {(contact.email || selectedLead?.email) && (
                                              <a href={`mailto:${contact.email || selectedLead?.email}`} className="text-slate-400 hover:text-violet-600 transition-colors">
                                                <Mail className="w-3.5 h-3.5" />
                                              </a>
                                            )}
                                            {(contact.phone || selectedLead?.phone) && (
                                              <a href={`tel:${contact.phone || selectedLead?.phone}`} className="text-slate-400 hover:text-violet-600 transition-colors">
                                                <Phone className="w-3.5 h-3.5" />
                                              </a>
                                            )}
                                            {contact.linkedin_url && (
                                              <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-violet-600 transition-colors">
                                                <svg className="w-3.5 h-3.5 fill-current shrink-0" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.761 0 5-2.239 5-5v-14c0-2.761-2.239-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                                              </a>
                                            )}
                                          </div>
                                          <p className="text-xs font-bold text-slate-500 dark:text-slate-450 truncate mt-0.5">
                                            {contact.title}
                                          </p>
                                        </div>

                                        {/* Role Tag Pill */}
                                        <div className="flex justify-start md:justify-center">
                                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${getPersonaBadgeClass(roleTag)}`}>
                                            {roleTag}
                                          </span>
                                        </div>

                                        {/* Scores & Verified badge details */}
                                        <div className="flex flex-col md:items-end gap-1 select-none">
                                          <div className="flex items-center gap-3 text-xs font-bold">
                                            <span className="text-emerald-600 dark:text-emerald-500 font-extrabold">{relevancePct} rel.</span>

                                            {/* Relevance visual bar progress matching screenshot */}
                                            <div className="w-16 bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                              <div
                                                className={`h-1.5 rounded-full ${relevanceBarClass}`}
                                                style={{ width: `${relevancePct}%` }}
                                              ></div>
                                            </div>

                                            <span className="text-slate-500 dark:text-slate-400 font-semibold">{confidencePct}%</span>
                                          </div>

                                          {/* Status badge and LinkedIn logo */}
                                          <div className="flex items-center gap-1.5 mt-0.5">
                                            <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${confidenceClass}`}>
                                              {confidenceLabel}
                                            </span>

                                            {/* LinkedIn Icon */}
                                            {contact.linkedin_url && (
                                              <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-slate-400 hover:text-violet-650 ml-1">
                                                <svg className="w-4.5 h-4.5 fill-current shrink-0" viewBox="0 0 24 24"><path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.761 0 5-2.239 5-5v-14c0-2.761-2.239-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" /></svg>
                                              </a>
                                            )}

                                            {/* Menu icon */}
                                            <button type="button" className="text-slate-400 hover:text-slate-650 ml-1.5 font-bold">
                                              ⋮
                                            </button>
                                          </div>
                                        </div>

                                      </div>
                                    </div>
                                  </div>
                                )
                              })}
                          </div>
                        ) : isPipelineRunning ? (
                          <div className="text-center py-20 bg-gradient-to-b from-violet-50/60 to-slate-50/30 dark:from-violet-950/10 dark:to-slate-950/20 rounded-3xl border-2 border-dashed border-violet-200/70 dark:border-violet-900/40">
                            <div className="relative w-16 h-16 mx-auto mb-6">
                              <div className="absolute inset-0 rounded-full border-[3px] border-violet-100 dark:border-violet-900/40" />
                              <div className="absolute inset-0 rounded-full border-[3px] border-violet-500 border-t-transparent animate-spin" />
                              <div className="absolute inset-[5px] rounded-full bg-violet-50 dark:bg-violet-950/30 flex items-center justify-center">
                                <Users className="w-5 h-5 text-violet-500" />
                              </div>
                            </div>
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Enriching Decision Makers...</h4>
                            <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1.5 font-medium">
                              Your AI pipeline is sourcing and verifying decision maker contacts. They will appear here once enrichment completes.
                            </p>
                            <div className="flex items-center justify-center gap-1.5 mt-5">
                              <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                              <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                              <div className="w-2 h-2 rounded-full bg-violet-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        ) : (
                          <div className="text-center py-20 bg-slate-50/50 dark:bg-slate-950/20 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-800">
                            <Users className="w-10 h-10 text-slate-350 dark:text-slate-650 mx-auto mb-4" />
                            <h4 className="text-sm font-bold text-slate-800 dark:text-slate-300">No contacts synced</h4>
                            <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto mt-1 font-medium">Scrape LinkedIn for target prospects matching ICP blueprint.</p>
                          </div>
                        )}

                      </div>

                    </div>

                    {/* Bottom Fixed Action Bar */}
                    <div className="pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                      <div className="px-4 py-2 bg-slate-100/80 dark:bg-slate-900 rounded-full text-xs font-black text-slate-500 shadow-inner">
                        {selectedContacts.length === 0 ? 'No contacts selected' : `${selectedContacts.length} contacts selected`}
                      </div>
                      <button
                        type="button"
                        onClick={() => triggerAlert(`Enqueued ${selectedContacts.length} contacts into Outreach Sequence!`, "Outreach Sequence", "success")}
                        disabled={selectedContacts.length === 0}
                        className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-black px-6 py-3 rounded-2xl flex items-center gap-2 shadow-md shadow-violet-200 dark:shadow-none hover:shadow-lg transition-all"
                      >
                        Add to Outreach Sequence
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>

                  </div>
                )}

              </div>

              {/* 4. COMPARE COMPETITORS DRAWER OVERLAY */}
              {showCompareDrawer && selectedCompareList.length > 0 && (
                <div
                  className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm flex justify-end animate-fade-in"
                  onClick={() => setShowCompareDrawer(false)}
                >
                  <div
                    className="w-full max-w-[850px] bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 h-full shadow-2xl p-6 md:p-8 flex flex-col justify-between overflow-y-auto animate-slide-in custom-scrollbar"
                    onClick={(e) => e.stopPropagation()}
                  >

                    <div className="space-y-6">

                      {/* Drawer Header */}
                      <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800/80">
                        <div>
                          <h2 className="text-xl font-black text-slate-850 dark:text-white tracking-tight">Compare Competitors</h2>
                          <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5 font-bold uppercase tracking-wider">Side-by-Side Product Matrix</p>
                        </div>
                        <button
                          onClick={() => setShowCompareDrawer(false)}
                          className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl transition-all"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Matrix Grid Comparison */}
                      <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800/80 bg-slate-50/10 dark:bg-slate-950/20">
                        <table className="w-full text-xs text-left border-collapse min-w-[500px]">

                          <thead className="bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-850/80 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                            <tr>
                              <th className="px-5 py-4 w-32">Attribute</th>
                              {selectedCompareList.map((c, i) => (
                                <th key={i} className="px-5 py-4">
                                  <div className="flex items-center gap-2">
                                    <div className="w-6 h-6 rounded-md bg-white border border-slate-200 shadow-sm flex items-center justify-center shrink-0 overflow-hidden">
                                      <img
                                        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(c.website)}&sz=32`}
                                        alt=""
                                        className="w-4.5 h-4.5 object-contain"
                                        onError={(e) => { e.target.parentElement.style.display = 'none'; }}
                                      />
                                    </div>
                                    <span className="font-extrabold text-slate-800 dark:text-white truncate max-w-[120px]">{c.name}</span>
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>

                          <tbody className="divide-y divide-slate-150 dark:divide-slate-850/60 font-semibold text-slate-750 dark:text-slate-300 bg-white dark:bg-slate-900/40">

                            {/* Product overlap */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">ICP Overlap</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">
                                  <span className="text-primary-550 dark:text-primary-400 font-extrabold">{c.overlap_score}% match</span>
                                </td>
                              ))}
                            </tr>

                            {/* Headquarters */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">Headquarters</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5 truncate max-w-[140px]">{c.headquarters}</td>
                              ))}
                            </tr>

                            {/* Funding */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">Funding Stage</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">
                                  {c.funding_stage !== '--' ? (
                                    <span className="px-2 py-0.5 rounded bg-amber-50 dark:bg-amber-950/30 text-amber-600 text-[9px] font-black border border-amber-100/45 dark:border-amber-900/20">{c.funding_stage}</span>
                                  ) : <span className="text-slate-400 dark:text-slate-550 text-xs font-bold">--</span>}
                                </td>
                              ))}
                            </tr>

                            {/* Pricing Model */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">Pricing Model</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">{c.pricing_model}</td>
                              ))}
                            </tr>

                            {/* Deployment Model */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">Deployment</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">{c.deployment_model}</td>
                              ))}
                            </tr>

                            {/* Deal size estimate */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">Avg Deal Size</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">{c.deal_size || '--'}</td>
                              ))}
                            </tr>

                            {/* Reviews */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">G2 / Capterra</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">
                                  {c.g2_rating !== '--' || c.capterra_rating !== '--' ? (
                                    <div className="flex items-center gap-1.5 font-extrabold text-amber-500">
                                      <Star className="w-3.5 h-3.5 fill-amber-500" />
                                      <span>{c.g2_rating}</span>
                                      <span className="text-slate-400 dark:text-slate-500 font-bold">/</span>
                                      <span className="text-slate-500 dark:text-slate-400">{c.capterra_rating}</span>
                                    </div>
                                  ) : <span className="text-slate-400 dark:text-slate-550 text-xs font-bold">--</span>}
                                </td>
                              ))}
                            </tr>

                            {/* Key Customers */}
                            <tr>
                              <td className="px-5 py-3.5 bg-slate-50/50 dark:bg-slate-950/40 text-[10px] font-black uppercase text-slate-400 dark:text-slate-550">Key Customers</td>
                              {selectedCompareList.map((c, i) => (
                                <td key={i} className="px-5 py-3.5">
                                  <div className="flex flex-wrap gap-1 max-w-[140px]">
                                    {(c.customers || []).length > 0 ? (c.customers).slice(0, 2).map((cust, idx) => (
                                      <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-bold text-slate-500 dark:text-slate-400">
                                        {cust}
                                      </span>
                                    )) : <span className="text-slate-400 dark:text-slate-550 text-xs font-bold">--</span>}
                                  </div>
                                </td>
                              ))}
                            </tr>

                          </tbody>

                        </table>
                      </div>

                    </div>

                    <div className="mt-8 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-4">
                      <button
                        type="button"
                        onClick={() => setSelectedCompareList([])}
                        className="text-xs font-bold text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        Reset Comparison List
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowCompareDrawer(false)}
                        className="btn-primary px-6"
                      >
                        Close Comparison
                      </button>
                    </div>

                  </div>
                </div>
              )}

              {/* Floating Compare trigger button if selections exist */}
              {!showCompareDrawer && selectedCompareList.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCompareDrawer(true)}
                  className="fixed bottom-6 right-6 z-40 bg-gradient-to-r from-primary-600 to-indigo-650 hover:from-primary-700 hover:to-indigo-750 text-white shadow-xl shadow-primary-200/50 dark:shadow-none px-6 py-4.5 rounded-2xl flex items-center gap-3 font-black text-sm transition-all duration-300 hover:scale-105"
                >
                  <SlidersHorizontal className="w-5 h-5 animate-pulse" />
                  Compare Competitors ({selectedCompareList.length})
                </button>
              )}

            </div>
          );
        })() : (
          <div className="text-center py-20 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl">
            <p className="text-slate-500 dark:text-slate-400 font-medium">No results data available for this lead request.</p>
          </div>
        )}
      </div>

      {/* Custom Premium Alert Modal */}
      {customAlert.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 dark:bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="relative w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6 overflow-hidden transform scale-in">
            {/* Top decorative gradient bar */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-violet-600 to-indigo-650" />

            <div className="flex items-start gap-3.5 mt-2">
              <div className={`p-2.5 rounded-2xl shrink-0 ${customAlert.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400' :
                  customAlert.type === 'warning' ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400' :
                    'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                }`}>
                {customAlert.type === 'success' ? <CheckCircle2 className="w-5.5 h-5.5" /> :
                  customAlert.type === 'warning' ? <Zap className="w-5.5 h-5.5" /> :
                    <Sparkles className="w-5.5 h-5.5" />}
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-black text-slate-850 dark:text-white leading-tight">
                  {customAlert.title}
                </h3>
                <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                  {customAlert.message}
                </p>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setCustomAlert({ ...customAlert, show: false })}
                className="bg-violet-600 hover:bg-violet-750 text-white text-[10px] font-black uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-md shadow-violet-100 dark:shadow-none transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

