import { STEPS, DEFAULT_PALETTE, paletteVars } from './src/config/palettes.js'

// rgb(var(--p-600) / <alpha-value>) keeps opacity modifiers (bg-primary-600/20) working.
const fromVar = (prefix) => Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--${prefix}-${s}) / <alpha-value>)`]))

const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Palette-driven (see src/config/palettes.js). The legacy indigo/violet/purple names used across the
        // pages follow the palette too, so every screen re-themes without editing class names.
        primary: fromVar('p'),
        // Button shade (white text, WCAG AA per palette) and its hover shade. See src/config/palettes.js.
        btn: 'rgb(var(--p-btn) / <alpha-value>)',
        'btn-hover': 'rgb(var(--p-btn-hover) / <alpha-value>)',
        indigo: fromVar('p'),
        accent: fromVar('a'),
        violet: fromVar('a'),
        purple: fromVar('a'),
        // Semantic tokens (light and dark values live in src/index.css). New screens use these, not raw slate-*.
        app: token('app'),
        surface: token('surface'),
        head: token('head'),
        line: token('line'),
        ink: token('ink'),
        muted: token('muted'),
        ok: token('ok'),
        'ok-soft': token('ok-soft'),
        warn: token('warn'),
        'warn-soft': token('warn-soft'),
        bad: token('bad'),
        'bad-soft': token('bad-soft'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'glow': '0 0 15px rgb(var(--p-500) / 0.5)',
        'lift': '0 14px 40px -12px rgb(var(--p-600) / 0.35)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out forwards',
        'slide-up': 'slideUp 0.6s ease-out forwards',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        // Aceternity UI: spotlight.jsx and aurora-background.jsx
        spotlight: 'spotlight 2s ease .75s 1 forwards',
        aurora: 'aurora 60s linear infinite',
      },
      keyframes: {
        spotlight: {
          '0%': { opacity: '0', transform: 'translate(-72%, -62%) scale(0.5)' },
          '100%': { opacity: '1', transform: 'translate(-50%, -40%) scale(1)' },
        },
        aurora: {
          from: { backgroundPosition: '50% 50%, 50% 50%' },
          to: { backgroundPosition: '350% 50%, 350% 50%' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(20px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [
    function ({ addBase }) {
      addBase({ ':root': paletteVars(DEFAULT_PALETTE) })
    },
  ],
}
