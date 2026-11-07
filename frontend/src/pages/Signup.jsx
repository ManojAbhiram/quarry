import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Mail, Lock, User, Eye, EyeOff, ArrowRight, Sparkles,
  Target, Building2, Send, Activity, Globe
} from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'
import BrandLogo from '../components/BrandLogo'

export default function Signup() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', org_name: '', org_domain: '', password: '', confirm: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.name || !form.email || !form.org_name || !form.org_domain || !form.password) {
      setError('Please fill in all fields.')
      return
    }
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    if (form.password !== form.confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    try {
      await register(form.email, form.password, form.name, form.org_name, form.org_domain)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Sign up failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div id="signup-page" className="h-screen w-screen max-h-screen overflow-hidden grid grid-cols-12 bg-[#f8fafc] dark:bg-[#060b13] text-slate-900 dark:text-white transition-colors duration-300 font-sans relative">
      
      {/* LEFT COLUMN: Premium Figma-inspired Marketing Showcase (visible in all dimensions) */}
      <div className="col-span-12 lg:col-span-5 xl:col-span-5 h-[46vh] lg:h-full bg-gradient-to-b from-[#f1f5f9]/60 to-white dark:from-[#080d19] dark:to-[#060b13] p-6 sm:p-8 xl:p-10 flex flex-col justify-between relative border-b lg:border-b-0 lg:border-r border-slate-200/50 dark:border-slate-800/40 transition-colors duration-300 shrink-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        
        {/* Glow decoration mirroring Figma's light layout */}
        <div className="absolute top-[-20%] left-[-20%] w-[90%] h-[90%] rounded-full bg-gradient-to-br from-indigo-500/10 to-[#5143ec]/5 dark:from-indigo-500/15 dark:to-indigo-600/5 blur-[120px] pointer-events-none transition-all duration-300" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[70%] h-[70%] rounded-full bg-gradient-to-tr from-violet-500/5 to-transparent dark:from-violet-600/10 dark:to-transparent blur-[110px] pointer-events-none transition-all duration-300" />
        
        {/* Decorative soft floating dots */}
        <div className="absolute top-[35%] right-[12%] w-2 h-2 rounded-full bg-indigo-400/25 blur-[1px] animate-pulse"></div>
        <div className="absolute bottom-[20%] left-[20%] w-3 h-3 rounded-full bg-amber-400/20 blur-[1px] animate-pulse" style={{ animationDelay: '2s' }}></div>
        <div className="absolute top-[10%] left-[45%] w-2 h-2 rounded-full bg-pink-400/15 blur-[1px] animate-pulse" style={{ animationDelay: '1s' }}></div>

        {/* Brand Header */}
        <div className="flex items-center gap-3 relative z-10 animate-fade-in shrink-0">
          <BrandLogo className="w-8 h-8 rounded-xl shadow-lg shadow-[#5143ec]/30 shrink-0" />
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-white tracking-tight leading-none">Quarry</h1>
          </div>
        </div>

        {/* Core Value Proposition & Mock Visuals */}
        <div className="flex-1 flex flex-col justify-center min-h-0 py-2 lg:py-4 overflow-hidden relative z-10 space-y-3 sm:space-y-4 lg:space-y-5 xl:space-y-6">
          
          {/* Main Titles */}
          <div className="space-y-1 sm:space-y-2 animate-slide-up shrink-0" style={{ animationDelay: '0.1s' }}>
            <h2 className="text-lg sm:text-2xl xl:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
              Turn product data into <span className="text-[#5143ec] dark:text-[#818cf8]">qualified leads</span>
            </h2>
            <p className="hidden md:block text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-sm">
              AI-powered ICP generation, company sourcing, and outreach sequencing for modern GTM teams.
            </p>
          </div>

          {/* Figma 4-pill Grid - visible on tablets and desktops */}
          <div className="hidden md:grid grid-cols-2 gap-3 max-w-[420px] animate-slide-up shrink-0" style={{ animationDelay: '0.2s' }}>
            {[
              { icon: <Target className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, label: "AI ICP generation" },
              { icon: <Building2 className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, label: "Smart sourcing" },
              { icon: <Send className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, label: "Auto-sequencing" },
              { icon: <Activity className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, label: "Intent analysis" }
            ].map((pill, idx) => (
              <div key={idx} className="bg-white/90 dark:bg-[#141b2d]/60 border border-slate-200/50 dark:border-slate-800/80 px-3.5 py-2 rounded-2xl flex items-center gap-2 shadow-sm">
                <span className="shrink-0">{pill.icon}</span>
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-200 leading-none">{pill.label}</span>
              </div>
            ))}
          </div>

          {/* Glassmorphic Chart Mockup (Figma Screen 1 Bottom) */}
          <div className="animate-slide-up relative mt-2 shrink-0 scale-90 sm:scale-100 origin-center" style={{ animationDelay: '0.3s' }}>
            
            {/* Main glass visual screen */}
            <div className="bg-white/95 dark:bg-[#0c1221]/95 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-4 sm:p-5 rounded-3xl shadow-lg max-w-[360px] lg:max-w-[400px] w-full relative overflow-visible">
              
              {/* Three dots row */}
              <div className="flex gap-1 mb-3 sm:mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#fca5a5]"></span>
                <span className="w-2 h-2 rounded-full bg-[#fde047]"></span>
                <span className="w-2 h-2 rounded-full bg-[#86efac]"></span>
              </div>

              {/* Chart Content Area */}
              <div className="flex items-end justify-between h-20 sm:h-28 relative">
                
                {/* 5 Indigo Columns */}
                <div className="flex items-end gap-2.5 sm:gap-3 h-full w-[60%] border-r border-slate-100 dark:border-slate-900 pr-3">
                  <div className="w-2.5 sm:w-3 bg-[#5143ec]/20 dark:bg-[#5143ec]/30 rounded-t h-[40%]"></div>
                  <div className="w-2.5 sm:w-3 bg-[#5143ec]/40 dark:bg-[#5143ec]/50 rounded-t h-[70%]"></div>
                  <div className="w-2.5 sm:w-3 bg-[#5143ec] rounded-t h-[95%] shadow-sm shadow-[#5143ec]/20"></div>
                  <div className="w-2.5 sm:w-3 bg-[#5143ec]/60 dark:bg-[#5143ec]/70 rounded-t h-[55%]"></div>
                  <div className="w-2.5 sm:w-3 bg-[#5143ec]/30 dark:bg-[#5143ec]/40 rounded-t h-[30%]"></div>
                </div>

                {/* Right Placeholder Info Rows */}
                <div className="w-[35%] flex flex-col gap-3 sm:gap-4 pl-2.5">
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex-1 space-y-1">
                      <div className="h-1 w-8 sm:h-1 sm:w-10 bg-slate-200/80 dark:bg-slate-800 rounded-full"></div>
                      <div className="h-1 w-5 sm:h-1 sm:w-7 bg-slate-200/80 dark:bg-slate-800 rounded-full"></div>
                    </div>
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shadow-[0_0_6px_#10b981]"></span>
                  </div>
                  <div className="flex items-center justify-between gap-1.5">
                    <div className="flex-1 space-y-1">
                      <div className="h-1 w-9 sm:h-1 sm:w-12 bg-slate-200/80 dark:bg-slate-800 rounded-full"></div>
                      <div className="h-1 w-4 sm:h-1 sm:w-6 bg-slate-200/80 dark:bg-slate-800 rounded-full"></div>
                    </div>
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shadow-[0_0_6px_#6366f1]"></span>
                  </div>
                </div>

                {/* Top Right Mini Floating Widget */}
                <div className="absolute top-[-20px] sm:top-[-25px] right-[-10px] sm:right-[-15px] bg-white dark:bg-[#141b2d] border border-slate-200/80 dark:border-slate-800/80 p-2 sm:p-2.5 rounded-xl shadow-md flex gap-1.5 sm:gap-2 z-20 items-end">
                  <div className="flex items-end gap-0.5 sm:gap-1">
                    <div className="w-0.5 sm:w-1 bg-amber-400 rounded-t h-3 sm:h-4"></div>
                    <div className="w-0.5 sm:w-1 bg-emerald-400 rounded-t h-5 sm:h-7"></div>
                    <div className="w-0.5 sm:w-1 bg-[#5143ec] rounded-t h-4 sm:h-5"></div>
                  </div>
                  <div className="flex flex-col gap-0.5 pb-0.5">
                    <div className="w-4 sm:w-5 h-0.5 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                    <div className="w-3 sm:w-4 h-0.5 bg-slate-200 dark:bg-slate-800 rounded-full"></div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        </div>

        {/* Footer info (Visible on large screens) */}
        <div className="hidden lg:block text-[9px] text-slate-400 dark:text-slate-650 font-bold relative z-10 animate-fade-in shrink-0">
          &copy; {new Date().getFullYear()} Quarry. Enterprise-grade lead generation.
        </div>
      </div>

      {/* RIGHT COLUMN: Clean, minimalist, and mathematically screen-centered credentials panel */}
      <div className="col-span-12 lg:col-span-7 xl:col-span-7 h-[54vh] lg:h-full flex flex-col justify-center items-center p-6 sm:p-10 relative bg-white dark:bg-[#070b13] transition-colors duration-300 overflow-y-auto shrink-0">
        
        {/* Ambient glow decoration */}
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#5143ec]/5 dark:bg-[#5143ec]/10 blur-[130px] pointer-events-none transition-colors duration-300" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/5 dark:bg-indigo-600/10 blur-[130px] pointer-events-none transition-colors duration-300" />

        {/* Theme and Action Bar */}
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle />
        </div>

        <div className="w-full max-w-[380px] space-y-3 sm:space-y-4 animate-fade-in relative z-10 flex flex-col justify-center">
          
          <div className="space-y-0.5 text-center lg:text-left shrink-0">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Create your account
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              Start turning product data into qualified leads
            </p>
          </div>

          {/* Form */}
          <form id="signup-form" onSubmit={handleSubmit} className="space-y-2.5 sm:space-y-3 shrink-0">
            
            <div id="field-name" className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-wide" htmlFor="name">
                Full Name
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <User className="h-3.5 w-3.5 text-slate-400 dark:text-slate-505" />
                </div>
                <input
                  id="name"
                  type="text"
                  required
                  className="w-full pl-10 pr-3.5 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                  placeholder="Enter your full name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoComplete="name"
                />
              </div>
            </div>

            <div id="field-email" className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-wide" htmlFor="email">
                Email address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-3.5 w-3.5 text-slate-400 dark:text-slate-505" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  className="w-full pl-10 pr-3.5 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:gap-3">
              <div id="field-org-name" className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-wide" htmlFor="org_name">
                  Organization Name
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Building2 className="h-3.5 w-3.5 text-slate-400 dark:text-slate-505" />
                  </div>
                  <input
                    id="org_name"
                    type="text"
                    required
                    className="w-full pl-10 pr-3.5 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                    placeholder="Acme Corp"
                    value={form.org_name}
                    onChange={(e) => setForm({ ...form, org_name: e.target.value })}
                  />
                </div>
              </div>
              <div id="field-org-domain" className="space-y-1">
                <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-wide" htmlFor="org_domain">
                  Organization Domain
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Globe className="h-3.5 w-3.5 text-slate-400 dark:text-slate-505" />
                  </div>
                  <input
                    id="org_domain"
                    type="text"
                    required
                    className="w-full pl-10 pr-3.5 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                    placeholder="acme.com"
                    value={form.org_domain}
                    onChange={(e) => setForm({ ...form, org_domain: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div id="field-password" className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-wide" htmlFor="password">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-505" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full pl-10 pr-10 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                  placeholder="Create a strong password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            <div id="field-confirm" className="space-y-1">
              <label className="text-[11px] font-bold text-slate-700 dark:text-slate-350 tracking-wide" htmlFor="confirm">
                Confirm Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-505" />
                </div>
                <input
                  id="confirm"
                  type={showConfirmPassword ? 'text' : 'password'}
                  required
                  className="w-full pl-10 pr-10 py-2 sm:py-2.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-655 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                  placeholder="Confirm your password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showConfirmPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>

            {error && (
              <div id="signup-error" className="p-2.5 sm:p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-3 animate-fade-in">
                <p className="text-[11px] text-rose-500 dark:text-rose-450 font-bold transition-colors">{error}</p>
              </div>
            )}

            <button
              id="signup-btn"
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-3 sm:py-3.5 px-4 bg-[#5143ec] hover:bg-[#4338ca] text-white rounded-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-3 sm:mt-4 text-xs shadow-lg shadow-[#5143ec]/20 hover:shadow-[#5143ec]/30"
            >
              {loading ? 'Creating account...' : 'Create account'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <p id="login-link" className="text-xs text-center text-slate-500 dark:text-slate-455 font-bold shrink-0">
            Already have an account?{' '}
            <Link to="/login" className="text-[#5143ec] dark:text-[#818cf8] font-bold hover:underline transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
