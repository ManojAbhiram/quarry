import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { X } from 'lucide-react'

const ToastContext = createContext(null)

const TONES = {
  success: 'border-ok/40',
  error: 'border-bad/50',
  info: 'border-line',
}

/**
 * Short messages that don't block the page. Success and info messages announce politely and go away after
 * `duration` ms; an error announces assertively and stays until it is dismissed.
 */
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const nextId = useRef(0)

  const dismiss = useCallback((id) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const push = useCallback(
    ({ type = 'info', message, duration }) => {
      const id = ++nextId.current
      setToasts((all) => [...all, { id, type, message }])
      const ms = duration ?? (type === 'error' ? 0 : 5000)
      if (ms > 0) setTimeout(() => dismiss(id), ms)
      return id
    },
    [dismiss],
  )

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === 'error' ? 'alert' : 'status'}
            className={clsx('pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl border bg-surface/90 p-4 text-sm text-ink shadow-xl backdrop-blur-xl', TONES[t.type])}
          >
            <p className="flex-1 break-words">{t.message}</p>
            <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="rounded p-0.5 text-muted hover:bg-head hover:text-ink">
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside <ToastProvider>')
  return context
}
