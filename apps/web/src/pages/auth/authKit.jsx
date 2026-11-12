import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, Moon, Sun, Target, Building2, FileDown } from 'lucide-react'
import { Field } from '../../components/kit'
import { useTheme } from '../../context/ThemeContext'
import BrandLogo from '../../components/BrandLogo'
import PaletteSwitcher from '../../components/PaletteSwitcher'
import Backdrop from '../../components/motion/Backdrop'
import Reveal from '../../components/motion/Reveal'
import SplitHeading from '../../components/motion/SplitHeading'
import { GlowingEffect } from '../../components/ui/glowing-effect'
import { motion, useReducedMotion } from 'motion/react'

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
      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface/80 text-muted shadow-sm backdrop-blur-md transition-all duration-200 hover:bg-surface hover:text-ink hover:shadow-md active:scale-95"
    >
      {dark ? <Sun aria-hidden="true" className="h-4 w-4" /> : <Moon aria-hidden="true" className="h-4 w-4" />}
    </button>
  )
}

const POINTS = [
  { icon: Target, title: 'Ideal customer profiles', text: 'Describe your product and get the kinds of companies that fit.' },
  { icon: Building2, title: 'Enriched companies', text: 'Source companies and enrich them with contacts and tech stack.' },
  { icon: FileDown, title: 'Export anywhere', text: 'Download lead lists as CSV, Excel or PDF.' },
]

/** Slow drifting colour glows from the palette. Decorative only; not rendered for reduced motion. */
function Aurora() {
  const reduce = useReducedMotion()
  return (
    <div aria-hidden="true" data-testid="auth-aurora" className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      <motion.div
        className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-primary-400/25 blur-3xl dark:bg-primary-500/20"
        animate={reduce ? undefined : { x: [0, -40, 0], y: [0, 30, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -bottom-32 right-1/4 h-96 w-96 rounded-full bg-accent-400/20 blur-3xl dark:bg-accent-500/15"
        animate={reduce ? undefined : { x: [0, 50, 0], y: [0, -30, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}

/** Page frame shared by the auth screens: the form first (also on phones), a rich brand panel beside it from md up. */
export function AuthLayout({ title, description, children, footer }) {
  return (
    <div className="relative flex min-h-screen overflow-hidden bg-app text-ink">
      <Aurora />

      <main className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2 md:invisible">
            <BrandLogo title="" className="h-8 w-8" />
            <span className="text-base font-black tracking-tight">Quarry</span>
          </div>
          <div className="flex items-center gap-2">
            <PaletteSwitcher />
            <ThemeButton />
          </div>
        </div>
        <div className="flex flex-1 items-start justify-center px-4 pb-10 pt-4 sm:px-6 md:items-center md:pt-0">
          <div className="relative w-full max-w-md">
            <div aria-hidden="true" className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-primary-400/25 via-transparent to-accent-400/25 blur-2xl" />
            <div className="relative rounded-2xl bg-gradient-to-br from-primary-400/60 via-line to-accent-400/60 p-px shadow-lift">
              <div className="rounded-[15px] bg-surface/90 p-6 backdrop-blur-2xl sm:p-8">
                <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{title}</h1>
                {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
                <div className="mt-6">{children}</div>
              </div>
            </div>
            {footer && <div className="relative mt-6 text-center text-sm text-muted">{footer}</div>}
          </div>
        </div>
      </main>

      <aside className="relative z-0 hidden w-[44%] max-w-[640px] shrink-0 flex-col justify-between overflow-hidden border-r border-line bg-head/60 p-10 backdrop-blur-sm md:order-first md:flex lg:p-14">
        <Backdrop />
        <div className="relative flex items-center gap-2.5">
          <BrandLogo title="" className="h-10 w-10" />
          <span className="text-xl font-black tracking-tight">Quarry</span>
        </div>
        <Reveal className="relative">
          <SplitHeading as="p" className="text-4xl font-black leading-[1.1] tracking-tight lg:text-5xl">
            Find the companies worth contacting.
          </SplitHeading>
          <ul className="mt-10 space-y-3">
            {POINTS.map(({ icon: Icon, title: t, text }) => (
              <li key={t} data-reveal>
                <div data-testid="auth-feature" className="glass relative flex items-start gap-4 rounded-2xl p-4 ring-1 ring-primary-500/10">
                  <GlowingEffect spread={36} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-btn to-accent-500 text-white shadow-lg shadow-primary-600/25">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-bold">{t}</p>
                    <p className="mt-0.5 text-sm text-muted">{text}</p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Reveal>
        <p className="relative text-xs text-muted">Quarry lead research</p>
      </aside>
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
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-bad/30 bg-bad-soft p-3 text-sm text-bad">
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
