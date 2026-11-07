import { STEPS, DEFAULT_PALETTE, paletteVars } from './src/config/palettes.js'

// rgb(var(--p-600) / <alpha-value>) keeps opacity modifiers (bg-primary-600/20) working.
const fromVar = (prefix) => Object.fromEntries(STEPS.map((s) => [s, `rgb(var(--${prefix}-${s}) / <alpha-value>)`]))

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
        indigo: fromVar('p'),
        accent: fromVar('a'),
        violet: fromVar('a'),
        purple: fromVar('a'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'glow': '0 0 15px rgb(var(--p-500) / 0.5)',
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
