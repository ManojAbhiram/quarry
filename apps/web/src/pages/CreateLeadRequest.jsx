import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import clsx from 'clsx'
import { ArrowRight, Building2, Sparkles } from 'lucide-react'
import { api } from '../api'
import { useLeads } from '../context/LeadContext'
import { Button, Field, PageHeader } from '../components/kit'
import SearchKeyNotice, { useSearchKey } from './requests/SearchKeyNotice'

const FLOW_TYPES = [
  {
    id: 'icp',
    title: 'Generate from ICP',
    description: 'Describe your product, generate an Ideal Customer Profile, and let Quarry discover matching companies and decision makers.',
    icon: Sparkles,
  },
  {
    id: 'direct_companies',
    title: 'I already have companies',
    description: 'Provide one company, a comma-separated list, or a CSV. We find direct decision makers for the roles you choose.',
    icon: Building2,
  },
]

const PRIMARY_GOALS = ['Generate Pipeline', 'Account Expansion', 'Book Meetings', 'Competitive Displacement', 'Brand Awareness']
const TEAM_SIZES = ['1–10', '11–50', '51–200', '201–500', '500+']

export default function CreateLeadRequest() {
  const navigate = useNavigate()
  const { refreshRequests, requests } = useLeads()
  const searchKey = useSearchKey()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [primaryGoal, setPrimaryGoal] = useState('')
  const [teamSize, setTeamSize] = useState('')
  const [flowType, setFlowType] = useState('icp')
  const [loading, setLoading] = useState(false)
  const [nameError, setNameError] = useState('')
  const [error, setError] = useState('')

  const hasRequests = requests && requests.length > 0

  const handleCreate = async (e) => {
    e.preventDefault()
    if (loading) return
    if (!name.trim()) {
      setNameError('Request name is required.')
      return
    }
    setNameError('')
    setError('')
    setLoading(true)
    try {
      const result = await api.createLeadRequest({
        name: name.trim(),
        description: description.trim() || null,
        primary_goal: primaryGoal || null,
        target_team_size: teamSize || null,
        request_type: flowType,
      })
      await refreshRequests()
      // Route to the matching workflow based on the selected flow type.
      navigate(flowType === 'direct_companies' ? `/request/${result.id}/companies` : `/request/${result.id}/intake`)
    } catch (err) {
      setError(err?.isNetworkError ? "Couldn't reach Quarry. Check your connection and try again." : err?.message || 'Failed to create the request.')
      setLoading(false)
    }
  }

  return (
    <div className="page-container h-full overflow-y-auto pb-12">
      <div className="mx-auto max-w-2xl">
        <PageHeader
          title={hasRequests ? 'New request' : 'Create your first request'}
          description={
            hasRequests
              ? 'Name the search and choose how to find leads. You add the details in the next step.'
              : 'Welcome to Quarry. Name your first search and choose how to find leads. You add the details in the next step.'
          }
        />

        <SearchKeyNotice state={searchKey} className="mb-5" />

        <form onSubmit={handleCreate} noValidate className="card space-y-6 p-5 sm:p-6">
          {error && (
            <div role="alert" className="rounded-md bg-bad-soft p-3 text-sm font-medium text-bad">
              {error}
            </div>
          )}

          <fieldset>
            <legend className="label">How do you want to find leads?</legend>
            <div role="radiogroup" aria-label="How do you want to find leads?" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {FLOW_TYPES.map((f) => {
                const Icon = f.icon
                const selected = flowType === f.id
                return (
                  <button
                    key={f.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={loading}
                    onClick={() => setFlowType(f.id)}
                    className={clsx(
                      'rounded-lg border p-4 text-left transition-colors disabled:opacity-60',
                      selected ? 'border-primary-600 bg-primary-50 dark:border-primary-400 dark:bg-primary-950/60' : 'border-line bg-surface hover:bg-head',
                    )}
                  >
                    <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                      <Icon aria-hidden="true" className={clsx('h-4 w-4', selected ? 'text-primary-700 dark:text-primary-300' : 'text-muted')} />
                      {f.title}
                    </span>
                    <span className="mt-1.5 block text-xs text-muted">{f.description}</span>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <Field
            id="lead-request-name"
            label="Request name"
            required
            value={name}
            disabled={loading}
            maxLength={200}
            placeholder="e.g. Q3 Enterprise Outreach"
            hint="Shown in your list of requests."
            error={nameError}
            onChange={(e) => {
              setName(e.target.value)
              if (nameError) setNameError('')
            }}
          />

          <Field
            id="lead-request-description"
            as="textarea"
            rows={3}
            label="Description"
            value={description}
            disabled={loading}
            placeholder="What is the goal of this request?"
            onChange={(e) => setDescription(e.target.value)}
          />

          {flowType === 'icp' && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field id="primary-goal" as="select" label="Primary goal" value={primaryGoal} disabled={loading} onChange={(e) => setPrimaryGoal(e.target.value)}>
                <option value="">Select a goal</option>
                {PRIMARY_GOALS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Field>
              <Field id="target-team-size" as="select" label="Target team size" value={teamSize} disabled={loading} onChange={(e) => setTeamSize(e.target.value)}>
                <option value="">Select team size</option>
                {TEAM_SIZES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Field>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-line pt-5">
            <Button variant="ghost" disabled={loading} onClick={() => navigate('/lead-requests')}>
              {hasRequests ? 'Cancel' : 'Skip for now'}
            </Button>
            <Button type="submit" id="create-lead-request-btn" loading={loading}>
              {loading ? 'Creating…' : 'Create request'}
              {!loading && <ArrowRight aria-hidden="true" className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
