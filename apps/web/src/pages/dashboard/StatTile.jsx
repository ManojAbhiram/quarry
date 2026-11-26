/** A request count that opens its corresponding filter. */
export default function StatTile({ id, label, value, hint, onClick }) {
  return (
    <button id={id} type="button" onClick={onClick} className="card flex min-w-0 flex-col items-start p-4 text-left transition-colors hover:bg-head focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-btn sm:p-5">
      <span className="text-sm font-medium text-muted">{label}</span>
      <span className="mt-2 block text-3xl font-semibold tabular-nums text-ink">{Number(value || 0).toLocaleString()}</span>
      {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
    </button>
  )
}
