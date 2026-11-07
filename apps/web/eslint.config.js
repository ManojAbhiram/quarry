// ESLint flat config (ESLint 9). Uses ESM because package.json sets "type": "module".
//
// Scope is deliberately narrow: this repo had no lint gate, so the goal is to catch
// real bugs (undefined variables, broken hook usage, unreachable code) rather than
// enforce formatting. Formatting-only rules are left off to avoid a large noisy diff.

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'public/**', '*.config.js'],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2022,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // React 18 + Vite use the automatic JSX runtime, so React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',

      // Prop-types validation is off: this codebase does not use them anywhere, and
      // enabling it would emit hundreds of findings without catching real defects.
      'react/prop-types': 'off',

      // ── Tier 1: errors, and therefore CI-blocking ─────────────────────────
      // Left at error level from js.configs.recommended and react-hooks:
      // no-undef, no-dupe-keys, no-unreachable, no-const-assign,
      // react/jsx-no-undef, react-hooks/rules-of-hooks.
      // All six report zero findings today, so they can block safely and will
      // only ever fire on genuinely broken code.

      // ── Tier 2: warnings, reported but non-blocking ────────────────────────
      // 86 pre-existing findings across 36 files. Failing on these would leave
      // the pipeline red from its first run and train everyone to bypass it.
      // None change runtime behaviour. Fix them incrementally, then promote the
      // rule back to 'error' to lock the improvement in.

      // 62 findings: dead imports and variables, mostly unused lucide-react
      // icons. Vite tree-shakes them out, so this is clutter rather than a bug.
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // 11 findings, all inside regex character classes such as
      // /^[•\-\*\d\.\s]+/ in src/utils/decisionMakers.js. Escaping - * . within
      // [...] is redundant but parses identically, so these are cosmetic.
      'no-useless-escape': 'warn',

      // 9 findings: raw apostrophes in JSX text. Renders correctly as-is.
      'react/no-unescaped-entities': 'warn',

      // 4 findings: empty blocks. Worth review, not worth blocking a deploy.
      'no-empty': 'warn',

      // 8 findings. These can be real stale-closure bugs, but adding the missing
      // deps changes render/effect behaviour, so each needs deliberate review.
      'react-hooks/exhaustive-deps': 'warn',

      // console is used intentionally for client-side diagnostics.
      'no-console': 'off',
      eqeqeq: ['warn', 'smart'],
      'no-implicit-coercion': 'off',
    },
  },
];
