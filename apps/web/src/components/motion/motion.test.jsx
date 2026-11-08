import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, renderHook, act } from '@testing-library/react'
import { useRef, useState } from 'react'

const gsapMocks = vi.hoisted(() => ({
  getState: vi.fn(() => ({ fake: 'state' })),
  from: vi.fn(),
  splitCreate: vi.fn(() => ({ chars: ['c'], words: ['w'], revert: vi.fn() })),
}))

vi.mock('gsap/Flip', () => ({ Flip: { getState: gsapMocks.getState, from: gsapMocks.from } }))
vi.mock('gsap/SplitText', () => ({ SplitText: { create: gsapMocks.splitCreate } }))

import { useFlip } from './useFlip'
import SplitHeading from './SplitHeading'
import Reveal from './Reveal'

function setMotionPreference(reduce) {
  window.matchMedia = vi.fn((query) => ({
    matches: query.includes('prefers-reduced-motion: reduce') ? reduce : query.includes('no-preference') ? !reduce : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
}

describe('useFlip', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setMotionPreference(false)
  })

  function setup() {
    return renderHook(() => {
      const ref = useRef(document.createElement('div'))
      const [order, setOrder] = useState(0)
      const capture = useFlip(ref, [order])
      return { capture, setOrder }
    })
  }

  it('animates from the captured layout when the list changes after capture()', () => {
    const { result } = setup()
    act(() => {
      result.current.capture()
      result.current.setOrder(1)
    })
    expect(gsapMocks.getState).toHaveBeenCalledTimes(1)
    expect(gsapMocks.from).toHaveBeenCalledTimes(1)
    expect(gsapMocks.from.mock.calls[0][0]).toEqual({ fake: 'state' })
  })

  it('does nothing when the list changes without a capture (for example on first render or a data refresh)', () => {
    const { result } = setup()
    act(() => result.current.setOrder(1))
    expect(gsapMocks.from).not.toHaveBeenCalled()
  })

  it('animates once per capture, not on every later change', () => {
    const { result } = setup()
    act(() => {
      result.current.capture()
      result.current.setOrder(1)
    })
    act(() => result.current.setOrder(2))
    expect(gsapMocks.from).toHaveBeenCalledTimes(1)
  })

  it('never animates for users who prefer reduced motion', () => {
    setMotionPreference(true)
    const { result } = setup()
    act(() => {
      result.current.capture()
      result.current.setOrder(1)
    })
    expect(gsapMocks.getState).not.toHaveBeenCalled()
    expect(gsapMocks.from).not.toHaveBeenCalled()
  })
})

describe('SplitHeading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('always renders the full heading text so it is readable and accessible', () => {
    setMotionPreference(false)
    render(<SplitHeading as="h1">Find the companies worth contacting</SplitHeading>)
    expect(screen.getByRole('heading', { level: 1, name: 'Find the companies worth contacting' })).toBeInTheDocument()
  })

  it('leaves the text untouched for users who prefer reduced motion', async () => {
    setMotionPreference(true)
    render(<SplitHeading as="h2">Welcome back</SplitHeading>)
    expect(screen.getByRole('heading', { name: 'Welcome back' })).toBeInTheDocument()
    await Promise.resolve()
    expect(gsapMocks.splitCreate).not.toHaveBeenCalled()
  })

  it('splits the text into characters once fonts are ready when motion is allowed', async () => {
    setMotionPreference(false)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } })
    render(<SplitHeading as="h2">Welcome back</SplitHeading>)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(gsapMocks.splitCreate).toHaveBeenCalledTimes(1)
    expect(gsapMocks.splitCreate.mock.calls[0][1]).toMatchObject({ type: 'chars,words', aria: 'auto' })
  })
})

describe('Reveal', () => {
  afterEach(() => setMotionPreference(false))

  it('renders its children visibly (animation can only add motion, never hide content)', () => {
    setMotionPreference(true)
    render(
      <Reveal className="grid">
        <div data-reveal>First</div>
        <div data-reveal>Second</div>
      </Reveal>,
    )
    expect(screen.getByText('First')).toBeVisible()
    expect(screen.getByText('Second')).toBeVisible()
  })

  it('passes its className to the wrapper', () => {
    const { container } = render(<Reveal className="grid gap-4">x</Reveal>)
    expect(container.firstChild).toHaveClass('grid', 'gap-4')
  })
})

describe('Backdrop', () => {
  it('is decorative: hidden from assistive tech, non-interactive, and dropped for reduced motion', async () => {
    const { default: Backdrop } = await import('./Backdrop')
    render(<Backdrop />)
    const el = screen.getByTestId('backdrop')
    expect(el).toHaveAttribute('aria-hidden', 'true')
    expect(el).toHaveClass('pointer-events-none', 'motion-reduce:hidden')
  })
})
