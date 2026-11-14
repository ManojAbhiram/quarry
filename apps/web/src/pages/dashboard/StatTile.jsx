/** A request count that opens its corresponding filter. */
export default function StatTile({ id, label, value, hint, onClick }) {
  return (
    <button id={id} type="button" onClick={onClick} className="dashboard-stat">
      <span className="dashboard-stat-label text-sm font-medium text-muted">{label}</span>
      <span className="dashboard-stat-value mt-2 block text-3xl font-medium tabular-nums text-ink">{Number(value || 0).toLocaleString()}</span>
      {hint && <span className="mt-1 text-xs text-muted">{hint}</span>}
    </button>
  )
}
