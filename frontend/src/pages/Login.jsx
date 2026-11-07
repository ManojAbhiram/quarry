import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { api } from '../api'
import {
  Mail, Lock, Eye, EyeOff, ArrowRight,
  Building2, FileText, Target, Send, Activity
} from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'
import BrandLogo from '../components/BrandLogo'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState(
    searchParams.get('error') === 'google_auth_failed' ? 'Google sign-in failed. Please try again.' : ''
  )
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.email || !form.password) {
      setError('Please fill in all fields.')
      return
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(form.email)) {
      setError('Invalid email address.')
      return
    }
    setLoading(true)
    try {
      await login(form.email, form.password)
      navigate('/')
    } catch (err) {
      setError(err.message || 'Login failed.')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError('')
    setGoogleLoading(true)
    try {
      const { url } = await api.get('/auth/google/url')
      window.location.href = url
    } catch (err) {
      setError(err.message || 'Failed to start Google sign-in.')
      setGoogleLoading(false)
    }
  }

  return (
    <div id="login-page" className="h-screen w-screen max-h-screen overflow-hidden grid grid-cols-12 bg-[#f8fafc] dark:bg-[#060b13] text-slate-900 dark:text-white transition-colors duration-300 font-sans relative">
      
      {/* LEFT COLUMN: Premium Figma-inspired Marketing Showcase (scrollable on overflow, hidden scrollbars) */}
      <div className="col-span-12 lg:col-span-5 xl:col-span-5 h-[46vh] lg:h-full bg-gradient-to-b from-[#f1f5f9]/60 to-white dark:from-[#080d19] dark:to-[#060b13] p-6 sm:p-8 xl:p-10 flex flex-col justify-between relative border-b lg:border-b-0 lg:border-r border-slate-200/50 dark:border-slate-800/40 transition-colors duration-300 shrink-0 overflow-y-auto overflow-x-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        
        {/* Glow decoration mirroring Figma's light layout */}
        <div className="absolute top-[-20%] left-[-20%] w-[90%] h-[90%] rounded-full bg-gradient-to-br from-indigo-500/10 to-[#5143ec]/5 dark:from-indigo-500/15 dark:to-indigo-600/5 blur-[120px] pointer-events-none transition-all duration-300" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[70%] h-[70%] rounded-full bg-gradient-to-tr from-amber-500/5 to-transparent dark:from-amber-600/10 dark:to-transparent blur-[110px] pointer-events-none transition-all duration-300" />
        
        {/* Decorative soft floating dots */}
        <div className="absolute top-[20%] right-[10%] w-2 h-2 rounded-full bg-indigo-400/30 blur-[1px] pointer-events-none animate-pulse"></div>
        <div className="absolute bottom-[35%] left-[15%] w-2.5 h-2.5 rounded-full bg-amber-400/20 blur-[1px] pointer-events-none animate-pulse" style={{ animationDelay: '1.5s' }}></div>

        {/* Brand Header */}
        <div className="flex items-center gap-3 relative z-10 animate-fade-in shrink-0 mb-6 lg:mb-8">
          <BrandLogo className="w-8 h-8 rounded-xl shadow-lg shadow-[#5143ec]/30 shrink-0" />
          <div>
            <h1 className="text-base font-black text-slate-900 dark:text-white tracking-tight leading-none">Quarry</h1>
          </div>
        </div>

        {/* Core Value Proposition & Mock Visuals */}
        <div className="flex-1 flex flex-col justify-center relative z-10 space-y-6">
          
          {/* Main Titles */}
          <div className="space-y-2 animate-slide-up shrink-0" style={{ animationDelay: '0.1s' }}>
            <h2 className="text-xl sm:text-2xl xl:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-tight">
              Turn product data into <span className="text-[#5143ec] dark:text-[#818cf8]">qualified leads</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium leading-relaxed max-w-sm">
              AI-powered ICP generation, company sourcing, and outreach sequencing for modern GTM teams.
            </p>
          </div>

          {/* Figma 4-item list (Visible in all dimensions, fully scrollable if screen size is compact) */}
          <div className="flex flex-col space-y-2.5 max-w-[400px] animate-slide-up shrink-0" style={{ animationDelay: '0.2s' }}>
            {[
              { icon: <Target className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, text: "AI-generated Ideal Customer Profiles" },
              { icon: <Building2 className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, text: "Smart company sourcing & enrichment" },
              { icon: <Send className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, text: "Automated outreach sequencing" },
              { icon: <Activity className="w-3.5 h-3.5 text-[#5143ec] dark:text-[#818cf8]" />, text: "Real-time intent signal analysis" }
            ].map((item, idx) => (
              <div key={idx} className="bg-white/80 dark:bg-[#141b2d]/60 border border-slate-200/50 dark:border-slate-800/80 px-4 py-2.5 rounded-2xl flex items-center gap-3 shadow-sm">
                <div className="w-7 h-7 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 text-[#5143ec] dark:text-[#818cf8] flex items-center justify-center shrink-0">
                  {item.icon}
                </div>
                <span className="text-[11.5px] font-bold text-slate-700 dark:text-slate-200 leading-none">
                  {item.text}
                </span>
              </div>
            ))}
          </div>

          {/* Interactive Pipeline & Meridian Health Card Layout */}
          <div className="space-y-3.5 animate-slide-up shrink-0 flex flex-col justify-center" style={{ animationDelay: '0.3s' }}>
            
            {/* Step badges row */}
            <div className="flex items-center gap-1 bg-slate-100/40 dark:bg-slate-900/30 p-1 rounded-xl border border-slate-200/50 dark:border-slate-800/40 text-[9px] font-bold text-slate-500 dark:text-slate-400 shrink-0 w-fit">
              <span className="bg-[#5143ec] text-white px-2.5 py-1 rounded-lg flex items-center gap-1 shadow-sm">
                <FileText className="w-2.5 h-2.5" /> Input
              </span>
              <span className="text-slate-300 dark:text-slate-700 px-0.5">➔</span>
              <span className="px-1.5 py-0.5 flex items-center gap-1">ICP</span>
              <span className="text-slate-300 dark:text-slate-700 px-0.5">➔</span>
              <span className="px-1.5 py-0.5 flex items-center gap-1">Source</span>
              <span className="text-slate-300 dark:text-slate-700 px-0.5">➔</span>
              <span className="px-1.5 py-0.5 flex items-center gap-1">Enrich</span>
              <span className="text-slate-300 dark:text-slate-700 px-0.5">➔</span>
              <span className="px-1.5 py-0.5 flex items-center gap-1">Outreach</span>
            </div>

            {/* Premium glassmorphic Meridian Health match discovery window matching Signup quality */}
            <div className="bg-white/95 dark:bg-[#0c1221]/95 backdrop-blur-xl border border-slate-200/80 dark:border-slate-800/80 p-4 sm:p-5 rounded-[1.5rem] lg:rounded-[2rem] shadow-xl relative overflow-visible transition-all duration-300 shrink-0 max-w-[360px] lg:max-w-[400px] w-full">
              
              {/* Three dots row */}
              <div className="flex gap-1 mb-3 sm:mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-[#fca5a5]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#fde047]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#86efac]"></span>
              </div>

              {/* Discovery Card Interior */}
              <div className="flex items-center justify-between gap-3 sm:gap-4">
                
                {/* Left side details */}
                <div className="space-y-2 sm:space-y-3 flex-1">
                  <div className="space-y-0.5 sm:space-y-1">
                    <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      AI Discovery Live
                    </span>
                    <h4 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white leading-none">Meridian Health</h4>
                    <p className="text-[9px] sm:text-[9.5px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">healthtech.com</p>
                  </div>

                  {/* Badges */}
                  <div className="flex flex-wrap gap-1 sm:gap-1.5">
                    <span className="px-1.5 sm:px-2 py-0.5 bg-amber-50/60 dark:bg-amber-950/20 text-[8.5px] sm:text-[9px] font-bold text-amber-600 dark:text-amber-400 rounded-md border border-amber-100/50 dark:border-amber-900/30">
                      ⚡ Compliance need
                    </span>
                    <span className="px-1.5 sm:px-2 py-0.5 bg-indigo-50/60 dark:bg-indigo-950/20 text-[8.5px] sm:text-[9px] font-bold text-indigo-600 dark:text-indigo-400 rounded-md border border-indigo-100/50 dark:border-indigo-900/30">
                      ⚡ Growth phase
                    </span>
                  </div>
                </div>

                {/* Right side circular progress match widget */}
                <div className="relative w-16 h-16 sm:w-20 sm:h-20 shrink-0 flex items-center justify-center bg-indigo-50/45 dark:bg-indigo-950/30 border border-slate-100 dark:border-slate-800/80 rounded-[1.2rem] sm:rounded-[1.5rem] shadow-sm">
                  
                  {/* Glowing match circle score */}
                  <div className="text-center space-y-0.5">
                    <span className="block text-sm sm:text-lg font-black text-[#5143ec] dark:text-[#818cf8] leading-none">92%</span>
                    <span className="block text-[7px] sm:text-[8px] font-extrabold text-slate-400 uppercase tracking-wider">match</span>
                  </div>

                </div>

              </div>

              {/* Progress bar matching */}
              <div className="w-full h-1 sm:h-1.5 bg-slate-100 dark:bg-slate-800/60 rounded-full overflow-hidden mt-3 sm:mt-4 shrink-0">
                <div className="h-full w-[92%] bg-[#5143ec] rounded-full" />
              </div>

            </div>

            {/* Stats row below card */}
            <div className="grid grid-cols-3 gap-2.5 pt-3.5 border-t border-slate-200/60 dark:border-slate-800/80 shrink-0">
              <div className="flex flex-col">
                <span className="text-[14px] font-black text-slate-900 dark:text-white leading-none">2,847</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-555 font-bold mt-1 leading-tight">Companies sourced</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-black text-slate-900 dark:text-white leading-none">15,420</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-555 font-bold mt-1 leading-tight">Contacts enriched</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[14px] font-black text-slate-900 dark:text-white leading-none">893</span>
                <span className="text-[9px] text-slate-400 dark:text-slate-555 font-bold mt-1 leading-tight">Sequences sent</span>
              </div>
            </div>

          </div>
        </div>

        {/* Footer info at the absolute bottom of marketing content */}
        <div className="text-[9px] text-slate-400 dark:text-slate-650 font-bold relative z-10 animate-fade-in shrink-0 mt-8">
          &copy; {new Date().getFullYear()} Quarry. Enterprise-grade lead generation.
        </div>
      </div>

      {/* RIGHT COLUMN: Clean, minimalist, and mathematically screen-centered credentials panel (locked, non-scrollable) */}
      <div className="col-span-12 lg:col-span-7 xl:col-span-7 h-[54vh] lg:h-full flex flex-col justify-center items-center p-6 sm:p-10 relative bg-white dark:bg-[#070b13] transition-colors duration-300 overflow-hidden shrink-0">
        
        {/* Ambient glow decoration */}
        <div className="absolute top-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-[#5143ec]/5 dark:bg-[#5143ec]/10 blur-[130px] pointer-events-none transition-colors duration-300" />
        <div className="absolute bottom-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/5 dark:bg-indigo-600/10 blur-[130px] pointer-events-none transition-colors duration-300" />

        {/* Theme and Action Bar */}
        <div className="absolute top-4 right-4 z-20">
          <ThemeToggle />
        </div>

        {/* This wrapper is mathematically aligned to viewport center via flex flex-col justify-center items-center */}
        <div className="w-full max-w-[380px] space-y-4 sm:space-y-6 animate-fade-in relative z-10 flex flex-col justify-center">
          
          <div className="space-y-1 sm:space-y-1.5 text-center lg:text-left shrink-0">
            <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight">
              Welcome back
            </h2>
            <p className="text-xs sm:text-[13px] text-slate-500 dark:text-slate-400 font-medium">
              Sign in to your Quarry workspace
            </p>
          </div>

          {/* Form */}
          <form id="login-form" onSubmit={handleSubmit} className="space-y-4 sm:space-y-5 shrink-0">
            <div id="field-email" className="space-y-1.5 sm:space-y-2">
              <label className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wide" htmlFor="email">
                Email address
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400 dark:text-slate-505" />
                </div>
                <input
                  id="email"
                  type="email"
                  required
                  className="w-full pl-10 sm:pl-11 pr-4 py-2.5 sm:py-3.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                  placeholder="you@company.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  autoComplete="email"
                />
              </div>
            </div>

            <div id="field-password" className="space-y-1.5 sm:space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] sm:text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wide" htmlFor="password">
                  Password
                </label>
                <Link to="/forgot-password" className="text-[11px] sm:text-xs font-bold text-[#5143ec] dark:text-[#818cf8] hover:underline transition-colors">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-slate-400 dark:text-slate-505" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  className="w-full pl-10 sm:pl-11 pr-10 sm:pr-11 py-2.5 sm:py-3.5 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-650 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              error.includes('Google Sign-In') ? (
                <div id="login-error-google" className="p-3 sm:p-4 bg-indigo-500/8 border border-indigo-500/20 rounded-2xl space-y-3 animate-fade-in">
                  <div className="flex items-start gap-2.5">
                    <svg className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24">
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                    </svg>
                    <div>
                      <p className="text-[11px] sm:text-xs text-slate-700 dark:text-slate-200 font-bold leading-snug">
                        This account uses Google Sign-In
                      </p>
                      <p className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400 font-medium mt-0.5 leading-snug">
                        No password is set. Continue with Google or set a password via Forgot Password.
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={handleGoogleSignIn}
                      disabled={googleLoading}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 bg-white dark:bg-slate-900/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-[10px] sm:text-[11px] hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all disabled:opacity-50"
                    >
                      <svg className="w-3 h-3" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      {googleLoading ? 'Redirecting…' : 'Continue with Google'}
                    </button>
                    <Link
                      to="/forgot-password"
                      className="flex-1 flex items-center justify-center py-2 px-3 bg-[#5143ec]/10 border border-[#5143ec]/20 text-[#5143ec] dark:text-[#818cf8] rounded-xl font-bold text-[10px] sm:text-[11px] hover:bg-[#5143ec]/15 transition-all text-center"
                    >
                      Set a password →
                    </Link>
                  </div>
                </div>
              ) : (
                <div id="login-error" className="p-3 sm:p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl flex items-start gap-3 animate-fade-in">
                  <p className="text-[11px] sm:text-xs text-rose-500 dark:text-rose-450 font-bold transition-colors">{error}</p>
                </div>
              )
            )}

            <button
              id="login-btn"
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-1.5 py-3 sm:py-4 px-4 bg-[#5143ec] hover:bg-[#4338ca] text-white rounded-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed mt-4 sm:mt-6 text-xs shadow-lg shadow-[#5143ec]/20 hover:shadow-[#5143ec]/30"
            >
              {loading ? 'Signing in...' : 'Sign in'}
              {!loading && <ArrowRight className="w-4 h-4" />}
            </button>
          </form>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">or</span>
            <div className="flex-1 h-px bg-slate-200 dark:bg-slate-800" />
          </div>

          <button
            id="google-signin-btn"
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-2.5 py-3 sm:py-3.5 px-4 bg-white dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-2xl font-bold transition-all active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed text-xs shadow-sm"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {googleLoading ? 'Redirecting…' : 'Continue with Google'}
          </button>

          <p id="signup-link" className="text-xs text-center text-slate-500 dark:text-slate-455 font-bold shrink-0">
            Don't have an account?{' '}
            <Link to="/register" className="text-[#5143ec] dark:text-[#818cf8] font-bold hover:underline transition-colors">
              Sign up for free
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
