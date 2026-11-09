import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Building2, CheckCircle2, Download, Plus, Upload, Users } from 'lucide-react'
import { api } from '../api'
import { useLeads } from '../context/LeadContext'
import { UI } from '../config/constants'
import { Button, Field, PageHeader } from '../components/kit'
import Backdrop from '../components/motion/Backdrop'
import { useFlip } from '../components/motion/useFlip'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import SearchKeyNotice, { useSearchKey } from './requests/SearchKeyNotice'
import ChipList from './direct/ChipList'

const ROLE_SUGGESTIONS = ['CEO', 'Founder', 'CTO', 'CFO', 'CMO', 'VP Sales', 'VP Marketing', 'Head of Engineering', 'Head of Product', 'Owner']
const NAME_MAX = 200
const CSV_MAX_BYTES = 2 * 1024 * 1024

/** Adds new, non-duplicate (case-insensitive) values after the existing ones. */
function mergeUnique(existing, incoming) {
  const seen = new Set(existing.map((c) => c.toLowerCase()))
  const merged = [...existing]
  for (const p of incoming) {
    if (!seen.has(p.toLowerCase())) {
      seen.add(p.toLowerCase())
      merged.push(p)
    }
  }
  return merged
}

export default function DirectCompanies() {
  const navigate = useNavigate()
  const { id: requestId } = useParams()
  const { refreshRequests, requests } = useLeads()
  const searchKey = useSearchKey()
  const pageRef = useRef(null)
  const companiesRef = useRef(null)
  const rolesRef = useRef(null)
  const fileInputRef = useRef(null)
  const redirectTimer = useRef(null)

  const currentRequest = requests?.find((r) => r && String(r.id || r._id || '') === String(requestId))

  const [companyInput, setCompanyInput] = useState('')
  const [companies, setCompanies] = useState([])
  const [roles, setRoles] = useState([])
  const [roleInput, setRoleInput] = useState('')
  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [notice, setNotice] = useState('')
  const [launched, setLaunched] = useState(false)

  const captureCompanies = useFlip(companiesRef, [companies.join('|')])
  const captureRoles = useFlip(rolesRef, [roles.join('|')])
  useStaggerIn(pageRef, { dependencies: [launched] })

  useEffect(() => () => clearTimeout(redirectTimer.current), [])

  const addCompaniesFromInput = () => {
    const parts = companyInput.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
    if (parts.length === 0) return setErrors((e) => ({ ...e, companyInput: 'Type a company name or domain first.' }))
    const tooLong = parts.filter((p) => p.length > NAME_MAX)
    if (tooLong.length) return setErrors((e) => ({ ...e, companyInput: `Each name must be under ${NAME_MAX} characters.` }))
    const merged = mergeUnique(companies, parts)
    const dupes = parts.length - (merged.length - companies.length)
    captureCompanies()
    setCompanies(merged)
    setCompanyInput('')
    setNotice(dupes > 0 ? `${dupes} already in the list, skipped.` : '')
    setErrors((e) => ({ ...e, companies: null, companyInput: null }))
  }

  const removeCompany = (i) => {
    captureCompanies()
    setCompanies((prev) => prev.filter((_, idx) => idx !== i))
  }

  const handleCsvUpload = async (file) => {
    if (!file) return
    setErrors((e) => ({ ...e, csv: null }))
    if (!/\.csv$/i.test(file.name)) return setErrors((e) => ({ ...e, csv: 'Choose a .csv file.' }))
    if (file.size > CSV_MAX_BYTES) return setErrors((e) => ({ ...e, csv: 'That file is over 2 MB. Split it into smaller files.' }))
    setParsing(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.parseCompaniesCsv(fd)
      const parsed = (res?.companies || []).filter(Boolean)
      if (parsed.length === 0) {
        setErrors((e) => ({ ...e, csv: 'No company names found in that file. Check it has a company_name column.' }))
      } else {
        captureCompanies()
        setCompanies((prev) => mergeUnique(prev, parsed))
        setNotice(`Added ${parsed.length} from ${file.name}.`)
        setErrors((e) => ({ ...e, companies: null }))
      }
    } catch (err) {
      setErrors((e) => ({ ...e, csv: err.message || 'Failed to parse CSV.' }))
    } finally {
      setParsing(false)
    }
  }

  const downloadTemplate = () => {
    const csv = 'company_name\nAcme Inc\nexample.com\nGlobex Corporation\n'
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'companies_template.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const addRole = (value) => {
    const v = (value ?? roleInput).trim()
    if (!v) return
    if (v.length > 80) return setErrors((e) => ({ ...e, role: 'Keep a role under 80 characters.' }))
    captureRoles()
    setRoles((prev) => mergeUnique(prev, [v]))
    setRoleInput('')
    setErrors((e) => ({ ...e, role: null }))
  }
  const removeRole = (i) => {
    captureRoles()
    setRoles((prev) => prev.filter((_, idx) => idx !== i))
  }

  const handleLaunch = async () => {
    if (companies.length === 0) return setErrors({ companies: 'Add at least one company.' })
    setSubmitting(true)
    setErrors({})
    try {
      await api.launchDirectCompanies({ title: currentRequest?.title || currentRequest?.name || null, companies, target_roles: roles }, requestId)
      await refreshRequests()
      setLaunched(true)
      redirectTimer.current = setTimeout(() => navigate('/lead-requests'), UI.DIRECT_REDIRECT_MS)
    } catch (err) {
      setErrors({ submit: err.message || 'Failed to launch request.' })
    } finally {
      setSubmitting(false)
    }
  }

  const suggestions = ROLE_SUGGESTIONS.filter((s) => !roles.some((r) => r.toLowerCase() === s.toLowerCase()))

  return (
    <div ref={pageRef} className="h-full w-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        {launched ? (
          <div className="card relative flex flex-col items-center px-6 py-14 text-center">
            <Backdrop />
            <span className="relative mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-lg shadow-emerald-600/25 ring-1 ring-white/30">
              <CheckCircle2 aria-hidden="true" className="h-8 w-8" />
            </span>
            <h1 className="relative text-2xl font-black tracking-tight text-ink">Request launched</h1>
            <p role="status" className="relative mt-2 max-w-md text-sm text-muted">
              Quarry is resolving your companies and finding decision makers in the background. You will be taken to your requests in a few seconds.
            </p>
            <Button className="relative mt-5" onClick={() => navigate('/lead-requests')}>
              View requests
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <div data-reveal>
              <p className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-primary-50 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary-800 ring-1 ring-primary-200/70 dark:bg-primary-950/60 dark:text-primary-300 dark:ring-primary-900/60">
                <Building2 aria-hidden="true" className="h-3.5 w-3.5" /> Direct companies
              </p>
              <PageHeader
                className="mb-0"
                title="Find decision makers"
                description="Give us the companies you already know, as a single name, a comma-separated list or a CSV, and choose which roles to target. Quarry resolves each company and finds direct contacts."
              />
            </div>

            <SearchKeyNotice state={searchKey} />

            {errors.submit && (
              <div role="alert" className="rounded-2xl border border-bad/30 bg-bad-soft p-3 text-sm text-bad">
                {errors.submit}
                {/Serper/i.test(errors.submit) && (
                  <>
                    {' '}
                    <Link to="/profile" className="font-semibold underline">
                      Go to Account settings
                    </Link>
                  </>
                )}
              </div>
            )}

            <section data-reveal aria-labelledby="companies-title" className="card space-y-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 text-white shadow-md ring-1 ring-white/30">
                  <Building2 aria-hidden="true" className="h-5 w-5" />
                </span>
                <h2 id="companies-title" className="pt-2 text-base font-bold tracking-tight text-ink">
                  Companies
                </h2>
              </div>
              <Field
                id="company-input"
                as="textarea"
                rows={2}
                label="Company names or domains"
                required
                value={companyInput}
                disabled={submitting}
                placeholder="e.g. Acme Inc, globex.com, Initech"
                hint="Press Enter to add. Use Shift+Enter for a new line."
                error={errors.companyInput}
                onChange={(e) => {
                  setCompanyInput(e.target.value)
                  if (errors.companyInput) setErrors((x) => ({ ...x, companyInput: null }))
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    addCompaniesFromInput()
                  }
                }}
              />
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={addCompaniesFromInput} disabled={submitting}>
                  <Plus aria-hidden="true" className="h-4 w-4" /> Add
                </Button>
                <Button variant="secondary" loading={parsing} disabled={submitting} onClick={() => fileInputRef.current?.click()}>
                  {!parsing && <Upload aria-hidden="true" className="h-4 w-4" />} Upload CSV
                </Button>
                <Button variant="ghost" onClick={downloadTemplate}>
                  <Download aria-hidden="true" className="h-4 w-4" /> Download template
                </Button>
                <input ref={fileInputRef} type="file" accept=".csv" aria-label="Upload a CSV of companies" className="hidden" onChange={(e) => { handleCsvUpload(e.target.files?.[0]); e.target.value = '' }} />
              </div>
              {errors.csv && (
                <p role="alert" className="text-sm font-medium text-bad">
                  {errors.csv}
                </p>
              )}
              {notice && (
                <p role="status" className="text-xs text-muted">
                  {notice}
                </p>
              )}
              <div ref={companiesRef}>
                {companies.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted">
                      {companies.length} {companies.length === 1 ? 'company' : 'companies'} added
                    </p>
                    <ChipList items={companies} label="Companies added" onRemove={removeCompany} />
                  </div>
                )}
              </div>
              {errors.companies && (
                <p role="alert" className="rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">
                  {errors.companies}
                </p>
              )}
            </section>

            <section data-reveal aria-labelledby="roles-title" className="card space-y-4 p-5 sm:p-6">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500 to-accent-600 text-white shadow-md ring-1 ring-white/30">
                  <Users aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="roles-title" className="text-base font-bold tracking-tight text-ink">
                    Target roles
                  </h2>
                  <p className="text-xs text-muted">Which titles should we look for? Leave empty to default to CEO, Founder or Owner.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Field
                  id="role-input"
                  label="Add a role"
                  className="flex-1"
                  value={roleInput}
                  disabled={submitting}
                  placeholder="e.g. VP of Sales"
                  error={errors.role}
                  onChange={(e) => {
                    setRoleInput(e.target.value)
                    if (errors.role) setErrors((x) => ({ ...x, role: null }))
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addRole()
                    }
                  }}
                />
                <Button variant="secondary" className="mt-[1.9rem]" onClick={() => addRole()} aria-label="Add role">
                  <Plus aria-hidden="true" className="h-4 w-4" /> Add
                </Button>
              </div>
              {suggestions.length > 0 && (
                <div role="group" aria-label="Suggested roles" className="flex flex-wrap gap-1">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => addRole(s)} className="inline-flex h-10 items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-3 text-xs font-semibold text-primary-800 transition-colors hover:bg-primary-100 dark:border-primary-900/60 dark:bg-primary-950/50 dark:text-primary-300">
                      <Plus aria-hidden="true" className="h-3 w-3" /> {s}
                    </button>
                  ))}
                </div>
              )}
              <div ref={rolesRef}>{roles.length > 0 && <ChipList items={roles} label="Roles selected" tone="ok" onRemove={removeRole} />}</div>
            </section>

            <div data-reveal className="flex flex-wrap items-center justify-between gap-3 pb-8">
              <Button variant="ghost" onClick={() => navigate('/new-request')}>
                <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
              </Button>
              <Button onClick={handleLaunch} loading={submitting}>
                {submitting ? 'Launching…' : <>Find decision makers <ArrowRight aria-hidden="true" className="h-4 w-4" /></>}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
