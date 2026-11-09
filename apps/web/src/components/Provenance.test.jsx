import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Provenance, { pickProvenance } from './Provenance'

const prov = {
  email: { source_url: 'https://www.acme.com/contact', retrieved_at: '2026-01-03T10:00:00Z', method: 'page_scrape' },
}

describe('Provenance', () => {
  it('renders nothing when no source was recorded', () => {
    const { container } = render(<Provenance provenance={{}} field="email" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('picks the first field that has a source', () => {
    expect(pickProvenance(prov, ['contact_email', 'email']).source_url).toMatch(/acme/)
    expect(pickProvenance(null, 'email')).toBeNull()
  })

  it('shows the source link, method and date on click, and closes with Escape', async () => {
    const user = userEvent.setup()
    render(<Provenance provenance={prov} field="email" label="the email" />)
    const btn = screen.getByRole('button', { name: /where the email came from/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    await user.click(btn)
    const dialog = screen.getByRole('dialog', { name: /source for the email/i })
    expect(dialog).toHaveTextContent('acme.com')
    expect(dialog).toHaveTextContent('Read from the company page')
    expect(dialog).toHaveTextContent(/Retrieved .*2026/)
    expect(screen.getByRole('link', { name: 'acme.com' })).toHaveAttribute('href', 'https://www.acme.com/contact')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens on hover and keyboard focus', async () => {
    const user = userEvent.setup()
    render(<Provenance provenance={prov} field="email" label="the email" />)
    await user.tab()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
