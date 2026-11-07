import { Layers, ChevronDown, X } from 'lucide-react'

const ACV_OPTIONS = ['Under $10k', '$10k to $25k', '$25k to $50k', '$50k to $100k', '$100k to $250k', '$250k+']
const DEPLOY_OPTIONS = ['SaaS', 'Self-hosted', 'Hybrid', 'On-Premise']
const PRICING_OPTIONS  = ['Per Seat', 'Usage Based', 'Flat', 'Open-Core', 'Freemium']
const GEOGRAPHIES = ['India', 'USA', 'UK', 'Europe', 'APAC', 'LATAM', 'Global']
const PREDEFINED_CATEGORIES = ['Healthcare', 'FinTech', 'SaaS', 'Analytics', 'Security', 'HR Tech', 'DevTools', 'EdTech']

export default function AdditionalDetails({ values, onChange, completeness }) {
  const set = (k) => (e) => onChange({ ...values, [k]: e.target.value })
  console.log('AdditionalDetails values:', values, 'completeness:', completeness)
  
  // Dynamically build category options including current value if not in predefined list
  const getCategoryOptions = () => {
    const options = [...PREDEFINED_CATEGORIES]
    if (values.productCategory && !PREDEFINED_CATEGORIES.includes(values.productCategory)) {
      options.push(values.productCategory)
    }
    return options.sort()
  }
  
  // Get display label for category option (add "(Other)" for non-predefined values)
  const getCategoryLabel = (category) => {
    return PREDEFINED_CATEGORIES.includes(category) ? category : `${category}`
  }
  
  // Dynamically build pricing options including current value if not in predefined list
  const getPricingOptions = () => {
    const options = [...PRICING_OPTIONS]
    if (values.pricingModel && !PRICING_OPTIONS.includes(values.pricingModel)) {
      options.push(values.pricingModel)
    }
    return options.sort()
  }
  
  // Get display label for pricing option (add "(Other)" for non-predefined values)
  const getPricingLabel = (pricing) => {
    return PRICING_OPTIONS.includes(pricing) ? pricing : `${pricing} (Other)`
  }

  const toggleGeo = (geo) => {
    const current = values.targetGeographies || []
    const next = current.includes(geo) ? current.filter(g => g !== geo) : [...current, geo]
    onChange({ ...values, targetGeographies: next })
  }

  return (
    <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100 dark:border-slate-800">
        <div className="p-2 bg-violet-50 dark:bg-violet-900/20 rounded-lg">
          <Layers className="w-4 h-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">Additional Product Details</span>
          <span className="ml-2 text-xs text-slate-400">(optional)</span>
        </div>
      </div>

      <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Product Category */}
        <FieldWrap label="Product Category" hint="Auto-suggest taxonomy for better ICP matching.">
          <SelectInput value={values.productCategory} onChange={set('productCategory')} placeholder="Type or search categories...">
            {getCategoryOptions().map(o => <option key={o} value={o}>{getCategoryLabel(o)}</option>)}
          </SelectInput>
        </FieldWrap>

        {/* One Liner */}
        <FieldWrap label="One liner" hint="Keep it under 15 words for maximum clarity.">
          <input
            type="text"
            value={values.oneLiner || ''}
            onChange={set('oneLiner')}
            placeholder="One sentence describing what you do"
            className="field-input"
          />
        </FieldWrap>

        {/* Deployment Model */}
        <FieldWrap label="Deployment Model" hint="Auto-suggest taxonomy for better ICP matching.">
          <SelectInput value={values.deploymentModel} onChange={set('deploymentModel')} placeholder="Type or search categories...">
            {DEPLOY_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </SelectInput>
        </FieldWrap>

        {/* Primary Value Proposition */}
        <FieldWrap label="Primary Value Proposition" hint="AI uses this to match against company pain points.">
          <input
            type="text"
            value={values.primaryValueProp || ''}
            onChange={set('primaryValueProp')}
            placeholder="What core problem do you solve?"
            className="field-input"
          />
        </FieldWrap>

        {/* Pricing Model */}
        <FieldWrap label="Pricing Model" hint="Helps AI estimate deal size and buyer budget fit.">
          <SelectInput value={values.pricingModel} onChange={set('pricingModel')} placeholder="Select pricing model">
            {PRICING_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </SelectInput>
        </FieldWrap>

        {/* Current Customers */}
        <FieldWrap label="Current Customers" hint="Used for lookalike company identification.">
          <input
            type="text"
            value={values.currentCustomers || ''}
            onChange={set('currentCustomers')}
            placeholder="Notable customers (comma separated)"
            className="field-input"
          />
        </FieldWrap>

        {/* Existing Competitors */}
        <FieldWrap label="Existing Competitors" hint="Helps AI identify whitespace and adjacency markets.">
          <input
            type="text"
            value={values.existingCompetitors || ''}
            onChange={set('existingCompetitors')}
            placeholder="Key competitors in your space"
            className="field-input"
          />
        </FieldWrap>

        {/* Deal Size / ACV Range */}
        <FieldWrap label="Deal Size / ACV Range" hint="Targets companies with matching budget authority.">
          <SelectInput value={values.dealSizeAcv} onChange={set('dealSizeAcv')} placeholder="Select ACV range">
            {ACV_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
          </SelectInput>
        </FieldWrap>

        {/* Target Geographies — full width */}
        <div className="md:col-span-2">
          <FieldWrap label="Target Geographies" hint="Filters company sourcing by HQ location. Pick from presets or type a custom region.">
            <div className="flex flex-wrap gap-2 px-4 py-3 border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800/50 min-h-[44px]">
              {(values.targetGeographies || []).map(g => (
                <span key={g} className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 text-xs font-medium rounded-lg">
                  {g}
                  <button type="button" onClick={() => toggleGeo(g)}><X className="w-3 h-3" /></button>
                </span>
              ))}
              <input
                type="text"
                placeholder="Type custom region & press Enter"
                className="flex-1 min-w-[160px] bg-transparent text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 outline-none"
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const val = e.target.value.trim()
                    if (val && !(values.targetGeographies || []).includes(val)) {
                      onChange({ ...values, targetGeographies: [...(values.targetGeographies || []), val] })
                    }
                    e.target.value = ''
                  }
                }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {GEOGRAPHIES.filter(g => !(values.targetGeographies || []).includes(g)).map(g => (
                <button
                  key={g}
                  type="button"
                  onClick={() => toggleGeo(g)}
                  className="px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 hover:text-violet-700 dark:hover:text-violet-400 hover:border-violet-300 dark:hover:border-violet-800 transition-all cursor-pointer"
                >
                  + {g}
                </button>
              ))}
            </div>
          </FieldWrap>
        </div>
      </div>
    </div>
  )
}

function FieldWrap({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  )
}

function SelectInput({ value, onChange, placeholder, children }) {
  return (
    <div className="relative">
      <select value={value || ''} onChange={onChange} className="w-full appearance-none px-4 py-2.5 pr-9 text-sm bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all">
        <option value="">{placeholder}</option>
        {children}
      </select>
      <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
    </div>
  )
}
