import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ToastProvider, useToast, ErrorBoundary, NotFound, BootScreen } from './index'

function Pusher({ type, message }) {
  const toast = useToast()
  return <button onClick={() => toast.push({ type, message })}>push</button>
}

describe('Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows a success message politely and removes it after a few seconds', async () => {
    render(
      <ToastProvider>
        <Pusher type="success" message="Saved" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'push' }))
    expect(screen.getByRole('status')).toHaveTextContent('Saved')
    act(() => {
      vi.advanceTimersByTime(6000)
    })
    expect(screen.queryByText('Saved')).not.toBeInTheDocument()
  })

  it('is placed at the top so it cannot cover the action buttons of a form', async () => {
    render(
      <ToastProvider>
        <Pusher type="error" message="Could not save" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'push' }))
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(region.className).toMatch(/top-16/)
    expect(region.className).not.toMatch(/bottom-/)
    expect(region.className).toMatch(/pointer-events-none/)
  })

  it('announces an error assertively and keeps it until it is dismissed', async () => {
    render(
      <ToastProvider>
        <Pusher type="error" message="Could not save" />
      </ToastProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'push' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save')
    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(screen.getByText('Could not save')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument()
  })

  it('throws a clear error when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Pusher type="info" message="x" />)).toThrow(/ToastProvider/)
    spy.mockRestore()
  })
})

describe('ErrorBoundary', () => {
  let shouldThrow
  function Bomb() {
    if (shouldThrow) throw new Error('render exploded')
    return <p>all good</p>
  }

  beforeEach(() => {
    shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('replaces a crashed page with a readable error instead of a blank screen', () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong')
    expect(screen.getByRole('alert')).toHaveTextContent('render exploded')
  })

  it('recovers when the user tries again and the problem is gone', async () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    shouldThrow = false
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByText('all good')).toBeInTheDocument()
  })

  it('resets on its own when the resetKey changes (for example after navigating)', () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/a">
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    shouldThrow = false
    rerender(
      <ErrorBoundary resetKey="/b">
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('all good')).toBeInTheDocument()
  })
})

describe('NotFound', () => {
  it('says the page does not exist and links back to the app', () => {
    render(
      <MemoryRouter>
        <NotFound />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /back to requests/i })).toHaveAttribute('href', '/lead-requests')
  })
})

describe('BootScreen', () => {
  it('shows a labelled loading state while the session is being checked', () => {
    render(<BootScreen />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
  })

  it('shows what went wrong and a retry when the session could not be checked', async () => {
    const onRetry = vi.fn()
    render(<BootScreen error={new Error('Failed to fetch')} onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })
})
