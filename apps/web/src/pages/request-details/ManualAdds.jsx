import { useState } from 'react'
import { Trash2, Building2 } from 'lucide-react'
import { Button, EmptyState, Field } from '../../components/kit'
import { ExtLink } from './ui'

/** Companies the user added by hand to this request. */
export default function ManualAdds({ items, onChange }) {
  const [form, setForm] = useState({ company_name: '', website: '' })
  const canAdd = form.company_name.trim().length > 0

  const add = (event) => {
    event.preventDefault()
    if (!canAdd) return
    onChange([...items, { company_name: form.company_name.trim(), website: form.website.trim(), added_at: new Date().toISOString() }])
    setForm({ company_name: '', website: '' })
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">Add a company</h2>
      <form onSubmit={add} className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field label="Company name" value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} placeholder="Acme Inc." />
        <Field label="Website (optional)" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="acme.com" />
        <Button type="submit" disabled={!canAdd}>Add company</Button>
      </form>

      <h3 className="mb-2 mt-6 text-sm font-semibold text-ink">Added companies <span className="font-normal text-muted tabular-nums">({items.length})</span></h3>
      {items.length === 0 ? (
        <EmptyState icon={Building2} className="py-8" title="No companies added yet" description="Companies you add here are kept with this request." />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {items.map((comp, i) => (
            <li key={`${comp.company_name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink break-words">{comp.company_name}</p>
                {comp.website && <p className="text-xs break-all"><ExtLink href={comp.website.startsWith('http') ? comp.website : `https://${comp.website}`}>{comp.website}</ExtLink></p>}
              </div>
              <button type="button" aria-label={`Remove ${comp.company_name}`} onClick={() => onChange(items.filter((_, idx) => idx !== i))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-muted hover:bg-bad-soft hover:text-bad">
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
