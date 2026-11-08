import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button, Field, StatusBadge, EmptyState, ErrorState, Skeleton, PageHeader } from './index'

describe('Button', () => {
  it('fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('is a plain button by default so it never submits a form by accident', () => {
    render(<Button>Save</Button>)
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('type', 'button')
  })

  it('while loading it is disabled, announces busy and ignores a second click', async () => {
    const onClick = vi.fn()
    render(<Button loading onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: /Save/ })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('Field', () => {
  it('connects the label to the input', () => {
    render(<Field label="Email" />)
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('shows an error as an alert, marks the input invalid and links them', () => {
    render(<Field label="Email" error="Enter a valid email" />)
    const input = screen.getByLabelText('Email')
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter a valid email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain(alert.id)
  })

  it('shows a hint without marking the input invalid', () => {
    render(<Field label="Leads" hint="Between 1 and 200" />)
    expect(screen.getByText('Between 1 and 200')).toBeInTheDocument()
    expect(screen.getByLabelText('Leads')).not.toHaveAttribute('aria-invalid', 'true')
  })

  it('marks a required field', () => {
    render(<Field label="Name" required />)
    expect(screen.getByLabelText(/Name/)).toBeRequired()
  })
})

describe('StatusBadge', () => {
  it.each([
    ['Pending', 'Pending'],
    ['running', 'Running'],
    ['Completed', 'Completed'],
    ['failed', 'Failed'],
    ['partial', 'Partial'],
  ])('shows %s as the text %s (never colour alone)', (status, label) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText(label)).toBeInTheDocument()
  })

  it('shows an unknown status as given instead of hiding it', () => {
    render(<StatusBadge status="Cancelled" />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
  })
})

describe('EmptyState and ErrorState', () => {
  it('EmptyState shows the title, the explanation and the next action', async () => {
    const onClick = vi.fn()
    render(<EmptyState title="No requests yet" description="Create your first request." action={{ label: 'New request', onClick }} />)
    expect(screen.getByRole('heading', { name: 'No requests yet' })).toBeInTheDocument()
    expect(screen.getByText('Create your first request.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New request' }))
    expect(onClick).toHaveBeenCalled()
  })

  it('ErrorState announces the problem and offers a retry', async () => {
    const onRetry = vi.fn()
    render(<ErrorState title="Could not load requests" message="Failed to fetch" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load requests')
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to fetch')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalled()
  })

  it('ErrorState has no retry button when there is nothing to retry', () => {
    render(<ErrorState title="Not allowed" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('Skeleton and PageHeader', () => {
  it('Skeleton is hidden from screen readers', () => {
    const { container } = render(<Skeleton className="h-4 w-20" />)
    expect(container.firstChild).toHaveAttribute('aria-hidden', 'true')
  })

  it('PageHeader renders the title as the page heading, with description and actions', () => {
    render(<PageHeader title="Requests" description="Your lead runs" actions={<button>New</button>} />)
    expect(screen.getByRole('heading', { level: 1, name: 'Requests' })).toBeInTheDocument()
    expect(screen.getByText('Your lead runs')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
  })
})
