import { useId } from 'react'
import clsx from 'clsx'

/** A labelled input. An `error` is announced, marks the input invalid and is linked to it for screen readers. */
export default function Field({ label, error, hint, required, as: Tag = 'input', id, className, ...props }) {
  const autoId = useId()
  const inputId = id || autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const describedBy = [hint && hintId, error && errorId].filter(Boolean).join(' ') || undefined

  return (
    <div className={className}>
      <label htmlFor={inputId} className="label">
        {label}
        {required && (
          <span aria-hidden="true" className="text-bad ml-0.5">
            *
          </span>
        )}
      </label>
      <Tag
        id={inputId}
        required={required}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        className={clsx('input', Tag !== 'input' && 'h-auto py-2', error && 'border-bad focus:border-bad focus:ring-bad/20')}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  )
}
