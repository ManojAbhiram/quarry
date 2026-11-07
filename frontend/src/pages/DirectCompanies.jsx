import { useState, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api } from '../api'
import { useLeads } from '../context/LeadContext'
import { UI } from '../config/constants'
import {
  Loader2, ArrowRight, ArrowLeft, Building2, Upload, X, FileText,
  CheckCircle2, AlertTriangle, Plus, Download, Users,
} from 'lucide-react'

const ROLE_SUGGESTIONS = ['CEO', 'Founder', 'CTO', 'CFO', 'CMO', 'VP Sales', 'VP Marketing', 'Head of Engineering', 'Head of Product', 'Owner']

export default function DirectCompanies() {
  const navigate = useNavigate()
  const { id: requestId } = useParams()
  const { refreshRequests, requests } = useLeads()

  const currentRequest = requests?.find(r => r && String(r.id || r._id || '') === String(requestId))

  const [companyInput, setCompanyInput] = useState('')
  const [companies, setCompanies] = useState([])
  const [roles, setRoles] = useState([])
  const [roleInput, setRoleInput] = useState('')

  const [parsing, setParsing] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [errors, setErrors] = useState({})
  const [showSuccessModal, setShowSuccessModal] = useState(false)
  const fileInputRef = useRef(null)

  // ── Companies ──────────────────────────────────────────────────────────────
  const addCompaniesFromInput = () => {
    const parts = companyInput
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(Boolean)
    if (parts.length === 0) return
    setCompanies(prev => {
      const seen = new Set(prev.map(c => c.toLowerCase()))
      const merged = [...prev]
      for (const p of parts) {
        if (!seen.has(p.toLowerCase())) {
          seen.add(p.toLowerCase())
          merged.push(p)
        }
      }
      return merged
    })
    setCompanyInput('')
    setErrors(e => ({ ...e, companies: null }))
  }

  const removeCompany = (i) => setCompanies(prev => prev.filter((_, idx) => idx !== i))

  const handleCsvUpload = async (file) => {
    if (!file) return
    setParsing(true)
    setErrors(e => ({ ...e, csv: null }))
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await api.parseCompaniesCsv(fd)
      const parsed = res?.companies || []
      setCompanies(prev => {
        const seen = new Set(prev.map(c => c.toLowerCase()))
        const merged = [...prev]
        for (const p of parsed) {
          if (!seen.has(p.toLowerCase())) {
            seen.add(p.toLowerCase())
            merged.push(p)
          }
        }
        return merged
      })
    } catch (err) {
      setErrors(e => ({ ...e, csv: err.message || 'Failed to parse CSV.' }))
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

  // ── Roles ──────────────────────────────────────────────────────────────────
  const addRole = (value) => {
    const v = (value ?? roleInput).trim()
    if (!v) return
    setRoles(prev => prev.some(r => r.toLowerCase() === v.toLowerCase()) ? prev : [...prev, v])
    setRoleInput('')
  }
  const removeRole = (i) => setRoles(prev => prev.filter((_, idx) => idx !== i))

  // ── Launch ───────────────────────────────────────────────────────────────
  const handleLaunch = async () => {
    if (companies.length === 0) {
      setErrors({ companies: 'Add at least one company.' })
      return
    }
    setSubmitting(true)
    setErrors({})
    try {
      await api.launchDirectCompanies({
        title: currentRequest?.title || currentRequest?.name || null,
        companies,
        target_roles: roles,
      }, requestId)
      await refreshRequests()
      setShowSuccessModal(true)
      setTimeout(() => navigate('/lead-requests'), UI.DIRECT_REDIRECT_MS)
    } catch (err) {
      setErrors({ submit: err.message || 'Failed to launch request.' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-slate-50 dark:bg-[#0f172a]">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-violet-600" />
          <span className="text-sm font-semibold text-violet-600 dark:text-violet-400">Direct Companies</span>
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white tracking-tight">Find Decision Makers</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-xl leading-relaxed">
            Provide the companies you already know — a single name, a comma-separated list, or a CSV upload —
            and choose which decision-maker roles to target. Quarry resolves each company and finds direct contacts.
          </p>
        </div>

        {/* Company input */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100">
              Companies <span className="text-rose-500">*</span>
            </label>
            <p className="text-xs text-slate-400 mt-0.5">Enter a single company, or a comma-separated list. Names or domains both work.</p>
          </div>

          <div className="flex gap-2">
            <textarea
              rows={2}
              value={companyInput}
              onChange={e => setCompanyInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCompaniesFromInput() }
              }}
              placeholder="e.g. Acme Inc, globex.com, Initech"
              className="flex-1 px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all resize-none"
            />
            <button
              type="button"
              onClick={addCompaniesFromInput}
              className="inline-flex items-center gap-1.5 px-4 self-stretch bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-all"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          {/* CSV upload */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors disabled:opacity-60"
            >
              {parsing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Upload CSV
            </button>
            <button
              type="button"
              onClick={downloadTemplate}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-violet-600 dark:text-violet-400 hover:underline"
            >
              <Download className="w-3.5 h-3.5" /> Download template
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={e => { handleCsvUpload(e.target.files?.[0]); e.target.value = '' }}
            />
          </div>
          {errors.csv && (
            <p className="text-xs text-rose-600 dark:text-rose-400">{errors.csv}</p>
          )}

          {/* Companies list */}
          {companies.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">{companies.length} compan{companies.length === 1 ? 'y' : 'ies'} added</p>
              <div className="flex flex-wrap gap-2">
                {companies.map((c, i) => (
                  <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-full border border-slate-200 dark:border-slate-700">
                    {c}
                    <button type="button" onClick={() => removeCompany(i)} className="text-slate-400 hover:text-rose-500">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          {errors.companies && (
            <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-700 dark:text-rose-400 text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />{errors.companies}
            </div>
          )}
        </div>

        {/* Target roles */}
        <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl p-6 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-violet-600" /> Target decision-maker roles
            </label>
            <p className="text-xs text-slate-400 mt-0.5">Which titles should we look for at each company? Leave empty to default to CEO / Founder / Owner.</p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={roleInput}
              onChange={e => setRoleInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addRole() } }}
              placeholder="e.g. VP of Sales"
              className="flex-1 px-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
            />
            <button
              type="button"
              onClick={() => addRole()}
              className="inline-flex items-center gap-1.5 px-4 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-sm font-semibold rounded-xl transition-all"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>

          {/* Suggestions */}
          <div className="flex flex-wrap gap-2">
            {ROLE_SUGGESTIONS.filter(s => !roles.some(r => r.toLowerCase() === s.toLowerCase())).map(s => (
              <button
                key={s}
                type="button"
                onClick={() => addRole(s)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold rounded-full border border-violet-200 dark:border-violet-800/50 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors"
              >
                <Plus className="w-3 h-3" /> {s}
              </button>
            ))}
          </div>

          {/* Selected roles */}
          {roles.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {roles.map((r, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-full border border-emerald-200 dark:border-emerald-800/40">
                  {r}
                  <button type="button" onClick={() => removeRole(i)} className="text-emerald-400 hover:text-rose-500">
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {errors.submit && (
          <div className="flex items-center gap-2 p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-800/50 rounded-xl text-rose-700 dark:text-rose-400 text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{errors.submit}{/Serper/i.test(errors.submit) && (<> <Link to="/profile" className="font-semibold underline">Go to Profile →</Link></>)}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center justify-between gap-4 pb-8">
          <button
            type="button"
            onClick={() => navigate('/new-request')}
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button
            type="button"
            onClick={handleLaunch}
            disabled={submitting}
            className="inline-flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-bold rounded-xl shadow-md shadow-violet-500/20 transition-all active:scale-95 disabled:opacity-60 cursor-pointer"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Launching…</> : <>Find Decision Makers <ArrowRight className="w-4 h-4" /></>}
          </button>
        </div>
      </div>

      {/* Success modal */}
      {showSuccessModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-indigo-600" />
            <div className="p-6 space-y-5 text-center">
              <div className="mx-auto w-16 h-16 rounded-full bg-emerald-50 dark:bg-emerald-950/40 flex items-center justify-center text-emerald-600 shadow-lg shadow-emerald-500/10">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">Request Launched!</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-semibold leading-relaxed px-2">
                  We're resolving your companies and finding direct decision makers in the background. Redirecting to Lead Requests…
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setShowSuccessModal(false); navigate('/lead-requests') }}
                className="w-full px-5 py-3 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded-xl text-sm transition-all active:scale-[0.98] shadow-md shadow-violet-500/20 cursor-pointer"
              >
                View Lead Requests
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
