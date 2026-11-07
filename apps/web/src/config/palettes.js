// Colour palettes. Tailwind's `primary`, `accent` (and the legacy `indigo`, `violet`, `purple` names used across
// the app) read CSS variables, so applying a palette re-themes every screen without touching class names.
// Keep this file free of browser globals at import time: tailwind.config.js imports it too.

export const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]

const scale = (hexes) => Object.fromEntries(STEPS.map((s, i) => [s, hexes[i]]))

const SCALES = {
  // Quarry's own cyan: shifted one step deeper than Tailwind's cyan so 600 passes AA with white text.
  quarry: scale(['#ecfeff', '#cffafe', '#a5f3fc', '#67e8f9', '#22d3ee', '#0891b2', '#0e7490', '#155e75', '#164e63', '#0c3b4e', '#072a38']),
  teal: scale(['#f0fdfa', '#ccfbf1', '#99f6e4', '#5eead4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a', '#042f2e']),
  sky: scale(['#f0f9ff', '#e0f2fe', '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e', '#082f49']),
  indigo: scale(['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81', '#1e1b4b']),
  violet: scale(['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95', '#2e1065']),
  emerald: scale(['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b', '#022c22']),
  orange: scale(['#fff7ed', '#ffedd5', '#fed7aa', '#fdba74', '#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12', '#431407']),
  amber: scale(['#fffbeb', '#fef3c7', '#fde68a', '#fcd34d', '#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f', '#451a03']),
  rose: scale(['#fff1f2', '#ffe4e6', '#fecdd3', '#fda4af', '#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337', '#4c0519']),
  slate: scale(['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a', '#020617']),
}

export const DEFAULT_PALETTE = 'quarry'

export const PALETTES = [
  { id: 'quarry', name: 'Quarry', note: 'Logo cyan on navy', primary: 'quarry', accent: 'teal' },
  { id: 'midnight', name: 'Midnight', note: 'Classic indigo', primary: 'indigo', accent: 'violet' },
  { id: 'amethyst', name: 'Amethyst', note: 'Royal violet', primary: 'violet', accent: 'indigo' },
  { id: 'emerald', name: 'Emerald', note: 'Fresh growth', primary: 'emerald', accent: 'teal' },
  { id: 'sunset', name: 'Sunset', note: 'Warm amber', primary: 'orange', accent: 'amber' },
  { id: 'rose', name: 'Rosewood', note: 'Bold rose', primary: 'rose', accent: 'orange' },
  { id: 'graphite', name: 'Graphite', note: 'Quiet slate', primary: 'slate', accent: 'sky' },
]

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

export const getPalette = (id) => PALETTES.find((p) => p.id === id) || PALETTES[0]

/** CSS variables ("r g b" triplets, for Tailwind's alpha syntax) for one palette. */
export function paletteVars(id) {
  const p = getPalette(id)
  const vars = {}
  for (const s of STEPS) {
    vars[`--p-${s}`] = hexToRgb(SCALES[p.primary][s])
    vars[`--a-${s}`] = hexToRgb(SCALES[p.accent][s])
  }
  return vars
}

/** Hex swatches for the picker: [primary 600, accent 500, primary 300]. */
export function swatches(id) {
  const p = getPalette(id)
  return [SCALES[p.primary][600], SCALES[p.accent][500], SCALES[p.primary][300]]
}

const KEY = 'palette'

export function getSavedPalette() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved && PALETTES.some((p) => p.id === saved)) return saved
  } catch (_) { /* storage can be unavailable */ }
  return DEFAULT_PALETTE
}

export function applyPalette(id) {
  const root = document.documentElement
  for (const [name, value] of Object.entries(paletteVars(id))) root.style.setProperty(name, value)
  root.dataset.palette = id
  try {
    localStorage.setItem(KEY, id)
  } catch (_) { /* ignore */ }
}
