import { describe, it, expect } from 'vitest'
import { contrastRatio } from './contrast'
import { PALETTES, paletteVars } from '../config/palettes'

const AA = 4.5
const DARK_SURFACE = '#142036'

describe('contrastRatio', () => {
  it('is 21 for black on white and 1 for identical colours', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1)
    expect(contrastRatio('#336699', '#336699')).toBeCloseTo(1, 5)
  })

  it('reads the grey that is just under AA (#777 on white is 4.48)', () => {
    const ratio = contrastRatio('#777777', '#ffffff')
    expect(ratio).toBeGreaterThan(4.4)
    expect(ratio).toBeLessThan(AA)
  })

  it('accepts the "r g b" triplets the palette variables use', () => {
    expect(contrastRatio('255 255 255', '0 0 0')).toBeCloseTo(21, 1)
  })
})

describe('every shipped palette is readable (WCAG AA, 4.5:1)', () => {
  it.each(PALETTES.map((p) => [p.id]))('%s: white text on its 600 button and its 400 text on a dark surface', (id) => {
    const vars = paletteVars(id)
    expect(contrastRatio('#ffffff', vars['--p-600'])).toBeGreaterThanOrEqual(AA)
    expect(contrastRatio(vars['--p-400'], DARK_SURFACE)).toBeGreaterThanOrEqual(AA)
  })

  it('ships a small, checkable set', () => {
    expect(PALETTES.length).toBeLessThanOrEqual(5)
  })
})
