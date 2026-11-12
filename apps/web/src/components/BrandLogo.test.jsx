import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BrandLogo from './BrandLogo'

describe('BrandLogo', () => {
  it('renders a named, transparent vector that follows the palette in both modes', () => {
    render(<BrandLogo />)
    const logo = screen.getByRole('img', { name: 'Quarry logo' })

    expect(logo.tagName.toLowerCase()).toBe('svg')
    expect(logo).toHaveAttribute('viewBox', '0 0 64 64')
    expect(logo).toHaveAttribute('fill', 'currentColor')
    expect(logo).toHaveAttribute('focusable', 'false')
    expect(logo).toHaveClass('w-8', 'h-8', 'shrink-0', 'text-primary-700', 'dark:text-primary-300')
    expect(logo.querySelector('image, rect, linearGradient, radialGradient')).toBeNull()
    expect(logo.querySelectorAll('path')).toHaveLength(2)
  })

  it('hides decorative marks from assistive technology', () => {
    const { container } = render(<BrandLogo title="" />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('title')).toBeNull()
  })

  it('keeps labels unique and supports custom sizes and monochrome treatments', () => {
    render(
      <>
        <BrandLogo title="Custom Quarry mark" className="h-12 w-12 text-ink dark:text-white" />
        <BrandLogo />
      </>,
    )
    const custom = screen.getByRole('img', { name: 'Custom Quarry mark' })
    const standard = screen.getByRole('img', { name: 'Quarry logo' })

    expect(custom).toHaveClass('h-12', 'w-12', 'text-ink', 'dark:text-white')
    expect(custom).not.toHaveClass('text-primary-700', 'dark:text-primary-300')
    expect(custom.getAttribute('aria-labelledby')).not.toBe(standard.getAttribute('aria-labelledby'))
  })

  it('uses the same geometry as the light/dark browser favicon', () => {
    render(<BrandLogo />)
    const logo = screen.getByRole('img', { name: 'Quarry logo' })
    const source = readFileSync('public/favicon.svg', 'utf8')
    const favicon = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement

    expect(favicon.getAttribute('viewBox')).toBe(logo.getAttribute('viewBox'))
    expect(favicon.getAttribute('fill')).toBe('currentColor')
    expect(Array.from(favicon.querySelectorAll('path'), (path) => path.getAttribute('d')))
      .toEqual(Array.from(logo.querySelectorAll('path'), (path) => path.getAttribute('d')))
    expect(favicon.querySelector('style').textContent).toContain('prefers-color-scheme: dark')
    expect(favicon.querySelector('rect')).toBeNull()
  })
})
