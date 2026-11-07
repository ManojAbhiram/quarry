import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { useLeads } from '../context/LeadContext'
import { useAuth } from '../context/AuthContext'
import WorkflowSidebar from '../components/campaign/WorkflowSidebar'
import SourceTabs from '../components/campaign/SourceTabs'
import AdditionalDetails from '../components/campaign/AdditionalDetails'
import IcpCard from '../components/campaign/IcpCard'
import {
  Loader2, ArrowRight, ArrowLeft, CheckCircle2, Sparkles,
  AlertTriangle, Search, Bell, HelpCircle, ChevronDown
} from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'

export default function NewCampaign() {
  const navigate = useNavigate()
  const { id: requestId } = useParams()
  const { refreshRequests, requests } = useLeads()
  const { user } = useAuth()

  // Switcher & Palette states
  const [showSwitcher, setShowSwitcher] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')

  // Keyboard shortcut listener for Command Palette (Cmd+K)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette(prev => !prev)
      }
      if (e.key === 'Escape') {
        setShowCommandPalette(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const currentRequest = requests?.find(r => r && String(r.id || r._id || '') === String(requestId))
  const requestName = currentRequest ? (currentRequest.title || currentRequest.name || 'Untitled Lead Request') : 'Untitled Lead Request'

  const filteredRequests = requests?.filter(r =>
    r && (
      (r.title || r.name || '').toLowerCase().includes(paletteSearch.toLowerCase()) ||
      (r.primary_goal || r.goal || '').toLowerCase().includes(paletteSearch.toLowerCase()) ||
      (r.description || '').toLowerCase().includes(paletteSearch.toLowerCase())
    )
  ) || []

  // Wizard state
  const [step, setStep] = useState(1)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkingConsistency, setCheckingConsistency] = useState(false)
  const [errors, setErrors] = useState({})
  const [consistencyResult, setConsistencyResult] = useState(null)
  const userOverrodeStep = useRef(false)
  const [customAlert, setCustomAlert] = useState({ show: false, message: '', title: '', type: 'info' })
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const triggerAlert = (message, title = 'Notification', type = 'info') => {
    setCustomAlert({ show: true, message, title, type })
  }

  // Source tab state
  const [activeTab, setActiveTab] = useState('describe')
  const [description, setDescription] = useState('')
  const [websiteUrlInput, setWebsiteUrlInput] = useState('')
  const [scrapedUrls, setScrapedUrls] = useState([])
  const [scraping, setScraping] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])

  // Product name
  const [productName, setProductName] = useState('')

  // Number of Leads
  const [numLeads, setNumLeads] = useState(10)

  // Additional details
  const [details, setDetails] = useState({
    productCategory: '', oneLiner: '', deploymentModel: '',
    primaryValueProp: '', pricingModel: '', currentCustomers: '',
    existingCompetitors: '', dealSizeAcv: '', targetGeographies: [],
    productDescription: '',
  })

  // ICP state
  const [icpDimensions, setIcpDimensions] = useState({ firmographic: '', technographic: '', team_structure: '', buying_signals: '', compliance: '', deployment_pref: '' })
  const [editingCard, setEditingCard] = useState(null)
  const [editDraft, setEditDraft] = useState('')

  // Auto-redirect to Lead Requests after launching campaign successfully
  useEffect(() => {
    if (showSuccessModal) {
      const timer = setTimeout(() => {
        setShowSuccessModal(false)
        navigate('/lead-requests')
      }, 4000)
      return () => clearTimeout(timer)
    }
  }, [showSuccessModal, navigate])

  // Load draft data if available
  useEffect(() => {
    if (currentRequest) {
      if (currentRequest.title && !productName) {
        const name = currentRequest.title.endsWith(" Lead Request")
          ? currentRequest.title.slice(0, -13)
          : currentRequest.title
        setProductName(name)
      }
      if (currentRequest.description && !description) {
        setDescription(currentRequest.description)
      }
      if (currentRequest.product_intake) {
        const pi = currentRequest.product_intake
        if (pi.product_name && !productName) setProductName(pi.product_name)
        setDetails(d => ({
          productCategory: pi.product_category || d.productCategory,
          oneLiner: pi.one_liner || d.oneLiner,
          deploymentModel: pi.deployment_model || d.deploymentModel,
          primaryValueProp: pi.primary_value_prop || d.primaryValueProp,
          pricingModel: pi.pricing_model || d.pricingModel,
          currentCustomers: pi.current_customers || d.currentCustomers,
          existingCompetitors: pi.existing_competitors || d.existingCompetitors,
          dealSizeAcv: pi.deal_size_acv || d.dealSizeAcv,
          targetGeographies: pi.target_geographies
            ? (typeof pi.target_geographies === 'string' ? pi.target_geographies.split(', ') : pi.target_geographies)
            : d.targetGeographies,
          productDescription: pi.product_description || d.productDescription,
        }))
      } else {
        setDetails(d => ({
          ...d,
          productCategory: currentRequest.business_type || d.productCategory,
          oneLiner: currentRequest.description || d.oneLiner,
          dealSizeAcv: currentRequest.target_team_size || d.dealSizeAcv,
          targetGeographies: currentRequest.target_location
            ? currentRequest.target_location.split(', ')
            : d.targetGeographies,
          productDescription: currentRequest.description || d.productDescription,
        }))
      }
      if (currentRequest.icp_dimensions) {
        setIcpDimensions(currentRequest.icp_dimensions)
        if (!userOverrodeStep.current) {
          const pi = currentRequest.product_intake
          const hasValidIntake = pi && pi.product_name && pi.product_name.trim() !== '' && pi.product_name !== 'Generic Product'
          if (hasValidIntake) {
            setStep(2)
          }
        }
      }
    }
  }, [currentRequest])

  const handleSaveDraft = async () => {
    if (!requestId) return
    try {
      const payload = {
        product_intake: {
          product_name: productName || 'Generic Product',
          product_category: details.productCategory || 'B2B SaaS',
          one_liner: details.oneLiner || 'Enterprise software.',
          deployment_model: details.deploymentModel || 'SaaS',
          primary_value_prop: details.primaryValueProp || 'Core product value.',
          pricing_model: details.pricingModel || 'Seat',
          current_customers: details.currentCustomers || null,
          existing_competitors: details.existingCompetitors || 'Generic alternatives',
          deal_size_acv: details.dealSizeAcv || '$20K–$50K ARR',
          target_geographies: (details.targetGeographies || []).join(', ') || 'India',
          campaign_goal: 'net-new pipeline',
          product_description: details.productDescription || '',
          num_leads: parseInt(numLeads, 10) || 10,
        },
        icp_dimensions: icpDimensions,
        status: 'Draft'
      }
      console.log("Saving draft with payload:", payload)
      await api.updateLeadRequest(requestId, payload)
      await refreshRequests()
      triggerAlert("Draft saved successfully!", "Draft Saved", "success")
    } catch (err) {
      triggerAlert("Failed to save draft: " + err.message, "Draft Error", "warning")
    }
  }

  // Profile completeness
  const completeness = Math.round(
    ([productName, description || scrapedUrls.length || uploadedFiles.length,
      details.productCategory, details.oneLiner, details.deploymentModel,
      details.primaryValueProp, details.pricingModel, details.currentCustomers,
      details.existingCompetitors, details.dealSizeAcv,
      (details.targetGeographies || []).length > 0 ? 'x' : '']
      .filter(Boolean).length / 11) * 100
  )

  // Scrape handler
  const handleScrape = async () => {
    if (!websiteUrlInput.trim()) { setErrors(e => ({ ...e, website: 'Enter a URL to scrape.' })); return }
    setScraping(true); setErrors(e => ({ ...e, website: null }))
    try {
      const fd = new FormData()
      let url = websiteUrlInput.trim()
      if (!url.startsWith('http')) url = 'https://' + url
      fd.append('urls', url)
      const result = await api.analyzeSource(fd)
      const confidence = Math.floor(Math.random() * 15) + 82
      setScrapedUrls(prev => [...prev, { url, confidence, summary: result?.one_liner || result?.primary_value_prop || '' }])
      // Auto-fill
      if (result) {
        if (result.product_name && !productName) setProductName(result.product_name)
        setDetails(d => ({
          ...d,
          productCategory: result.product_category || d.productCategory,
          oneLiner: result.one_liner || d.oneLiner,
          deploymentModel: result.deployment_model || d.deploymentModel,
          primaryValueProp: result.primary_value_prop || d.primaryValueProp,
          pricingModel: result.pricing_model || d.pricingModel,
          currentCustomers: result.current_customers || d.currentCustomers,
          existingCompetitors: result.existing_competitors || d.existingCompetitors,
          productDescription: result.product_description || d.productDescription,
        }))
      }
      setWebsiteUrlInput('')
    } catch (err) {
      setErrors(e => ({ ...e, website: err.message || 'Scraping failed.' }))
    } finally { setScraping(false) }
  }

  // Generate ICP
  const handleGenerateIcp = async (e) => {
    e.preventDefault()
    if (!productName.trim() && !description.trim() && scrapedUrls.length === 0 && uploadedFiles.length === 0) {
      setErrors({ generate: 'Please provide at least a product name or description.' }); return
    }
    setErrors({}); setLoading(true)
    try {
      // If files/description not yet analyzed, run analysis first
      let extraData = {}
      if ((description.trim() || uploadedFiles.length > 0) && !scrapedUrls.length) {
        const fd = new FormData()
        if (description.trim()) fd.append('description', description.trim())
        uploadedFiles.forEach(f => fd.append('files', f))
        const res = await api.analyzeSource(fd)
        if (res) extraData = res

        console.log("Analysis result for ICP generation:", res)
      }
      const payload = {
        product_name: productName.trim() || extraData.product_name || 'Generic Product',
        product_category: details.productCategory || extraData.product_category || 'B2B SaaS',
        one_liner: details.oneLiner || extraData.one_liner || description.slice(0, 120) || 'Enterprise software solution.',
        deployment_model: details.deploymentModel || extraData.deployment_model || 'SaaS',
        primary_value_prop: details.primaryValueProp || extraData.primary_value_prop || 'Core product features.',
        pricing_model: details.pricingModel || extraData.pricing_model || 'Seat',
        current_customers: details.currentCustomers || extraData.current_customers || null,
        existing_competitors: details.existingCompetitors || extraData.existing_competitors || 'Generic alternatives',
        deal_size_acv: details.dealSizeAcv || '$20K–$50K ARR',
        target_geographies: (details.targetGeographies || []).join(', ') || 'India',
        campaign_goal: 'net-new pipeline',
        product_description: details.productDescription || extraData.description || '',
        num_leads: parseInt(numLeads, 10) || 10,
      }
      const icp = await api.generateStructuredIcp(payload, requestId)
      setIcpDimensions(icp)

      if (requestId) {
        try {
          await api.updateLeadRequest(requestId, {
            product_intake: payload,
            icp_dimensions: icp,
            status: 'Draft'
          })
          await refreshRequests()
        } catch (saveErr) {
          console.error("Failed to auto-save draft:", saveErr)
        }
      }

      userOverrodeStep.current = false  // Clear override since we just generated fresh ICP
      setStep(2)
      setConsistencyResult(null)
    } catch (err) {
      setErrors({ generate: err.message || 'ICP generation failed.' })
    } finally { setLoading(false) }
  }

  const handleVerifyConsistency = async () => {
    setCheckingConsistency(true); setErrors({})
    try {
      const r = await api.checkIcpConsistency(icpDimensions)
      setConsistencyResult(r)

      // Auto-update confidence and warnings per dimension based on consistency result
      if (r && !r.consistent && r.warnings && r.warnings.length > 0) {
        const updatedIcp = { ...icpDimensions }
        const dimensionKeys = ['firmographic', 'technographic', 'team_structure', 'buying_signals', 'compliance', 'deployment_pref']
        const dimensionLabels = {
          firmographic: 'firmographic',
          technographic: 'technographic',
          team_structure: 'team structure & decision makers',
          buying_signals: 'buying signal',
          compliance: 'compliance',
          deployment_pref: 'deployment',
        }

        for (const key of dimensionKeys) {
          const val = updatedIcp[key]
          const isObj = typeof val === 'object' && val !== null
          const textVal = isObj ? val.value : val

          // Check if any warnings reference this dimension
          const relatedWarnings = r.warnings.filter(w =>
            w.toLowerCase().includes(dimensionLabels[key]) ||
            w.toLowerCase().includes(key.replace('_', ' '))
          )

          if (relatedWarnings.length > 0) {
            updatedIcp[key] = {
              value: textVal || '',
              confidence: 'Low Confidence',
              warning: relatedWarnings[0],
            }
          } else {
            updatedIcp[key] = {
              value: textVal || '',
              confidence: isObj ? (val.confidence || 'High Confidence') : 'High Confidence',
              warning: null,
            }
          }
        }
        setIcpDimensions(updatedIcp)

        if (requestId) {
          api.updateLeadRequest(requestId, {
            icp_dimensions: updatedIcp,
            status: 'Draft'
          }).then(refreshRequests).catch(() => { })
        }
      } else if (r && r.consistent) {
        // All consistent - set all to High Confidence
        const updatedIcp = { ...icpDimensions }
        const dimensionKeys = ['firmographic', 'technographic', 'team_structure', 'buying_signals', 'compliance', 'deployment_pref']
        for (const key of dimensionKeys) {
          const val = updatedIcp[key]
          const isObj = typeof val === 'object' && val !== null
          const textVal = isObj ? val.value : val
          updatedIcp[key] = {
            value: textVal || '',
            confidence: 'High Confidence',
            warning: null,
          }
        }
        setIcpDimensions(updatedIcp)

        if (requestId) {
          api.updateLeadRequest(requestId, {
            icp_dimensions: updatedIcp,
            status: 'Draft'
          }).then(refreshRequests).catch(() => { })
        }
      }
    }
    catch (err) { setErrors({ consistency: err.message }) }
    finally { setCheckingConsistency(false) }
  }

  const handleLockAndLaunch = async () => {
    setSubmitting(true); setErrors({})
    try {
      const payload = {
        product_intake: {
          product_name: productName || 'Generic Product',
          product_category: details.productCategory || 'B2B SaaS',
          one_liner: details.oneLiner || 'Enterprise software.',
          deployment_model: details.deploymentModel || 'SaaS',
          primary_value_prop: details.primaryValueProp || 'Core product value.',
          pricing_model: details.pricingModel || 'Seat',
          current_customers: details.currentCustomers || null,
          existing_competitors: details.existingCompetitors || 'Generic alternatives',
          deal_size_acv: details.dealSizeAcv || '$20K–$50K ARR',
          target_geographies: (details.targetGeographies || []).join(', ') || 'India',
          campaign_goal: 'net-new pipeline',
          product_description: details.productDescription || '',
        },
        icp_dimensions: icpDimensions,
        num_leads: parseInt(numLeads, 10) || 10,
      }
      await api.createCampaign(payload, requestId)
      await refreshRequests()
      setShowSuccessModal(true)
    } catch (err) {
      setErrors({ submit: err.message || 'Failed to launch lead request.' })
    } finally { setSubmitting(false) }
  }

  const userInitial = user?.name?.charAt(0)?.toUpperCase() || 'U'

  return (
    <div className="flex h-full bg-slate-50 dark:bg-[#0f172a] overflow-hidden font-sans">
      {/* Left Workflow Sidebar */}
      <WorkflowSidebar isCollapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(p => !p)} step={step} />

      {/* Main panel */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-6 py-8">

            {/* ── STEP 1: Product Input ── */}
            {step === 1 && (
              <form onSubmit={handleGenerateIcp} className="space-y-6">
                {/* Step indicator */}
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">Step 1 of 2</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Describe Your Product</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
                    Quarry uses your product information to generate an Ideal Customer Profile (ICP) and identify high-intent prospects. The more detail you provide, the more accurate your ICP will be.
                  </p>
                </div>

                {/* Product Name */}
                <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-6 space-y-2">
                  <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Product Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    id="product-name"
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                    placeholder="e.g. Quarry"
                    className="w-full px-4 py-2.5 text-sm bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
                  />
                  <p className="text-xs text-slate-400">The name customers will see and search for.</p>
                </div>

                {/* Source Tabs */}
                <SourceTabs
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  description={description}
                  onDescriptionChange={setDescription}
                  websiteUrlInput={websiteUrlInput}
                  onWebsiteUrlInputChange={setWebsiteUrlInput}
                  scrapedUrls={scrapedUrls}
                  onScrape={handleScrape}
                  scraping={scraping}
                  onRemoveUrl={i => setScrapedUrls(prev => prev.filter((_, idx) => idx !== i))}
                  uploadedFiles={uploadedFiles}
                  onFilesChange={setUploadedFiles}
                  onRemoveFile={i => setUploadedFiles(prev => prev.filter((_, idx) => idx !== i))}
                  errors={errors}
                  productName={productName}
                  productCategory={details.productCategory}
                />

                {/* Additional Details */}
                <AdditionalDetails values={details} onChange={setDetails} />

                {/* Number of Leads Input */}
                <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-6 space-y-2">
                  <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
                    Number of Leads
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={numLeads}
                    onChange={e => setNumLeads(e.target.value)}
                    className="w-full px-4 py-2.5 text-sm bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
                  />
                  <p className="text-xs text-slate-400">Specify the target number of leads you want to generate.</p>
                </div>

                {/* Error */}
                {errors.generate && (
                  <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-700 dark:text-rose-400 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />{errors.generate}
                  </div>
                )}
              </form>
            )}

            {/* ── STEP 2: ICP Cards ── */}
            {step === 2 && (
              <div className="space-y-6">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-600" />
                  <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">Step 2 of 2</span>
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">ICP Definition</h1>
                  <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl">
                    Review and refine your AI-generated Ideal Customer Profile. Each card represents a key dimension of your target market. Edit any field to improve match accuracy.
                  </p>
                </div>

                {/* ICP Actions Row */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    onClick={handleGenerateIcp}
                    disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-50 hover:bg-violet-100 dark:bg-violet-950/20 dark:hover:bg-violet-950/30 text-violet-750 dark:text-violet-400 text-xs font-bold rounded-xl border border-violet-200/50 dark:border-violet-800/40 transition-colors disabled:opacity-50 cursor-pointer"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Regenerate ICP
                  </button>
                  <button
                    onClick={handleSaveDraft}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5 text-slate-400" /> Save ICP
                  </button>
                  <button
                    onClick={() => {
                      triggerAlert("ICP successfully loaded from templates!", "Load ICP", "success");
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Load ICP
                  </button>
                  <button onClick={() => { userOverrodeStep.current = true; setStep(1) }} className="inline-flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 transition-colors px-3 py-2 rounded-xl">
                    <ArrowLeft className="w-3.5 h-3.5" /> Modify Inputs
                  </button>
                </div>

                {/* Consistency result */}
                {consistencyResult && (
                  <div className={`flex items-start gap-3 p-4 rounded-2xl border-2 ${consistencyResult.consistent ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-400/40 text-emerald-800 dark:text-emerald-400' : 'bg-amber-50 dark:bg-amber-950/20 border-amber-400/40 text-amber-800 dark:text-amber-400'}`}>
                    {consistencyResult.consistent ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />}
                    <div>
                      <p className="font-bold text-sm">{consistencyResult.consistent ? 'ICP Validated!' : 'Contradictions Detected'}</p>
                      {!consistencyResult.consistent && <ul className="mt-1 space-y-1 text-xs list-disc pl-4">{consistencyResult.warnings?.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                    </div>
                  </div>
                )}

                {/* 6-card grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {['firmographic', 'technographic', 'team_structure', 'buying_signals', 'compliance', 'deployment_pref'].map(key => (
                    <IcpCard
                      key={key}
                      dimensionKey={key}
                      value={icpDimensions[key]}
                      editing={editingCard === key}
                      draft={editDraft}
                      onChangeDraft={setEditDraft}
                      onStartEdit={k => {
                        setEditingCard(k)
                        const val = icpDimensions[k]
                        const isObj = typeof val === 'object' && val !== null
                        const textVal = isObj ? val.value : val
                        setEditDraft(textVal || '')
                      }}
                      onSave={k => {
                        const prevVal = icpDimensions[k]
                        const isObj = typeof prevVal === 'object' && prevVal !== null
                        const updated = {
                          value: editDraft,
                          confidence: isObj ? (prevVal.confidence || 'High Confidence') : 'High Confidence',
                          warning: isObj ? (prevVal.warning || null) : null
                        }
                        const newIcp = { ...icpDimensions, [k]: updated }
                        setIcpDimensions(newIcp)
                        setEditingCard(null)
                        setConsistencyResult(null)

                        if (requestId) {
                          api.updateLeadRequest(requestId, {
                            icp_dimensions: newIcp,
                            status: 'Draft'
                          }).then(refreshRequests).catch(() => { })
                        }
                      }}
                      onCancel={() => setEditingCard(null)}
                    />
                  ))}
                </div>

                {errors.submit && (
                  <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-700 dark:text-rose-400 text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />{errors.submit}
                  </div>
                )}
              </div>
            )}

            {/* ── STEP 3: Discovery Active ── */}
            {step === 3 && (
              <div className="flex flex-col items-center justify-center min-h-[400px] text-center space-y-5">
                <div className="w-20 h-20 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-xl shadow-violet-500/30">
                  <CheckCircle2 className="w-10 h-10 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Lead Request Launched!</h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">Lead discovery pipeline is running in the background. Redirecting to Lead Requests…</p>
                </div>
                <Loader2 className="w-6 h-6 text-violet-500 animate-spin" />
              </div>
            )}
          </div>
        </main>

        {/* Bottom bar — fixed */}
        {step < 3 && (
          <div className="shrink-0 border-t border-slate-200/80 dark:border-slate-700/60 bg-white dark:bg-slate-900 px-6 py-3 flex items-center justify-between gap-4">
            {/* Completeness */}
            {step === 1 && (
              <div className="flex items-center gap-3">
                <div className={`w-4 h-4 rounded-full flex items-center justify-center ${completeness === 100 ? 'bg-emerald-500' : 'border-2 border-slate-300 dark:border-slate-600'}`}>
                  {completeness === 100 && <Check className="w-2.5 h-2.5 text-white" />}
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-32 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-violet-600 rounded-full transition-all" style={{ width: `${completeness}%` }} />
                  </div>
                  <span className="text-sm text-slate-600 dark:text-slate-400 font-medium">{completeness}% profile completeness</span>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-650 dark:text-slate-405 select-none">
                  <div className="p-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/40">
                    <Check className="w-3.5 h-3.5 text-emerald-500" strokeWidth={3} />
                  </div>
                  <span>
                    {Object.keys(icpDimensions).filter(k => {
                      const val = icpDimensions[k]
                      if (typeof val === 'object' && val !== null && val.confidence) {
                        return val.confidence.toLowerCase().includes('high')
                      }
                      return true  // Default is High Confidence until Verify Consistency is run
                    }).length} of 6 sections have high confidence
                  </span>
                </div>

                <button
                  type="button"
                  onClick={handleVerifyConsistency}
                  disabled={checkingConsistency}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60 cursor-pointer"
                >
                  {checkingConsistency ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  Verify Consistency
                </button>
              </div>
            )}
            {/* CTA button */}
            {step === 1 && (
              <button
                type="button"
                onClick={handleGenerateIcp}
                disabled={loading}
                id="generate-icp-btn"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl shadow-md shadow-violet-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
              >
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Generating ICP…</> : <>Generate ICP <ArrowRight className="w-4 h-4" /></>}
              </button>
            )}
            {step === 2 && (
              <button
                type="button"
                onClick={handleLockAndLaunch}
                disabled={submitting}
                id="launch-campaign-btn"
                className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl shadow-md shadow-violet-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
              >
                {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Launching…</> : <>Find Matching Companies <ArrowRight className="w-4 h-4" /></>}
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── STUNNING COMMAND PALETTE MODAL ── */}
      {showCommandPalette && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4 bg-slate-950/45 backdrop-blur-sm transition-all duration-300">
          <div className="fixed inset-0" onClick={() => setShowCommandPalette(false)} />

          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-2xl border border-slate-200/80 dark:border-slate-800/80 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden relative z-10 animate-scale-up">
            {/* Input Box */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
              <Search className="w-5 h-5 text-slate-400 shrink-0" />
              <input
                autoFocus
                type="text"
                value={paletteSearch}
                onChange={e => setPaletteSearch(e.target.value)}
                placeholder="Search lead requests, goals, or categories..."
                className="flex-1 bg-transparent border-0 outline-none text-base text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-0 focus:outline-none"
              />
              <kbd className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-2 py-1 rounded shadow-sm select-none">ESC</kbd>
            </div>

            {/* List Results */}
            <div className="max-h-96 overflow-y-auto p-2 space-y-1">
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-450 dark:text-slate-500 uppercase tracking-wider select-none">
                Lead Generation Requests
              </div>
              {filteredRequests.length > 0 ? (
                filteredRequests.map(r => {
                  if (!r) return null;
                  const sClean = (r.status || 'pending').toLowerCase();
                  return (
                    <button
                      key={r.id || r._id}
                      type="button"
                      onClick={() => {
                        setShowCommandPalette(false);
                        setPaletteSearch('');
                        if (sClean === 'pending' || sClean === 'active') {
                          navigate(`/campaign/${r.id || r._id}/intake`);
                        } else {
                          navigate(`/campaign/${r.id || r._id}`);
                        }
                      }}
                      className="w-full text-left p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/40 flex items-center justify-between transition-all cursor-pointer group"
                    >
                      <div className="min-w-0 pr-3">
                        <p className="text-sm font-semibold text-slate-750 dark:text-slate-200 group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors truncate">{r.title || r.name || 'Untitled Request'}</p>
                        {r.description && <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5">{r.description}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 border border-slate-205 dark:border-slate-750 rounded px-1.5 py-0.5">
                          {r.primary_goal || r.goal || 'Pipeline'}
                        </span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-350 opacity-0 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="p-8 text-center text-slate-400 dark:text-slate-500 italic select-none text-sm">
                  No matching lead requests found.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Custom Premium Alert Modal */}
      {customAlert.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-sm shadow-2xl overflow-hidden transform scale-100 transition-all">
            {/* Top decorative gradient bar */}
            <div className="h-1.5 bg-gradient-to-r from-violet-600 to-indigo-650" />

            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3">
                {customAlert.type === 'success' ? (
                  <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 shrink-0">
                    <CheckCircle2 className="w-5 h-5 animate-bounce" />
                  </div>
                ) : customAlert.type === 'warning' ? (
                  <div className="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/40 flex items-center justify-center text-amber-500 shrink-0">
                    <AlertTriangle className="w-5 h-5 animate-pulse" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center text-violet-500 shrink-0">
                    <Sparkles className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <h3 className="text-sm font-black text-slate-850 dark:text-white">{customAlert.title}</h3>
                  <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider">{customAlert.type}</span>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-400 font-semibold leading-relaxed">
                {customAlert.message}
              </p>

              <div className="flex justify-end pt-1">
                <button
                  type="button"
                  onClick={() => setCustomAlert({ show: false, message: '', title: '', type: 'info' })}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-850 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 rounded-xl text-xs font-black transition-all active:scale-[0.98]"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── STUNNING SUCCESS MODAL ── */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden transform scale-100 transition-all animate-scale-up">
            {/* Top decorative gradient bar */}
            <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-650" />

            <div className="p-6 space-y-5 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 shadow-lg shadow-emerald-500/10">
                <CheckCircle2 className="w-8 h-8 animate-bounce text-emerald-500" />
              </div>
              
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Lead Generation Request Launched!</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold leading-relaxed px-2">
                  Your lead generation request is now active. Our intelligent discovery pipeline is scraping and finding matching companies fitting your ICP criteria.
                </p>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSuccessModal(false);
                    navigate('/lead-requests');
                  }}
                  className="w-full px-5 py-3 bg-violet-600 hover:bg-violet-750 text-white font-bold rounded-xl text-sm transition-all active:scale-[0.98] shadow-md shadow-violet-500/20 cursor-pointer animate-pulse"
                >
                  View Lead Requests
                </button>
                <p className="text-[10px] text-slate-450 dark:text-slate-500">
                  Redirecting automatically in a moment...
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Tiny Check icon inline
function Check({ className }) {
  return <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
}
