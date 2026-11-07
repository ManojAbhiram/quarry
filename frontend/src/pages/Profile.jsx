import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import { UI } from '../config/constants'
import { User, Mail, Building2, Briefcase, Phone, ShieldAlert, UserCircle2, Save, Trash2, CheckCircle2, KeyRound } from 'lucide-react'

function Section({ id, title, description, icon, children, isDanger }) {
  return (
    <div id={id} className={`card p-8 mb-8 ${isDanger ? 'border-rose-200/50 dark:border-rose-800/50 bg-rose-50/10 dark:bg-rose-900/10' : ''}`}>
      <div className="flex items-start gap-4 mb-8">
        <div className={`p-3 rounded-xl ${isDanger ? 'bg-rose-100 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400' : 'bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400'}`}>
          {icon}
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          {description && <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{description}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function Profile() {
  const { user, logout, updateUser } = useAuth()

  const [profile, setProfile] = useState({
    name: user?.name || '',
    email: user?.email || '',
    company: user?.company || '',
    job_title: user?.job_title || '',
    phone: user?.phone || '',
  })
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Serper API key (per-user integration)
  const [serperStatus, setSerperStatus] = useState({ has_key: false, masked: null })
  const [serperInput, setSerperInput] = useState('')
  const [serperSaving, setSerperSaving] = useState(false)
  const [serperError, setSerperError] = useState('')
  const [serperSaved, setSerperSaved] = useState(false)

  useEffect(() => {
    if (user) {
      setProfile({
        name: user.name || '',
        email: user.email || '',
        company: user.company || '',
        job_title: user.job_title || '',
        phone: user.phone || '',
      })
    }
  }, [user])

  useEffect(() => {
    api.getSerperKey()
      .then((s) => setSerperStatus(s))
      .catch(() => {})
  }, [])

  const handleSaveSerper = async (e) => {
    e.preventDefault()
    setSerperError('')
    setSerperSaving(true)
    try {
      const status = await api.setSerperKey(serperInput.trim())
      setSerperStatus(status)
      setSerperInput('')
      setSerperSaved(true)
      setTimeout(() => setSerperSaved(false), UI.PROFILE_SAVED_MS)
    } catch (err) {
      setSerperError(err.message || 'Failed to save key.')
    } finally {
      setSerperSaving(false)
    }
  }

  const handleRemoveSerper = async () => {
    setSerperError('')
    try {
      const status = await api.deleteSerperKey()
      setSerperStatus(status)
    } catch (err) {
      setSerperError(err.message || 'Failed to remove key.')
    }
  }

  const handleProfileSave = async (e) => {
    e.preventDefault()
    setSaveError('')
    try {
      const updated = await api.put('/users/me', {
        name: profile.name,
        email: profile.email,
        company: profile.company || null,
        job_title: profile.job_title || null,
        phone: profile.phone || null,
      })
      updateUser(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), UI.PROFILE_SAVED_MS)
    } catch (err) {
      setSaveError(err.message || 'Failed to save.')
    }
  }

  const handleDeleteAccount = async () => {
    if (!window.confirm('Are you sure? This cannot be undone and you will lose all generated leads.')) return
    await api.delete('/users/me')
    logout()
  }

  const initials = (profile.name || '')
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'U'

  return (
    <div id="profile-page" className="h-full overflow-y-auto p-8 max-w-4xl mx-auto animate-fade-in pb-12">
      <div id="profile-header" className="mb-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight">Profile Settings</h1>
          <p className="text-base text-slate-500 dark:text-slate-400 mt-2 font-medium">Manage your account details and security preferences.</p>
        </div>
      </div>

      {/* Avatar card */}
      <div id="profile-avatar-card" className="card p-8 mb-8 flex flex-col sm:flex-row items-center gap-6 bg-gradient-to-r from-primary-600 to-indigo-600 text-white shadow-xl shadow-primary-600/20">
        <div id="profile-avatar" className="w-20 h-20 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center text-white text-2xl font-extrabold flex-shrink-0 border-4 border-white/30 shadow-inner">
          {initials || 'U'}
        </div>
        <div id="profile-name-email" className="text-center sm:text-left flex-1">
          <p className="text-xl font-bold tracking-tight">{profile.name || 'Your Name'}</p>
          <p className="text-primary-100 font-medium">{profile.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8">
        {/* Personal Information */}
        <Section id="personal-info" title="Personal Information" description="Update your name and contact details." icon={<UserCircle2 className="w-6 h-6" />}>
          <form id="personal-info-form" onSubmit={handleProfileSave} className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div id="field-full-name" className="space-y-2">
                <label className="label" htmlFor="name">Full Name</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <User className="w-5 h-5" />
                  </div>
                  <input id="name" className="input pl-11" value={profile.name}
                    onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                    placeholder="Your full name" />
                </div>
              </div>
              <div id="field-email" className="space-y-2">
                <label className="label" htmlFor="email">Email Address</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Mail className="w-5 h-5" />
                  </div>
                  <input id="email" type="email" className="input pl-11 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 cursor-not-allowed" value={profile.email} readOnly disabled
                    placeholder="name@company.com" />
                </div>
                <p className="text-xs text-slate-500">Email cannot be changed.</p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div id="field-company" className="space-y-2">
                <label className="label" htmlFor="company">Company</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <input id="company" className="input pl-11" value={profile.company}
                    onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                    placeholder="Your company name" />
                </div>
              </div>
              <div id="field-job-title" className="space-y-2">
                <label className="label" htmlFor="jobTitle">Job Title</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <input id="jobTitle" className="input pl-11" value={profile.job_title}
                    onChange={(e) => setProfile({ ...profile, job_title: e.target.value })}
                    placeholder="e.g. Head of Sales" />
                </div>
              </div>
            </div>
            <div id="field-phone" className="space-y-2 sm:max-w-md">
              <label className="label" htmlFor="phone">Phone Number</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <Phone className="w-5 h-5" />
                </div>
                <input id="phone" type="tel" className="input pl-11" value={profile.phone}
                  onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                  placeholder="+1 (555) 000-0000" />
              </div>
            </div>
            {saveError && (
              <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 rounded-xl flex items-start gap-3 animate-fade-in">
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium">{saveError}</p>
              </div>
            )}
            <div id="personal-info-actions" className="flex items-center gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button id="save-profile-btn" type="submit" className="btn-primary">
                <Save className="w-4 h-4" />
                Save Changes
              </button>
              {saved && <span className="text-sm text-emerald-600 font-bold flex items-center gap-1 animate-fade-in"><CheckCircle2 className="w-4 h-4"/> Saved successfully!</span>}
            </div>
          </form>
        </Section>

        {/* Integrations — Serper API key */}
        <Section id="integrations" title="Integrations" description="Connect your own Serper.dev API key. Lead generation uses your key and quota." icon={<KeyRound className="w-6 h-6" />}>
          <form id="serper-key-form" onSubmit={handleSaveSerper} className="space-y-6">
            <div className="flex items-center gap-2.5 text-sm">
              <span className="text-slate-500 dark:text-slate-400">Status:</span>
              {serperStatus.has_key ? (
                <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-4 h-4" /> Connected
                  {serperStatus.masked && <code className="ml-1 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-mono text-xs">{serperStatus.masked}</code>}
                </span>
              ) : (
                <span className="font-semibold text-amber-600 dark:text-amber-400">Not set — required to launch lead generation</span>
              )}
            </div>
            <div id="field-serper-key" className="space-y-2 sm:max-w-md">
              <label className="label" htmlFor="serperKey">Serper API Key</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <KeyRound className="w-5 h-5" />
                </div>
                <input id="serperKey" type="password" autoComplete="off" className="input pl-11" value={serperInput}
                  onChange={(e) => setSerperInput(e.target.value)}
                  placeholder={serperStatus.has_key ? 'Enter a new key to replace' : 'Paste your Serper.dev API key'} />
              </div>
              <p className="text-xs text-slate-500">
                Get a key at <a href="https://serper.dev" target="_blank" rel="noopener noreferrer" className="text-primary-600 dark:text-primary-400 hover:underline">serper.dev</a>. Stored encrypted; we never display it again.
              </p>
            </div>
            {serperError && (
              <div className="p-4 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/50 rounded-xl flex items-start gap-3 animate-fade-in">
                <p className="text-sm text-rose-600 dark:text-rose-400 font-medium">{serperError}</p>
              </div>
            )}
            <div id="serper-key-actions" className="flex items-center gap-4 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button id="save-serper-btn" type="submit" className="btn-primary" disabled={serperSaving || !serperInput.trim()}>
                <Save className="w-4 h-4" />
                {serperSaving ? 'Validating…' : 'Save Key'}
              </button>
              {serperStatus.has_key && (
                <button id="remove-serper-btn" type="button" onClick={handleRemoveSerper}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 transition-colors">
                  <Trash2 className="w-4 h-4" /> Remove
                </button>
              )}
              {serperSaved && <span className="text-sm text-emerald-600 font-bold flex items-center gap-1 animate-fade-in"><CheckCircle2 className="w-4 h-4"/> Key saved!</span>}
            </div>
          </form>
        </Section>

        {/* Delete Account */}
        <div id="danger-zone" className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl border border-slate-200/60 dark:border-slate-800/60 bg-slate-50/50 dark:bg-slate-900/30">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
            <p className="text-xs text-slate-500 dark:text-slate-400">Permanently delete your account and all data.</p>
          </div>
          <button
            id="delete-account-btn"
            onClick={handleDeleteAccount}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-500 dark:text-rose-400 hover:text-rose-600 dark:hover:text-rose-300 transition-colors shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete account
          </button>
        </div>
      </div>
    </div>
  )
}
