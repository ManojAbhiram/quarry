import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowRight, ArrowLeft, CheckCircle2, AlertTriangle, Sparkles, Save } from 'lucide-react'
import { api } from '../api'
import { useLeads } from '../context/LeadContext'
import { UI } from '../config/constants'
import { Button, Field, PageHeader, useToast } from '../components/kit'
import WorkflowSidebar from '../components/request/WorkflowSidebar'
import SourceTabs from '../components/request/SourceTabs'
import AdditionalDetails from '../components/request/AdditionalDetails'
import IcpCard from '../components/request/IcpCard'
import StepTransition from '../components/request/StepTransition'
import Reveal from '../components/motion/Reveal'
import SearchKeyNotice, { useSearchKey } from './requests/SearchKeyNotice'
import CommandPalette from './requests/CommandPalette'

const DIMENSION_KEYS = ['firmographic', 'technographic', 'team_structure', 'buying_signals', 'compliance', 'deployment_pref']

const errorText = (err, fallback) => (err?.isNetworkError ? "Couldn't reach Quarry. Check your connection and try again." : err?.message || fallback)

function InlineError({ children }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md bg-bad-soft p-3 text-sm text-bad">
      <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">
        {children}
      </span>
    </div>
  )
}

export default function NewRequest() {
  const navigate = useNavigate()
  const toast = useToast()
  const { id: requestId } = useParams()
  const { refreshRequests, requests } = useLeads()
  const searchKey = useSearchKey()

  // Quick switcher (Ctrl/Cmd+K)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [paletteSearch, setPaletteSearch] = useState('')

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setShowCommandPalette((prev) => !prev)
      }
      if (e.key === 'Escape') setShowCommandPalette(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  const currentRequest = requests?.find((r) => r && String(r.id || r._id || '') === String(requestId))

  const paletteQuery = paletteSearch.toLowerCase()
  const filteredRequests =
    requests?.filter(
      (r) =>
        r &&
        ((r.title || r.name || '').toLowerCase().includes(paletteQuery) ||
          (r.primary_goal || r.goal || '').toLowerCase().includes(paletteQuery) ||
          (r.description || '').toLowerCase().includes(paletteQuery)),
    ) || []

  // Wizard state
  const [step, setStep] = useState(1)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingConsistency, setCheckingConsistency] = useState(false)
  const [errors, setErrors] = useState({})
  const [consistencyResult, setConsistencyResult] = useState(null)
  const userOverrodeStep = useRef(false)
  const [launched, setLaunched] = useState(false)

  // Source tab state
  const [activeTab, setActiveTab] = useState('describe')
  const [description, setDescription] = useState('')
  const [websiteUrlInput, setWebsiteUrlInput] = useState('')
  const [scrapedUrls, setScrapedUrls] = useState([])
  const [scraping, setScraping] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState([])

  const [productName, setProductName] = useState('')
  const [numLeads, setNumLeads] = useState(10)

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

  const mainRef = useRef(null)
  // The submit buttons live in the footer, so bring a new error into view.
  useEffect(() => {
    mainRef.current?.querySelector('[role="alert"]')?.scrollIntoView?.({ block: 'nearest' })
  }, [errors])

  const busy = loading || submitting || saving || checkingConsistency

  // Redirect to the list a few seconds after launching.
  useEffect(() => {
    if (!launched) return undefined
    const timer = setTimeout(() => navigate('/lead-requests'), UI.REQUEST_REDIRECT_MS)
    return () => clearTimeout(timer)
  }, [launched, navigate])

  // Load draft data if available
  useEffect(() => {
    if (!currentRequest) return
    if (currentRequest.title) {
      const name = currentRequest.title.endsWith(' Lead Request') ? currentRequest.title.slice(0, -13) : currentRequest.title
      setProductName((prev) => prev || name)
    }
    if (currentRequest.description) setDescription((prev) => prev || currentRequest.description)
    if (currentRequest.product_intake) {
      const pi = currentRequest.product_intake
      if (pi.product_name) setProductName((prev) => prev || pi.product_name)
      setDetails((d) => ({
        productCategory: pi.product_category || d.productCategory,
        oneLiner: pi.one_liner || d.oneLiner,
        deploymentModel: pi.deployment_model || d.deploymentModel,
        primaryValueProp: pi.primary_value_prop || d.primaryValueProp,
        pricingModel: pi.pricing_model || d.pricingModel,
        currentCustomers: pi.current_customers || d.currentCustomers,
        existingCompetitors: pi.existing_competitors || d.existingCompetitors,
        dealSizeAcv: pi.deal_size_acv || d.dealSizeAcv,
        targetGeographies: pi.target_geographies ? (typeof pi.target_geographies === 'string' ? pi.target_geographies.split(', ') : pi.target_geographies) : d.targetGeographies,
        productDescription: pi.product_description || d.productDescription,
      }))
    } else {
      setDetails((d) => ({
        ...d,
        productCategory: currentRequest.business_type || d.productCategory,
        oneLiner: currentRequest.description || d.oneLiner,
        dealSizeAcv: currentRequest.target_team_size || d.dealSizeAcv,
        targetGeographies: currentRequest.target_location ? currentRequest.target_location.split(', ') : d.targetGeographies,
        productDescription: currentRequest.description || d.productDescription,
      }))
    }
    if (currentRequest.icp_dimensions) {
      setIcpDimensions(currentRequest.icp_dimensions)
      if (!userOverrodeStep.current) {
        const pi = currentRequest.product_intake
        const hasValidIntake = pi && pi.product_name && pi.product_name.trim() !== '' && pi.product_name !== 'Generic Product'
        if (hasValidIntake) setStep(2)
      }
    }
  }, [currentRequest])

  const buildIntake = (extra = {}) => ({
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
    request_goal: 'net-new pipeline',
    product_description: details.productDescription || '',
    ...extra,
  })

  const leadsCount = parseInt(numLeads, 10)
  const leadsValid = Number.isInteger(leadsCount) && leadsCount >= 1 && leadsCount <= 1000 && String(numLeads).trim() === String(leadsCount)

  const handleSaveDraft = async () => {
    if (!requestId || saving) return
    setSaving(true)
    try {
      await api.updateLeadRequest(requestId, {
        product_intake: buildIntake({ num_leads: leadsValid ? leadsCount : 10 }),
        icp_dimensions: icpDimensions,
        status: 'Draft',
      })
      await refreshRequests()
      toast.push({ type: 'success', message: 'Draft saved.' })
    } catch (err) {
      toast.push({ type: 'error', message: `Couldn't save the draft: ${errorText(err, 'unknown error')}` })
    } finally {
      setSaving(false)
    }
  }

  // Saves ICP changes made on step 2 in the background; tells the user if it did not work.
  const autoSaveIcp = (icp) => {
    if (!requestId) return
    api
      .updateLeadRequest(requestId, { icp_dimensions: icp, status: 'Draft' })
      .then(refreshRequests)
      .catch((err) => toast.push({ type: 'error', message: `Your change is on this page but was not saved: ${errorText(err, 'unknown error')}` }))
  }

  // Profile completeness: how many of the 11 input fields have something in them.
  const completeness = Math.round(
    ([
      productName,
      description || scrapedUrls.length || uploadedFiles.length,
      details.productCategory, details.oneLiner, details.deploymentModel,
      details.primaryValueProp, details.pricingModel, details.currentCustomers,
      details.existingCompetitors, details.dealSizeAcv,
      (details.targetGeographies || []).length > 0 ? 'x' : '',
    ].filter(Boolean).length / 11) * 100,
  )

  const handleScrape = async () => {
    if (scraping) return
    if (!websiteUrlInput.trim()) {
      setErrors((e) => ({ ...e, website: 'Enter a URL to scrape.' }))
      return
    }
    setScraping(true)
    setErrors((e) => ({ ...e, website: null }))
    try {
      const fd = new FormData()
      let url = websiteUrlInput.trim()
      if (!url.startsWith('http')) url = 'https://' + url
      fd.append('urls', url)
      const result = await api.analyzeSource(fd)
      setScrapedUrls((prev) => [...prev, { url, summary: result?.one_liner || result?.primary_value_prop || '' }])
      if (result) {
        if (result.product_name && !productName) setProductName(result.product_name)
        setDetails((d) => ({
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
      setErrors((e) => ({ ...e, website: errorText(err, 'Scraping failed.') }))
    } finally {
      setScraping(false)
    }
  }

  const handleGenerateIcp = async (e) => {
    e?.preventDefault?.()
    if (loading) return
    const next = {}
    if (!productName.trim() && !description.trim() && scrapedUrls.length === 0 && uploadedFiles.length === 0) {
      next.product = 'Enter a product name or a description.'
    }
    if (!leadsValid) next.numLeads = 'Enter a whole number between 1 and 1,000.'
    if (Object.keys(next).length) {
      setErrors(next)
      return
    }
    setErrors({})
    setLoading(true)
    try {
      // If files/description not yet analyzed, run analysis first
      let extraData = {}
      if ((description.trim() || uploadedFiles.length > 0) && !scrapedUrls.length) {
        const fd = new FormData()
        if (description.trim()) fd.append('description', description.trim())
        uploadedFiles.forEach((f) => fd.append('files', f))
        const res = await api.analyzeSource(fd)
        if (res) extraData = res
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
        request_goal: 'net-new pipeline',
        product_description: details.productDescription || extraData.description || '',
        num_leads: leadsCount,
      }
      const icp = await api.generateStructuredIcp(payload, requestId)
      setIcpDimensions(icp)

      if (requestId) {
        try {
          await api.updateLeadRequest(requestId, { product_intake: payload, icp_dimensions: icp, status: 'Draft' })
          await refreshRequests()
        } catch (saveErr) {
          toast.push({ type: 'error', message: `The ICP was generated but the draft was not saved: ${errorText(saveErr, 'unknown error')}` })
        }
      }

      userOverrodeStep.current = false // Clear override since we just generated fresh ICP
      setStep(2)
      setConsistencyResult(null)
    } catch (err) {
      setErrors({ generate: errorText(err, 'ICP generation failed.') })
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyConsistency = async () => {
    if (checkingConsistency) return
    setCheckingConsistency(true)
    setErrors({})
    try {
      const r = await api.checkIcpConsistency(icpDimensions)
      setConsistencyResult(r)

      // Update confidence and warnings per dimension based on the consistency result
      if (r && (r.consistent || (r.warnings && r.warnings.length > 0))) {
        const dimensionLabels = {
          firmographic: 'firmographic',
          technographic: 'technographic',
          team_structure: 'team structure & decision makers',
          buying_signals: 'buying signal',
          compliance: 'compliance',
          deployment_pref: 'deployment',
        }
        const updatedIcp = { ...icpDimensions }
        for (const key of DIMENSION_KEYS) {
          const val = updatedIcp[key]
          const isObj = typeof val === 'object' && val !== null
          const textVal = isObj ? val.value : val
          const related = r.consistent
            ? []
            : r.warnings.filter((w) => w.toLowerCase().includes(dimensionLabels[key]) || w.toLowerCase().includes(key.replace('_', ' ')))
          updatedIcp[key] = related.length
            ? { value: textVal || '', confidence: 'Low Confidence', warning: related[0] }
            : { value: textVal || '', confidence: isObj && !r.consistent ? val.confidence || 'High Confidence' : 'High Confidence', warning: null }
        }
        setIcpDimensions(updatedIcp)
        autoSaveIcp(updatedIcp)
      }
    } catch (err) {
      setErrors({ consistency: errorText(err, 'The consistency check failed.') })
    } finally {
      setCheckingConsistency(false)
    }
  }

  const handleLockAndLaunch = async () => {
    if (submitting) return
    setSubmitting(true)
    setErrors({})
    try {
      await api.createRequest({ product_intake: buildIntake(), icp_dimensions: icpDimensions, num_leads: leadsValid ? leadsCount : 10 }, requestId)
      await refreshRequests()
      setLaunched(true)
    } catch (err) {
      setErrors({ submit: errorText(err, 'Failed to launch the request.') })
    } finally {
      setSubmitting(false)
    }
  }

  const stepError = errors.generate || (step === 2 && (errors.product || errors.numLeads)) || ''
  const highConfidence = DIMENSION_KEYS.filter((k) => {
    const val = icpDimensions[k]
    if (typeof val === 'object' && val !== null && val.confidence) return val.confidence.toLowerCase().includes('high')
    return true // Default is high confidence until Verify consistency is run
  }).length

  return (
    <div className="flex h-full bg-app">
      <WorkflowSidebar isCollapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed((p) => !p)} step={step} />

      <div className="flex min-w-0 flex-1 flex-col">
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
            {launched ? (
              <div className="card flex flex-col items-center px-6 py-14 text-center shadow-lift">
                <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-lg shadow-emerald-600/30 ring-1 ring-white/30">
                  <CheckCircle2 aria-hidden="true" className="h-8 w-8" />
                </span>
                <h1 className="text-2xl font-black tracking-tight text-ink">Request launched</h1>
                <p className="mt-2 max-w-md text-sm text-muted">Quarry is finding companies that match your ICP. Open the list to follow its progress. You will be taken there in a few seconds.</p>
                <Button className="mt-5" onClick={() => navigate('/lead-requests')}>
                  View requests
                </Button>
              </div>
            ) : (
              <StepTransition stepKey={step}>
            {step === 1 ? (
              <form onSubmit={handleGenerateIcp} noValidate className="space-y-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted lg:hidden">Step 1 of 2</p>
                <PageHeader
                  className="mb-0"
                  title="Describe your product"
                  description="Quarry uses this to generate an Ideal Customer Profile (ICP) and find matching companies. The more detail you give, the closer the match."
                />

                <SearchKeyNotice state={searchKey} />
                {errors.generate && <InlineError>{errors.generate}</InlineError>}

                <div className="card space-y-5 p-5">
                  <Field
                    id="product-name"
                    label="Product name"
                    required
                    value={productName}
                    disabled={loading}
                    placeholder="e.g. Quarry"
                    hint="The name customers will see and search for."
                    error={errors.product}
                    onChange={(e) => {
                      setProductName(e.target.value)
                      if (errors.product) setErrors((x) => ({ ...x, product: null }))
                    }}
                  />
                </div>

                <SourceTabs
                  activeTab={activeTab}
                  onTabChange={setActiveTab}
                  description={description}
                  onDescriptionChange={(v) => {
                    setDescription(v)
                    if (errors.product) setErrors((x) => ({ ...x, product: null }))
                  }}
                  websiteUrlInput={websiteUrlInput}
                  onWebsiteUrlInputChange={setWebsiteUrlInput}
                  scrapedUrls={scrapedUrls}
                  onScrape={handleScrape}
                  scraping={scraping}
                  onRemoveUrl={(i) => setScrapedUrls((prev) => prev.filter((_, idx) => idx !== i))}
                  uploadedFiles={uploadedFiles}
                  onFilesChange={setUploadedFiles}
                  onRemoveFile={(i) => setUploadedFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  errors={errors}
                  productName={productName}
                  productCategory={details.productCategory}
                  disabled={loading}
                />

                <AdditionalDetails values={details} onChange={setDetails} disabled={loading} />

                <div className="card p-5">
                  <Field
                    id="num-leads"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="1000"
                    label="Number of leads"
                    value={numLeads}
                    disabled={loading}
                    hint="How many companies to aim for, from 1 to 1,000."
                    error={errors.numLeads}
                    onChange={(e) => {
                      setNumLeads(e.target.value)
                      if (errors.numLeads) setErrors((x) => ({ ...x, numLeads: null }))
                    }}
                  />
                </div>

              </form>
            ) : (
              <div className="space-y-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted lg:hidden">Step 2 of 2</p>
                <PageHeader
                  className="mb-0"
                  title="ICP definition"
                  description="Review the Ideal Customer Profile Quarry generated. Each card is one dimension of your target market; edit any of them to sharpen the match."
                />

                <SearchKeyNotice state={searchKey} />
                {stepError && <InlineError>{stepError}</InlineError>}
                {errors.consistency && <InlineError>{errors.consistency}</InlineError>}
                {errors.submit && (
                  <InlineError>
                    {errors.submit}
                    {/Serper|search key/i.test(errors.submit) && (
                      <>
                        {' '}
                        <Link to="/profile" className="font-semibold underline">
                          Open Account settings
                        </Link>
                      </>
                    )}
                  </InlineError>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="secondary" loading={loading} disabled={busy && !loading} onClick={handleGenerateIcp}>
                    {!loading && <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />}
                    Regenerate ICP
                  </Button>
                  <Button variant="secondary" loading={checkingConsistency} disabled={busy && !checkingConsistency} onClick={handleVerifyConsistency}>
                    {!checkingConsistency && <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />}
                    Verify consistency
                  </Button>
                  <Button variant="secondary" loading={saving} disabled={busy && !saving} onClick={handleSaveDraft}>
                    {!saving && <Save aria-hidden="true" className="h-3.5 w-3.5" />}
                    Save draft
                  </Button>
                  <Button
                    variant="ghost"
                   
                    disabled={busy}
                    onClick={() => {
                      userOverrodeStep.current = true
                      setStep(1)
                    }}
                  >
                    <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" /> Modify inputs
                  </Button>
                </div>

                {consistencyResult && (
                  <div role="status" className={`flex items-start gap-3 rounded-md p-3 text-sm ${consistencyResult.consistent ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn'}`}>
                    {consistencyResult.consistent ? <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div className="min-w-0">
                      <p className="font-semibold">{consistencyResult.consistent ? 'No contradictions found' : 'Contradictions found'}</p>
                      {!consistencyResult.consistent && (
                        <ul className="mt-1 list-disc space-y-1 pl-4 text-xs">
                          {consistencyResult.warnings?.map((w, i) => (
                            <li key={i} className="break-words">{w}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

                <Reveal className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {DIMENSION_KEYS.map((key) => (
                    <IcpCard
                      key={key}
                      dimensionKey={key}
                      value={icpDimensions[key]}
                      editing={editingCard === key}
                      draft={editDraft}
                      onChangeDraft={setEditDraft}
                      onStartEdit={(k) => {
                        setEditingCard(k)
                        const val = icpDimensions[k]
                        const isObj = typeof val === 'object' && val !== null
                        setEditDraft((isObj ? val.value : val) || '')
                      }}
                      onSave={(k) => {
                        const prevVal = icpDimensions[k]
                        const isObj = typeof prevVal === 'object' && prevVal !== null
                        const updated = {
                          value: editDraft,
                          confidence: isObj ? prevVal.confidence || 'High Confidence' : 'High Confidence',
                          warning: isObj ? prevVal.warning || null : null,
                        }
                        const newIcp = { ...icpDimensions, [k]: updated }
                        setIcpDimensions(newIcp)
                        setEditingCard(null)
                        setConsistencyResult(null)
                        autoSaveIcp(newIcp)
                      }}
                      onCancel={() => setEditingCard(null)}
                    />
                  ))}
                </Reveal>
              </div>
            )}
              </StepTransition>
            )}
          </div>
        </main>

        {!launched && (
          <footer className="shrink-0 border-t border-line bg-surface/80 px-4 py-3 shadow-lift backdrop-blur-xl sm:px-6">
            <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
              {step === 1 ? (
                <div className="flex items-center gap-3">
                  <div role="progressbar" aria-label="Profile completeness" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness} className="h-2 w-28 overflow-hidden rounded-full bg-head ring-1 ring-inset ring-line">
                    <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-accent-500 shadow-[0_0_10px_rgb(var(--p-500)/0.5)] transition-[width] duration-500" style={{ width: `${completeness}%` }} />
                  </div>
                  <span className="text-sm tabular-nums text-muted">{completeness}% filled in</span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm tabular-nums text-muted">{highConfidence} of 6 sections high confidence</span>
                </div>
              )}

              {step === 1 ? (
                <Button id="generate-icp-btn" loading={loading} onClick={handleGenerateIcp}>
                  {loading ? 'Generating ICP…' : 'Generate ICP'}
                  {!loading && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
                </Button>
              ) : (
                <Button id="launch-request-btn" loading={submitting} disabled={busy && !submitting} onClick={handleLockAndLaunch}>
                  {submitting ? 'Launching…' : 'Find matching companies'}
                  {!submitting && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
                </Button>
              )}
            </div>
          </footer>
        )}
      </div>

      <CommandPalette
        open={showCommandPalette}
        query={paletteSearch}
        onQuery={setPaletteSearch}
        requests={filteredRequests}
        onClose={() => setShowCommandPalette(false)}
        onPick={(r) => {
          setShowCommandPalette(false)
          setPaletteSearch('')
          const status = (r.status || 'pending').toLowerCase()
          navigate(status === 'pending' || status === 'active' ? `/request/${r.id || r._id}/intake` : `/request/${r.id || r._id}`)
        }}
      />
    </div>
  )
}
