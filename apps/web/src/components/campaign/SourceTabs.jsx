import { useRef, useState } from 'react'
import { PenLine, Globe, FileText, Sparkles, Upload, X, CheckCircle2, Loader2, ChevronDown, Link2 } from 'lucide-react'
import { api } from '../../api'

const AI_CHIPS = ['Add target audience', 'Add integrations', 'Add pricing model', 'Expand pain points']

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
  productCategory = ''
}) {
  const fileInputRef = useRef(null)
  const [generatingChip, setGeneratingChip] = useState(null)

  const tabs = [
    { id: 'describe', label: 'Describe', icon: <PenLine className="w-3.5 h-3.5" /> },
    { id: 'website', label: 'Website', icon: <Globe className="w-3.5 h-3.5" /> },
    { id: 'documents', label: 'Documents', icon: <FileText className="w-3.5 h-3.5" /> },
  ]

  const handleChipClick = async (chip) => {
    if (generatingChip) return
    setGeneratingChip(chip)
    try {
      const res = await api.suggestChip({
        chip_type: chip,
        product_name: productName || '',
        product_category: productCategory || '',
        current_description: description || '',
      })
      if (res && res.suggestion) {
        const cleanSuggestion = res.suggestion.trim()
        const newText = description 
          ? `${description.trim()}\n\n${cleanSuggestion}`
          : cleanSuggestion
        onDescriptionChange(newText)
      }
    } catch (err) {
      console.error('Failed to generate suggestion:', err)
      onDescriptionChange((description ? description + '\n' : '') + chip + ': ')
    } finally {
      setGeneratingChip(null)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900/80 border border-slate-200/80 dark:border-slate-700/60 rounded-2xl overflow-hidden">
      {/* Tab bar */}
      <div className="flex border-b border-slate-200/80 dark:border-slate-700/60">
        {tabs.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => onTabChange(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === t.id
                ? 'border-violet-600 text-violet-700 dark:text-violet-400 bg-violet-50/50 dark:bg-violet-900/10'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Describe */}
      {activeTab === 'describe' && (
        <div className="p-5 space-y-4">
          <textarea
            rows={8}
            placeholder="Describe what your product does, who it helps, and how it creates value."
            value={description}
            onChange={e => onDescriptionChange(e.target.value)}
            className="w-full px-4 py-3 bg-transparent border-0 outline-none text-sm text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 resize-none"
          />
          {/* AI suggestions chips */}
          <div className="border-t border-slate-100 dark:border-slate-800 pt-4 flex flex-wrap gap-2">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 self-center">AI Suggestions</span>
            {AI_CHIPS.map(chip => {
              const isGenerating = generatingChip === chip
              return (
                <button
                  key={chip}
                  type="button"
                  disabled={!!generatingChip}
                  onClick={() => handleChipClick(chip)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full border transition-all active:scale-95 disabled:opacity-60 cursor-pointer select-none
                    ${isGenerating 
                      ? 'bg-violet-100 text-violet-850 dark:bg-violet-900/40 dark:text-violet-300 border-violet-400 animate-pulse' 
                      : 'bg-violet-50 dark:bg-violet-900/20 text-violet-750 dark:text-violet-400 border-violet-200 dark:border-violet-800/50 hover:bg-violet-100 dark:hover:bg-violet-900/30'
                    }
                  `}
                >
                  {isGenerating ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Sparkles className="w-3 h-3 text-violet-650" />
                  )}
                  {isGenerating ? 'Generating...' : chip}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Website */}
      {activeTab === 'website' && (
        <div className="p-5 space-y-4">
          {errors?.website && (
            <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 px-3 py-2 rounded-lg">{errors.website}</p>
          )}
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Enter website URL to scrape..."
                value={websiteUrlInput}
                onChange={e => onWebsiteUrlInputChange(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), onScrape())}
                className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 focus:border-violet-400 transition-all"
              />
            </div>
            <button
              type="button"
              onClick={onScrape}
              disabled={scraping}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl transition-all disabled:opacity-60"
            >
              {scraping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
              Scrape
            </button>
          </div>

          {scrapedUrls.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{scrapedUrls.length} of 3 URLs added</p>
              {scrapedUrls.map((item, i) => (
                <ScrapedUrlItem key={i} item={item} onRemove={() => onRemoveUrl(i)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Documents */}
      {activeTab === 'documents' && (
        <div className="p-5 space-y-4">
          <div
            className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-xl p-8 text-center hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors cursor-pointer relative"
            onClick={() => fileInputRef.current?.click()}
            onDrop={e => { e.preventDefault(); const f = Array.from(e.dataTransfer.files); onFilesChange(prev => [...prev, ...f]) }}
            onDragOver={e => e.preventDefault()}
          >
            <input ref={fileInputRef} type="file" accept=".txt,.pdf,.docx,.pptx" multiple className="hidden" onChange={e => onFilesChange(prev => [...prev, ...Array.from(e.target.files)])} />
            <Upload className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Drag and drop files here</p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">or click to browse from your computer</p>
            <button type="button" className="mt-3 text-sm font-semibold text-violet-600 dark:text-violet-400 hover:text-violet-700">Select Files</button>
            <p className="text-[10px] text-slate-400 mt-2">Files are processed securely. We never store raw document content.</p>
          </div>

          {uploadedFiles.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">Uploaded Documents</p>
              {uploadedFiles.map((f, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60">
                  <div className="flex items-center gap-3 min-w-0">
                    <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{f.name}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Extraction complete</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-slate-400">{(f.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button type="button" onClick={() => onRemoveFile(i)} className="text-slate-400 hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ScrapedUrlItem({ item, onRemove }) {
  const conf = item.confidence || 0
  const confColor = conf >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
  return (
    <div className="border border-slate-200 dark:border-slate-700/60 rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200 flex-1 truncate">{item.url}</span>
        {/* <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${confColor}`}>{conf}% confidence</span> */}
        <button type="button" onClick={onRemove} className="text-slate-400 hover:text-rose-500 transition-colors"><X className="w-4 h-4" /></button>
      </div>
      {item.summary && (
        <div className="px-4 pb-3">
          <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">Extracted Summary</p>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">{item.summary}</p>
        </div>
      )}
    </div>
  )
}
