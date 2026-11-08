import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'

const STEPS = [
  ['Describe your customer', 'Start a new request: say what you sell and who you want to reach.'],
  ['Review the profile', 'Quarry turns that into an ideal customer profile you can edit.'],
  ['Find companies', 'It searches the live web for matching companies and their decision makers.'],
  ['Check and export', 'Review each lead, then export a CSV, Excel or PDF.'],
]

const FAQ = [
  ['How sure is an email?', 'Quarry checks that the domain can receive mail and, on request, whether the mailbox accepts it. Neither is a guarantee, so test a small batch before a big send.'],
  ['Why did a run find fewer leads than I asked for?', 'Some sites block automated visits, and search results thin out for narrow profiles. The request page shows the reason when a run fails.'],
  ['Whose search quota does a run use?', 'Your own Serper key, set in Account settings. A bad or exhausted key shows up as a clear error on the request.'],
]

/** A right-hand help panel. Escape or the overlay closes it; focus moves to the close button on open. */
export default function HelpDrawer({ onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    closeRef.current?.focus()
    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[60]">
      <div className="absolute inset-0 bg-ink/45 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside role="dialog" aria-modal="true" aria-labelledby="help-title" className="absolute inset-y-0 right-0 flex h-full w-full max-w-md flex-col border-l border-line bg-surface/95 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id="help-title" className="text-base font-semibold text-ink">
            Help center
          </h2>
          <button ref={closeRef} type="button" aria-label="Close help" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-head hover:text-ink">
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">How it works</h3>
            <ol className="space-y-4">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-semibold text-ink">{i + 1}</span>
                  <div>
                    <p className="text-sm font-semibold text-ink">{title}</p>
                    <p className="mt-0.5 text-sm text-muted">{text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Questions</h3>
            <div className="space-y-2">
              {FAQ.map(([question, answer]) => (
                <details key={question} className="rounded-md border border-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-ink">{question}</summary>
                  <p className="mt-2 text-sm text-muted">{answer}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  )
}
