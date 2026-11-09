import { useEffect, useState } from 'react'
import { Beaker, Coins, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { Button } from '../kit'

const usd = (n) => `$${Number(n || 0).toFixed(2)}`

/**
 * Step 2 of the wizard: what the full run is estimated to cost, and an optional sample run
 * (one search, a few candidates) to check the ICP before committing.
 */
export default function LaunchCostPanel({ numLeads, icpDimensions, buildPayload }) {
  const [est, setEst] = useState(null)
  const [estError, setEstError] = useState(false)
  const [sample, setSample] = useState(null)
  const [sampling, setSampling] = useState(false)
  const [sampleError, setSampleError] = useState('')

  useEffect(() => {
    let live = true
    setEstError(false)
    const t = setTimeout(() => {
      Promise.resolve()
        .then(() => api.getUsageEstimate(numLeads, icpDimensions))
        .then((d) => live && setEst(d))
        .catch(() => live && setEstError(true))
    }, 400)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [numLeads, icpDimensions])

  const runSample = async () => {
    setSampling(true)
    setSampleError('')
    try {
      setSample(await api.runSample(buildPayload()))
    } catch (err) {
      setSampleError(err.message || 'The sample run failed.')
    } finally {
      setSampling(false)
    }
  }

  return (
    <section aria-labelledby="launch-cost-title" className="card space-y-4 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Coins aria-hidden="true" className="h-5 w-5 text-primary-600 dark:text-primary-400" />
        <h2 id="launch-cost-title" className="text-base font-black tracking-tight text-ink">Cost estimate</h2>
      </div>

      {estError && <p className="text-sm text-muted">The estimate is not available right now. You can still launch.</p>}
      {!est && !estError && <p aria-live="polite" className="flex items-center gap-2 text-sm text-muted"><Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />Estimating</p>}
      {est && (
        <div>
          <p className="text-sm text-ink">
            About <strong className="tabular-nums">{est.search_calls}</strong> searches and <strong className="tabular-nums">{est.llm_calls}</strong> model calls for <strong className="tabular-nums">{est.num_leads}</strong> leads, roughly{' '}
            <strong className="tabular-nums">{usd(est.cost_usd.typical)}</strong> <span className="text-muted">({usd(est.cost_usd.low)} to {usd(est.cost_usd.high)})</span>.
          </p>
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
            {est.assumptions.map((a) => <li key={a}>{a}</li>)}
          </ul>
          {!est.fits_quota && (
            <p role="alert" className="mt-2 rounded-md bg-warn-soft p-2 text-sm font-medium text-warn">
              This run may exceed your monthly limit ({est.quota.runs_left} runs left, {usd(est.quota.cost_left_usd)} of budget left). Launching could be refused.
            </p>
          )}
        </div>
      )}

      <div className="border-t border-line pt-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" loading={sampling} onClick={runSample}>
            {!sampling && <Beaker aria-hidden="true" className="h-4 w-4" />}
            {sample ? 'Run sample again' : 'Run a sample first'}
          </Button>
          <span className="text-xs text-muted">One search, a few candidate companies, a fraction of the cost. Recommended before a large run.</span>
        </div>
        {sampleError && <p role="alert" className="mt-2 text-sm font-medium text-bad">{sampleError}</p>}
        {sample && (
          <div className="mt-3" aria-live="polite">
            <p className="text-sm text-ink">
              Search used: <em className="break-words">{sample.query}</em>. Sample cost {usd(sample.sample_cost_usd)}.
            </p>
            {sample.samples.length === 0 ? (
              <p className="mt-1 text-sm text-muted">No candidates came back. Broaden your ICP before launching.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                {sample.samples.map((s) => (
                  <li key={s.url} className="px-3 py-2">
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="break-words text-sm font-semibold text-primary-700 hover:underline dark:text-primary-300">{s.title || s.url}</a>
                    {s.snippet && <p className="line-clamp-2 text-xs text-muted">{s.snippet}</p>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
