import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, Moon, Sun, Target, Building2, FileDown } from 'lucide-react'
import { Field } from '../../components/kit'
import { useTheme } from '../../context/ThemeContext'
import BrandLogo from '../../components/BrandLogo'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
export const MIN_PASSWORD = 6

export const MSG_NETWORK = "Quarry's server can't be reached. Check your connection and try again."
export const MSG_RATE_LIMIT = 'Too many attempts, please wait a minute and try again.'
export const MSG_SERVER = 'Something went wrong on our side. Please try again.'

/**
 * Turns a failed API call into `{ message, retry }`. A network error can be retried as is;
 * `byStatus` lets a screen map specific HTTP statuses to its own wording.
 */
export function describeError(err, { byStatus = {}, fallback = MSG_SERVER } = {}) {
  if (err?.isNetworkError) return { message: MSG_NETWORK, retry: true }
  if (err?.status === 429) return { message: MSG_RATE_LIMIT, retry: false }
  if (err?.status != null && byStatus[err.status]) return { message: byStatus[err.status], retry: false }
  if (err?.status >= 500) return { message: MSG_SERVER, retry: true }
  return { message: err?.message || fallback, retry: false }
}

/** Form state with errors that appear once a field is blurred, or after the first submit. */
export function useForm(initial, rules) {
  const [values, setValues] = useState(initial)
  const [touched, setTouched] = useState({})
  const errorOf = (name, vals = values) => rules[name]?.(vals[name], vals) || ''
  const hasErrors = () => Object.keys(rules).some((name) => errorOf(name))

  return {
    values,
    hasErrors,
    touchAll: () => setTouched(Object.fromEntries(Object.keys(rules).map((n) => [n, true]))),
    bind: (name) => ({
      value: values[name],
      onChange: (e) => setValues((v) => ({ ...v, [name]: e.target.value })),
      // Leaving an empty field is not an error yet; required errors appear on submit.
      onBlur: () => values[name] && setTouched((t) => ({ ...t, [name]: true })),
      error: touched[name] ? errorOf(name) : undefined,
    }),
  }
}

function ThemeButton() {
  const { theme, toggleTheme } = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-line bg-surface text-muted hover:bg-head hover:text-ink"
    >
      {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
    </button>
  )
}

const POINTS = [
  { icon: Target, text: 'Describe your product and get ideal customer profiles.' },
  { icon: Building2, text: 'Source companies and enrich them with contacts and tech stack.' },
  { icon: FileDown, text: 'Export lead lists to CSV, Excel or PDF.' },
]

/** Page frame shared by the auth screens: the form first, a slim brand panel beside it from md up. */
export function AuthLayout({ title, description, children, footer }) {
  return (
    <div className="flex min-h-screen bg-app text-ink">
      <aside className="hidden w-[340px] shrink-0 flex-col justify-between border-r border-line bg-head p-8 md:flex lg:w-[420px] lg:p-10">
        <div className="flex items-center gap-2.5">
          <BrandLogo title="" className="h-8 w-8 rounded-md" />
          <span className="text-base font-semibold">Quarry</span>
        </div>
        <div>
          <p className="text-xl font-semibold leading-snug">Find the companies worth contacting.</p>
          <ul className="mt-6 space-y-4">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-start gap-3 text-sm text-muted">
                <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-400" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs text-muted">Quarry lead research</p>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 md:invisible">
            <BrandLogo title="" className="h-7 w-7 rounded-md" />
            <span className="text-base font-semibold">Quarry</span>
          </div>
          <ThemeButton />
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pb-10 pt-4 sm:px-6 md:items-center md:pt-0">
          <div className="w-full max-w-sm">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
            <div className="mt-6">{children}</div>
            {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
          </div>
        </div>
      </main>
    </div>
  )
}

/** A password input with a show/hide toggle. Extra props go to the underlying Field. */
export function PasswordField({ label = 'Password', ...props }) {
  const [shown, setShown] = useState(false)
  return (
    <div className="relative">
      <Field label={label} type={shown ? 'text' : 'password'} style={{ paddingRight: '2.5rem' }} {...props} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? 'Hide password' : 'Show password'}
        aria-pressed={shown}
        className="absolute right-0 top-[26px] inline-flex h-10 w-10 items-center justify-center rounded-md text-muted hover:text-ink"
      >
        {shown ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
      </button>
    </div>
  )
}

/** A form-level error. Offers a retry when the failure was the connection. */
export function FormAlert({ error, disabled }) {
  if (!error) return null
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft p-3 text-sm text-bad">
      <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1 break-words">
        <p>{error.message}</p>
        {error.retry && error.retryFn && (
          <button type="button" onClick={error.retryFn} disabled={disabled} className="mt-1 font-semibold underline underline-offset-2 disabled:opacity-60">
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

/** A text link in the accent colour. */
export function AuthLink({ to, children, className = '' }) {
  return (
    <Link to={to} className={`font-semibold text-primary-700 hover:underline dark:text-primary-300 ${className}`}>
      {children}
    </Link>
  )
}
