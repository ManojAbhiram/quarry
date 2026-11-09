# Quarry Web

React 18 + Vite + Tailwind single-page app for Quarry. It is a premium, motion-rich UI (glass surfaces, animated score
bars, flip transitions, spring drawers) that keeps accessibility and loading, empty and error states on every screen.

## Stack

React 18, React Router 6, Tailwind CSS, `motion` and GSAP for animation, lucide icons, Vitest + Testing Library.

## Getting started

Requirements: Node 20+ (CI uses 22) and a running Quarry API.

```bash
cd apps/web
npm install
npm run dev          # http://localhost:3000, proxies /api to http://127.0.0.1:8000
```

Environment (all optional): `VITE_API_URL` (API base, default `/api`), `VITE_BACKEND_URL` (dev proxy target),
`VITE_DEV_PORT` (default 3000). In development a component showcase is served at `/ui-lab`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with HMR |
| `npm run lint` | ESLint (must have no errors) |
| `npx vitest run` | Unit and component tests |
| `npm run build` | Production build to `dist/` |

## Authentication

The API sets HttpOnly cookies on login, so the app never sees or stores a token. `src/api.js` sends every request with
`credentials: 'include'`, adds `X-CSRF-Token` (read from the `quarry_csrf` cookie, or fetched from `/auth/csrf` when it
is not readable) to writes, and on a 401 refreshes the session once (shared by concurrent requests) and retries.
`src/session.js` keeps a non-secret `session` hint in localStorage so the app knows whether to call `/users/me` on
load; old `token` / `refresh_token` entries are deleted. Google sign-in returns to `/auth/google/callback?login=success`
and the page then loads the user via the cookie.

## Layout

```text
src/
  api.js, session.js     fetch layer (cookies, CSRF, refresh) and the session hint
  App.jsx                routes and boot states
  context/               AuthContext, LeadContext (requests and results), ThemeContext
  config/                constants, palettes
  components/
    kit/                 Button, Field, Menu, Toast, states (Empty/Error/Skeleton), screens
    motion/              Reveal, SplitHeading, Backdrop, flip and stagger hooks
    ui/                  decorative effect components (used by the UI lab)
    intent/, request/    intent score panel, request wizard parts
  pages/
    Dashboard, LeadRequests, NewRequest / CreateLeadRequest (wizard), DirectCompanies,
    RequestDetails (+ request-details/: table, lead drawer, competitors, decision makers, exports),
    LeadLists, Profile, auth pages (Login, Signup, ForgotPassword, ResetPassword, GoogleCallback)
```

## Enrichment failures

If the AI step failed for a company, the results table shows an "Enrichment failed" badge and the lead drawer explains
why its fields are blank and offers "Retry enrichment". The retry queues a background job (`POST
/leads/{id}/retry-enrichment`), polls `GET /jobs/{id}`, and reloads the results when it finishes.
