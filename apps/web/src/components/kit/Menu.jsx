import { useCallback, useEffect, useId, useRef, useState } from 'react'
import clsx from 'clsx'

/**
 * A button that opens a floating panel. Closes on Escape (focus returns to the button), on a click outside, or
 * when the content calls `close`. Reports `aria-expanded` so screen readers know the state.
 *
 * `children` is the panel content, or a function receiving `{ close }`.
 */
export default function Menu({ label, button, children, align = 'right', className, buttonClassName, panelClassName, onOpenChange }) {
  const [open, setOpenState] = useState(false)
  const rootRef = useRef(null)
  const buttonRef = useRef(null)
  const panelId = useId()

  const setOpen = useCallback(
    (value) => {
      setOpenState(value)
      onOpenChange?.(value)
    },
    [onOpenChange],
  )

  useEffect(() => {
    if (!open) return undefined
    const onMouseDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen(!open)}
        className={buttonClassName}
      >
        {button}
      </button>
      {open && (
        <div id={panelId} className={clsx('absolute top-full z-50 mt-2 animate-pop-in rounded-2xl border border-white/60 bg-surface/95 shadow-2xl shadow-primary-900/10 ring-1 ring-line/50 backdrop-blur-xl dark:border-line', align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left', panelClassName)}>
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  )
}
