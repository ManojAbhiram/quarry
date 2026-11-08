import { useState } from 'react'
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { Menu, useToast } from '../../components/kit'

const FORMATS = [
  { id: 'csv', label: 'CSV (.csv)', failure: 'CSV' },
  { id: 'xlsx', label: 'Excel (.xlsx)', failure: 'Excel' },
  { id: 'pdf', label: 'PDF report (.pdf)', failure: 'PDF' },
]

/**
 * Export dropdown. `exporter(format)` returns a promise (it triggers the download). While one export runs the
 * menu shows a busy state and ignores further picks; a failure raises an error toast.
 */
export default function ExportMenu({ exporter, label = 'Export', disabled = false }) {
  const toast = useToast()
  const [busy, setBusy] = useState(null)

  const run = async (format, close) => {
    if (busy) return
    close()
    setBusy(format.id)
    try {
      await exporter(format.id)
    } catch (err) {
      console.error('Export failed:', err)
      toast.push({ type: 'error', message: `Could not export ${format.failure}. ${err?.isNetworkError ? 'Check your connection and try again.' : 'Please try again.'}` })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Menu
      label={busy ? 'Exporting' : label}
      buttonClassName="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-head disabled:opacity-60"
      panelClassName="w-52 py-1"
      button={
        <>
          {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Download aria-hidden="true" className="h-4 w-4" />}
          <span>{busy ? 'Exporting…' : label}</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 text-muted" />
        </>
      }
    >
      {({ close }) => (
        <div role="group" aria-label="Export format">
          {FORMATS.map((format) => (
            <button
              key={format.id}
              type="button"
              disabled={disabled || Boolean(busy)}
              onClick={() => run(format, close)}
              className="flex h-10 w-full items-center px-4 text-left text-sm text-ink hover:bg-head disabled:opacity-60"
            >
              {format.label}
            </button>
          ))}
        </div>
      )}
    </Menu>
  )
}
