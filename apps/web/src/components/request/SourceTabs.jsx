import { useRef, useState } from 'react'
import clsx from 'clsx'
import { PenLine, Globe, FileText, Sparkles, Upload, X, CheckCircle2, Loader2 } from 'lucide-react'
import { api } from '../../api'
import { Button, Field } from '../kit'

const AI_CHIPS = ['Add target audience', 'Add integrations', 'Add pricing model', 'Expand pain points']

const TABS = [
  { id: 'describe', label: 'Describe', Icon: PenLine },
  { id: 'website', label: 'Website', Icon: Globe },
  { id: 'documents', label: 'Documents', Icon: FileText },
]

function formatSize(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export default function SourceTabs({
  activeTab,
  onTabChange,
  description,
  onDescriptionChange,
  websiteUrlInput,
  onWebsiteUrlInputChange,
  scrapedUrls,
  onScrape,
  scraping,
  onRemoveUrl,
  uploadedFiles,
  onFilesChange,
  onRemoveFile,
  errors,
  productName = '',
  productCategory = '',
  disabled = false,
}) {
  const fileInputRef = useRef(null)
  const [generatingChip, setGeneratingChip] = useState(null)
  const [chipError, setChipError] = useState('')

  const handleChipClick = async (chip) => {
    if (generatingChip) return
    setGeneratingChip(chip)
    setChipError('')
    try {
      const res = await api.suggestChip({
        chip_type: chip,
        product_name: productName || '',
        product_category: productCategory || '',
        current_description: description || '',
      })
      if (res && res.suggestion) {
        const clean = res.suggestion.trim()
        onDescriptionChange(description ? `${description.trim()}\n\n${clean}` : clean)
      }
    } catch {
      // Fall back to a prompt the user can finish by hand, and say so.
      onDescriptionChange((description ? description + '\n' : '') + chip + ': ')
      setChipError("Couldn't generate a suggestion, so a prompt was added for you to fill in.")
    } finally {
      setGeneratingChip(null)
    }
  }

  return (
    <section className="card">
      <div role="tablist" aria-label="Where to read your product from" className="flex border-b border-line">
        {TABS.map(({ id, label, Icon }) => (
          <button
            key={id}
            id={`source-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`source-panel-${id}`}
            onClick={() => onTabChange(id)}
            className={clsx(
              '-mb-px flex min-h-[2.75rem] flex-1 items-center justify-center gap-2 border-b-2 px-3 text-sm font-semibold transition-colors sm:flex-none sm:px-5',
              activeTab === id ? 'border-primary-600 text-primary-800 dark:border-primary-400 dark:text-primary-300' : 'border-transparent text-muted hover:text-ink',
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === 'describe' && (
        <div role="tabpanel" id="source-panel-describe" aria-labelledby="source-tab-describe" className="space-y-4 p-5">
          <Field
            as="textarea"
            rows={7}
            label="Product description"
            placeholder="Describe what your product does, who it helps, and how it creates value."
            value={description}
            disabled={disabled}
            onChange={(e) => onDescriptionChange(e.target.value)}
          />
          <div className="border-t border-line pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted">AI suggestions</span>
              {AI_CHIPS.map((chip) => {
                const busy = generatingChip === chip
                return (
                  <button
                    key={chip}
                    type="button"
                    disabled={disabled || !!generatingChip}
                    aria-busy={busy || undefined}
                    onClick={() => handleChipClick(chip)}
                    className="inline-flex h-10 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-head disabled:opacity-60 sm:h-8"
                  >
                    {busy ? <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" /> : <Sparkles aria-hidden="true" className="h-3 w-3 text-muted" />}
                    {busy ? 'Generating…' : chip}
                  </button>
                )
              })}
            </div>
            {chipError && (
              <p role="alert" className="mt-2 text-xs font-medium text-warn">
                {chipError}
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'website' && (
        <div role="tabpanel" id="source-panel-website" aria-labelledby="source-tab-website" className="space-y-4 p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <Field
              className="flex-1"
              label="Website URL"
              type="text"
              inputMode="url"
              placeholder="example.com"
              value={websiteUrlInput}
              disabled={disabled || scraping}
              error={errors?.website}
              hint="Quarry reads the page and fills in what it can find."
              onChange={(e) => onWebsiteUrlInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), !scraping && onScrape())}
            />
            <Button className="sm:mt-[1.625rem]" loading={scraping} disabled={disabled} onClick={onScrape}>
              {!scraping && <Globe aria-hidden="true" className="h-4 w-4" />}
              {scraping ? 'Scraping…' : 'Scrape'}
            </Button>
          </div>

          {scrapedUrls.length > 0 && (
            <ul className="space-y-2">
              {scrapedUrls.map((item, i) => (
                <li key={`${item.url}-${i}`} className="rounded-md border border-line">
                  <div className="flex items-center gap-3 px-3 py-2">
                    <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0 text-ok" />
                    <span title={item.url} className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                      {item.url}
                    </span>
                    <button type="button" aria-label={`Remove ${item.url}`} onClick={() => onRemoveUrl(i)} className="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-head hover:text-bad sm:h-8 sm:w-8">
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </div>
                  {item.summary && (
                    <div className="border-t border-line px-3 py-2">
                      <p className="text-xs font-semibold text-muted">Extracted summary</p>
                      <p className="mt-1 line-clamp-3 break-words text-xs text-ink">{item.summary}</p>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'documents' && (
        <div role="tabpanel" id="source-panel-documents" aria-labelledby="source-tab-documents" className="space-y-4 p-5">
          <div
            className="rounded-md border border-dashed border-line p-6 text-center"
            onDrop={(e) => {
              e.preventDefault()
              if (!disabled) onFilesChange((prev) => [...prev, ...Array.from(e.dataTransfer.files)])
            }}
            onDragOver={(e) => e.preventDefault()}
          >
            <input
              ref={fileInputRef}
              type="file"
              aria-label="Choose documents"
              accept=".txt,.pdf,.docx,.pptx"
              multiple
              className="sr-only"
              tabIndex={-1}
              onChange={(e) => {
                onFilesChange((prev) => [...prev, ...Array.from(e.target.files)])
                e.target.value = ''
              }}
            />
            <Upload aria-hidden="true" className="mx-auto mb-2 h-6 w-6 text-muted" />
            <p className="text-sm text-ink">Drop files here, or</p>
            <Button variant="secondary" size="sm" className="mt-2" disabled={disabled} onClick={() => fileInputRef.current?.click()}>
              Choose files
            </Button>
            <p className="mt-2 text-xs text-muted">.txt, .pdf, .docx or .pptx. They are read when you generate the ICP.</p>
          </div>

          {uploadedFiles.length > 0 && (
            <ul className="space-y-2">
              {uploadedFiles.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                    <span title={f.name} className="truncate text-sm font-medium text-ink">
                      {f.name}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs tabular-nums text-muted">{formatSize(f.size)}</span>
                    <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemoveFile(i)} className="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:bg-head hover:text-bad sm:h-8 sm:w-8">
                      <X aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
