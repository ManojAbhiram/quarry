import { useId, useState } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { Field } from '../kit'

const ACV_OPTIONS = ['Under $10k', '$10k to $25k', '$25k to $50k', '$50k to $100k', '$100k to $250k', '$250k+']
const DEPLOY_OPTIONS = ['SaaS', 'Self-hosted', 'Hybrid', 'On-Premise']
const PRICING_OPTIONS = ['Per Seat', 'Usage Based', 'Flat', 'Open-Core', 'Freemium']
const GEOGRAPHIES = ['India', 'USA', 'UK', 'Europe', 'APAC', 'LATAM', 'Global']
const PREDEFINED_CATEGORIES = ['Healthcare', 'FinTech', 'SaaS', 'Analytics', 'Security', 'HR Tech', 'DevTools', 'EdTech']

function Select({ options, placeholder, ...props }) {
  return (
    <Field as="select" {...props}>
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </Field>
  )
}

/** Optional product details. Collapsible so the required inputs stay in view; the values are the same as before. */
export default function AdditionalDetails({ values, onChange, disabled = false }) {
  const [open, setOpen] = useState(true)
  const [geoDraft, setGeoDraft] = useState('')
  const panelId = useId()
  const set = (k) => (e) => onChange({ ...values, [k]: e.target.value })
  const geos = values.targetGeographies || []

  // A value that came from analysis or a saved draft may not be one of the presets: keep it selectable.
  const categories = [...PREDEFINED_CATEGORIES, ...(values.productCategory && !PREDEFINED_CATEGORIES.includes(values.productCategory) ? [values.productCategory] : [])].sort()
  const pricing = [...PRICING_OPTIONS, ...(values.pricingModel && !PRICING_OPTIONS.includes(values.pricingModel) ? [values.pricingModel] : [])].sort()

  const toggleGeo = (geo) => onChange({ ...values, targetGeographies: geos.includes(geo) ? geos.filter((g) => g !== geo) : [...geos, geo] })

  const addCustomGeo = () => {
    const val = geoDraft.trim()
    if (val && !geos.includes(val)) onChange({ ...values, targetGeographies: [...geos, val] })
    setGeoDraft('')
  }

  return (
    <section className="card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[3rem] w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-head"
      >
        <span>
          <span className="text-base font-semibold text-ink">Additional product details</span>
          <span className="ml-2 text-xs text-muted">Optional</span>
        </span>
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div id={panelId} className="grid grid-cols-1 gap-5 border-t border-line p-5 md:grid-cols-2">
          <Select label="Product category" placeholder="Select a category" options={categories} value={values.productCategory || ''} onChange={set('productCategory')} disabled={disabled} hint="Helps match the right taxonomy." />
          <Field label="One-liner" value={values.oneLiner || ''} onChange={set('oneLiner')} disabled={disabled} placeholder="One sentence describing what you do" hint="Under 15 words reads best." />
          <Select label="Deployment model" placeholder="Select a model" options={DEPLOY_OPTIONS} value={values.deploymentModel || ''} onChange={set('deploymentModel')} disabled={disabled} />
          <Field label="Primary value proposition" value={values.primaryValueProp || ''} onChange={set('primaryValueProp')} disabled={disabled} placeholder="What core problem do you solve?" hint="Matched against company pain points." />
          <Select label="Pricing model" placeholder="Select a pricing model" options={pricing} value={values.pricingModel || ''} onChange={set('pricingModel')} disabled={disabled} />
          <Field label="Current customers" value={values.currentCustomers || ''} onChange={set('currentCustomers')} disabled={disabled} placeholder="Notable customers, comma separated" hint="Used to find lookalike companies." />
          <Field label="Existing competitors" value={values.existingCompetitors || ''} onChange={set('existingCompetitors')} disabled={disabled} placeholder="Key competitors in your space" />
          <Select label="Deal size / ACV range" placeholder="Select an ACV range" options={ACV_OPTIONS} value={values.dealSizeAcv || ''} onChange={set('dealSizeAcv')} disabled={disabled} />

          <div className="md:col-span-2">
            <span className="label" id={`${panelId}-geo`}>
              Target geographies
            </span>
            <div className="flex min-h-[2.5rem] flex-wrap items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5">
              {geos.map((g) => (
                <span key={g} className="inline-flex items-center gap-1 rounded-md bg-primary-50 px-2 py-1 text-xs font-medium text-primary-800 dark:bg-primary-950/60 dark:text-primary-300">
                  {g}
                  <button type="button" aria-label={`Remove ${g}`} disabled={disabled} onClick={() => toggleGeo(g)} className="-mr-1 flex h-5 w-5 items-center justify-center rounded hover:bg-primary-100 dark:hover:bg-primary-900">
                    <X aria-hidden="true" className="h-3 w-3" />
                  </button>
                </span>
              ))}
              <input
                type="text"
                aria-labelledby={`${panelId}-geo`}
                value={geoDraft}
                disabled={disabled}
                placeholder="Type a region and press Enter"
                className="min-w-[10rem] flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/80"
                onChange={(e) => setGeoDraft(e.target.value)}
                onBlur={addCustomGeo}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addCustomGeo()
                  }
                }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">Limits company sourcing by headquarters location.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {GEOGRAPHIES.filter((g) => !geos.includes(g)).map((g) => (
                <button
                  key={g}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleGeo(g)}
                  className="inline-flex h-10 items-center rounded-md border border-line px-3 text-xs font-medium text-muted transition-colors hover:bg-head hover:text-ink sm:h-8"
                >
                  + {g}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
