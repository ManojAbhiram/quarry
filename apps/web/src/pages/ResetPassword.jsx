import { useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react'
import ThemeToggle from '../components/ThemeToggle'
import { api } from '../api'

export default function ResetPassword() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''
  const navigate = useNavigate()

  const [form, setForm] = useState({ password: '', confirm: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!token) { setError('Invalid or missing reset token.'); return }
    if (form.password.length < 6) { setError('Password must be at least 6 characters.'); return }
    if (form.password !== form.confirm) { setError('Passwords do not match.'); return }

    setLoading(true)
    try {
      await api.post('/auth/reset-password', { token, new_password: form.password })
      setDone(true)
      setTimeout(() => navigate('/login'), 3000)
    } catch (err) {
      setError(err.message || 'Reset failed. The link may have expired.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] dark:bg-[#060b13] px-4 transition-colors duration-300">
      <div className="absolute top-4 right-4 z-20">
        <ThemeToggle />
      </div>

      <div className="w-full max-w-[400px] space-y-6 animate-fade-in">
        <div className="space-y-2 text-center">
          <div className="w-12 h-12 bg-[#5143ec] rounded-2xl flex items-center justify-center mx-auto shadow-lg shadow-[#5143ec]/30 mb-4">
            <Lock className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight">Set new password</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
            Choose a strong password for your account.
          </p>
        </div>

        {done ? (
          <div className="bg-white dark:bg-[#0c1221] border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-sm text-center space-y-4">
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
            <div>
              <p className="font-bold text-slate-900 dark:text-white">Password updated!</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Redirecting you to sign in…
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-white dark:bg-[#0c1221] border border-slate-200 dark:border-slate-800 rounded-3xl p-8 shadow-sm space-y-5">
            {!token && (
              <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                <p className="text-xs text-rose-500 font-bold">
                  Invalid reset link. Please request a new one.
                </p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wide">
                  New password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    className="w-full pl-11 pr-10 py-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                    placeholder="Min. 6 characters"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 dark:text-slate-300 tracking-wide">
                  Confirm password
                </label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                    <Lock className="h-4 w-4 text-slate-400" />
                  </div>
                  <input
                    type={showConfirm ? 'text' : 'password'}
                    required
                    className="w-full pl-11 pr-10 py-3 bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 rounded-2xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5143ec]/20 focus:border-[#5143ec] transition-all text-xs font-semibold"
                    placeholder="Repeat new password"
                    value={form.confirm}
                    onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowConfirm(!showConfirm)}
                    className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-400 hover:text-slate-600 transition-colors">
                    {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/20 rounded-2xl">
                  <p className="text-xs text-rose-500 font-bold">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={loading || !token}
                className="w-full py-3 px-4 bg-[#5143ec] hover:bg-[#4338ca] text-white rounded-2xl font-bold transition-all text-xs shadow-lg shadow-[#5143ec]/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Updating...' : 'Update password'}
              </button>
            </form>

            <div className="text-center">
              <Link to="/login" className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-[#5143ec] dark:hover:text-[#818cf8] transition-colors">
                Back to sign in
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
