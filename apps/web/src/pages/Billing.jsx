import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { Check, Coins, CreditCard, Mail, Receipt, Sparkles } from 'lucide-react'
import { api } from '../api'
import { Button, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/kit'
import { useStaggerIn } from '../components/motion/useStaggerIn'
import Section from './profile/Section'

const money = (minor, currency) => {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: (currency || 'usd').toUpperCase() }).format((minor || 0) / 100)
  } catch {
    return `${((minor || 0) / 100).toFixed(2)} ${currency || ''}`
  }
}

function Meter({ label, used, limit }) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
  const hot = pct >= 90
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <span className="font-semibold text-ink">{label}</span>
        <span className={clsx('tabular-nums', hot ? 'font-bold text-bad' : 'text-muted')}>{used} / {limit}</span>
      </div>
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={limit} aria-valuenow={Math.min(used, limit)} className="h-2.5 overflow-hidden rounded-full bg-head">
        <div className={clsx('h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none', hot ? 'bg-bad' : 'bg-gradient-to-r from-primary-500 to-accent-500')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function Billing() {
  const pageRef = useRef(null)
  const [params] = useSearchParams()
  const [state, setState] = useState({ status: 'loading', summary: null, plans: [], providers: [], invoices: [], error: '' })
  const [busyPlan, setBusyPlan] = useState('')
  const [provider, setProvider] = useState('')
  const [notice, setNotice] = useState('')
  const [topup, setTopup] = useState(null) // { packs, providers, can_manage } or null when unavailable
  const [pack, setPack] = useState(100)
  const [target, setTarget] = useState('requests')
  const [buying, setBuying] = useState(false)
  const [topupMsg, setTopupMsg] = useState(null) // { ok, text }

  const load = useCallback(() => {
    setState((s) => ({ ...s, status: 'loading' }))
    Promise.all([api.get('/billing/summary'), api.get('/billing/plans'), api.get('/billing/invoices'), api.get('/billing/topup').catch(() => null)])
      .then(([summary, plans, inv, top]) => {
        setTopup(top)
        const providers = plans?.providers || []
        setProvider((p) => p || providers[0] || '')
        setState({ status: 'ready', summary, plans: plans?.plans || [], providers, invoices: inv?.invoices || [], error: '' })
      })
      .catch((e) => setState((s) => ({ ...s, status: 'error', error: e.message || 'Could not load billing.' })))
  }, [])
  useEffect(load, [load])
  useStaggerIn(pageRef, { dependencies: [state.status] })

  const checkout = async (plan) => {
    setBusyPlan(plan)
    setNotice('')
    try {
      const res = await api.post('/billing/checkout', { plan, provider: provider || undefined })
      window.location.assign(res.url)
    } catch (err) {
      setNotice(err.message || 'Could not start checkout.')
      setBusyPlan('')
    }
  }

  const buyCredits = async (e) => {
    e.preventDefault()
    setBuying(true)
    setTopupMsg(null)
    try {
      const res = await api.post('/billing/topup', { credits: Number(pack), target })
      if (res.settled) {
        setTopupMsg({ ok: true, text: `Added ${res.credits} ${target === 'requests' ? 'request' : 'email lookup'} credits.` })
        load()
      } else if (res.url) {
        window.location.assign(res.url)
        return
      }
    } catch (err) {
      setTopupMsg({ ok: false, text: err.message || 'Could not add credits.' })
    } finally {
      setBuying(false)
    }
  }

  const { summary, plans, providers, invoices } = state
  const checkoutFlag = params.get('checkout')

  return (
    <div id="billing-page" ref={pageRef} className="h-full overflow-y-auto pb-12 page-container">
      <div className="mx-auto max-w-5xl">
        <div data-reveal>
          <PageHeader title="Billing and usage" description="Your plan, what you have used this month, and past invoices." />
        </div>

        {checkoutFlag === 'success' && <p role="status" className="mb-4 rounded-xl bg-ok-soft p-3 text-sm font-medium text-ok">Thanks! Your plan updates as soon as the payment is confirmed, usually within a minute.</p>}
        {params.get('topup') === 'success' && <p role="status" className="mb-4 rounded-xl bg-ok-soft p-3 text-sm font-medium text-ok">Thanks! Your credits are added as soon as the payment is confirmed, usually within a minute.</p>}
        {checkoutFlag === 'cancelled' && <p role="status" className="mb-4 rounded-xl bg-warn-soft p-3 text-sm font-medium text-warn">Checkout was cancelled. Nothing was charged.</p>}

        {state.status === 'loading' && (
          <div role="status" aria-label="Loading billing" className="space-y-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-56 w-full" />
          </div>
        )}
        {state.status === 'error' && <ErrorState title="Could not load billing" message={state.error} onRetry={load} />}

        {state.status === 'ready' && summary && (
          <div className="space-y-6">
            <Section id="current-plan" title={`${summary.plan.name} plan`} description={summary.scope === 'organization' ? 'This plan applies to the whole organization.' : 'This plan applies to your personal workspace.'} icon={Sparkles}>
              <div className="grid gap-6 sm:grid-cols-2">
                <Meter label="Lead requests this month" used={summary.usage.requests_created} limit={summary.usage.requests_limit} />
                <Meter label="Credits spent this month" used={summary.usage.credits_spent} limit={summary.credits.monthly_grant} />
              </div>
              <p className="mt-5 text-sm text-muted">
                {summary.subscription?.status ? <>Subscription: <strong className="capitalize text-ink">{summary.subscription.status.replace('_', ' ')}</strong></> : 'No paid subscription.'}
                {summary.subscription?.status === 'past_due' && <span className="ml-1 font-semibold text-bad">Payment failed. Update your payment method.</span>}
              </p>
            </Section>

            <Section id="credits" title="Credits" description="Two separate balances. Request credits pay for lead requests; email lookup credits pay for finding emails with Hunter, Snov or People Data Labs." icon={Coins}>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-line p-4">
                  <dt className="flex items-center gap-2 text-sm font-semibold text-ink"><Coins aria-hidden="true" className="h-4 w-4 text-primary-600" />{summary.credits.label || 'Request credits'}</dt>
                  <dd className="mt-1 text-3xl font-black tabular-nums text-ink">{summary.credits.balance}</dd>
                  <dd className="mt-1 text-xs text-muted">{summary.credits.monthly_grant} added each month with your plan. Spent when you create a lead request.</dd>
                </div>
                {summary.enrichment_credits && (
                  <div className="rounded-xl border border-line p-4">
                    <dt className="flex items-center gap-2 text-sm font-semibold text-ink"><Mail aria-hidden="true" className="h-4 w-4 text-primary-600" />{summary.enrichment_credits.label || 'Email lookup credits'}</dt>
                    <dd aria-label="Email lookup credit balance" className="mt-1 text-3xl font-black tabular-nums text-ink">{summary.enrichment_credits.balance}</dd>
                    <dd className="mt-1 text-xs text-muted">Yours alone, not shared with the organization. Spent only on hits that use the platform&apos;s provider keys.</dd>
                  </div>
                )}
              </dl>
              {summary.credits.recent?.length > 0 && (
                <ul aria-label="Recent request credit activity" className="mt-4 divide-y divide-line rounded-xl border border-line text-sm">
                  {summary.credits.recent.map((c, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                      <span className="min-w-0 truncate text-ink">{c.label || c.kind}{c.note ? <span className="text-muted"> · {c.note}</span> : null}</span>
                      <span className={clsx('tabular-nums font-semibold', c.amount < 0 ? 'text-muted' : 'text-ok')}>{c.amount > 0 ? '+' : ''}{c.amount}</span>
                    </li>
                  ))}
                </ul>
              )}
              {topup && (
                topup.providers?.length > 0 ? (
                  <form onSubmit={buyCredits} className="mt-5 flex flex-wrap items-end gap-3">
                    <div>
                      <label htmlFor="topup-pack" className="label">Credit pack</label>
                      <select id="topup-pack" className="input h-10 py-0 text-sm" value={pack} disabled={!topup.can_manage || buying} onChange={(e) => setPack(e.target.value)}>
                        {topup.packs.map((p) => <option key={p.credits} value={p.credits}>{p.credits} credits, ${p.price_usd}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="topup-target" className="label">Add to</label>
                      <select id="topup-target" className="input h-10 py-0 text-sm" value={target} disabled={!topup.can_manage || buying} onChange={(e) => setTarget(e.target.value)}>
                        <option value="requests">Request credits</option>
                        <option value="enrichment">Email lookup credits</option>
                      </select>
                    </div>
                    <Button type="submit" loading={buying} disabled={!topup.can_manage}>Add credits</Button>
                    {!topup.can_manage && <p className="basis-full text-xs text-muted">Only owners and admins can add credits.</p>}
                  </form>
                ) : (
                  <p className="mt-5 text-sm text-muted">Adding credits is not enabled on this server yet.</p>
                )
              )}
              {topupMsg && <p role={topupMsg.ok ? 'status' : 'alert'} className={clsx('mt-4 rounded-xl p-3 text-sm font-medium', topupMsg.ok ? 'bg-ok-soft text-ok' : 'bg-bad-soft text-bad')}>{topupMsg.text}</p>}
            </Section>

            <Section id="plans" title="Plans" description={summary.can_manage ? 'Upgrade any time. Limits reset on the 1st of each month.' : 'Only owners and admins can change the plan.'} icon={CreditCard}>
              {providers.length > 1 && (
                <div className="mb-4 flex items-center gap-2 text-sm">
                  <label htmlFor="provider" className="font-semibold text-ink">Pay with</label>
                  <select id="provider" className="input h-10 w-40 py-0 text-sm capitalize" value={provider} onChange={(e) => setProvider(e.target.value)}>
                    {providers.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
              )}
              <div className="grid gap-4 md:grid-cols-3">
                {plans.map((p) => {
                  const current = p.id === summary.plan.id
                  return (
                    <div key={p.id} className={clsx('relative rounded-2xl border p-5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lift', current ? 'border-primary-400 bg-primary-50/60 ring-2 ring-primary-300/50 dark:bg-primary-950/40' : 'border-line bg-surface/70')}>
                      <h3 className="text-lg font-black tracking-tight text-ink">{p.name}</h3>
                      <p className="mt-1 text-3xl font-black tabular-nums text-ink">${p.price_usd_month}<span className="text-sm font-medium text-muted"> / month</span></p>
                      <ul className="mt-4 space-y-2 text-sm text-ink">
                        {p.features.map((f) => <li key={f} className="flex items-start gap-2"><Check aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ok" />{f}</li>)}
                      </ul>
                      <div className="mt-5">
                        {current ? (
                          <span className="inline-block rounded-full bg-primary-100 px-3 py-1 text-xs font-bold text-primary-800 dark:bg-primary-900/60 dark:text-primary-200">Current plan</span>
                        ) : p.id === 'free' ? null : (
                          <Button className="w-full" disabled={!summary.can_manage || providers.length === 0} loading={busyPlan === p.id} onClick={() => checkout(p.id)} aria-label={`Upgrade to ${p.name}`}>
                            Upgrade to {p.name}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
              {providers.length === 0 && <p className="mt-4 text-sm text-muted">Online checkout is not enabled on this server yet.</p>}
              {notice && <p role="alert" className="mt-4 rounded-xl bg-bad-soft p-3 text-sm font-medium text-bad">{notice}</p>}
            </Section>

            <Section id="invoices" title="Invoices" description="Receipts for payments made through your plan." icon={Receipt}>
              {invoices.length === 0 ? (
                <EmptyState icon={Receipt} title="No invoices yet" description="Invoices appear here after your first payment." className="py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">Invoices</caption>
                    <thead className="text-xs uppercase tracking-wide text-muted">
                      <tr><th scope="col" className="py-2 pr-4">Date</th><th scope="col" className="py-2 pr-4">Amount</th><th scope="col" className="py-2 pr-4">Status</th><th scope="col" className="py-2">Receipt</th></tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {invoices.map((i) => (
                        <tr key={i.id}>
                          <td className="py-2.5 pr-4">{i.created_at ? new Date(i.created_at).toLocaleDateString() : '-'}</td>
                          <td className="py-2.5 pr-4 tabular-nums">{money(i.amount, i.currency)}</td>
                          <td className="py-2.5 pr-4 capitalize">{i.status}</td>
                          <td className="py-2.5">{i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary-700 hover:underline dark:text-primary-300">View</a> : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Section>
          </div>
        )}
      </div>
    </div>
  )
}
