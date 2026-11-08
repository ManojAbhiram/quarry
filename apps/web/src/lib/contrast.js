// WCAG 2.x contrast ratio. Colours are "#rrggbb" or the "r g b" triplets the palette CSS variables use.

function toRgb(color) {
  const value = String(color).trim()
  if (value.startsWith('#')) {
    const n = parseInt(value.slice(1), 16)
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  }
  return value.split(/[\s,]+/).map(Number)
}

function luminance(color) {
  const [r, g, b] = toRgb(color).map((channel) => {
    const c = channel / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Contrast ratio between two colours, 1 (identical) to 21 (black on white). */
export function contrastRatio(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
