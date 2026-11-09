import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import CompanyLogo, { domainOf } from './CompanyLogo'

describe('domainOf', () => {
  it('extracts a bare hostname', () => {
    expect(domainOf('https://www.Acme.io/pricing')).toBe('acme.io')
    expect(domainOf('acme.io')).toBe('acme.io')
  })
  it('rejects empty or placeholder values', () => {
    for (const v of ['', null, undefined, 'N/A', '--', 'localhost']) expect(domainOf(v)).toBe('')
  })
})

describe('CompanyLogo', () => {
  it('falls back to a monogram when there is no website', () => {
    const { container } = render(<CompanyLogo name="Acme Robotics" website="" />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('AR')).toBeInTheDocument()
  })
  it('tries the next source and finally the monogram when images fail', () => {
    const { container } = render(<CompanyLogo name="Zeta" website="https://zeta-fail.example.com" />)
    fireEvent.error(container.querySelector('img'))
    fireEvent.error(container.querySelector('img'))
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('ZE')).toBeInTheDocument()
  })
})
