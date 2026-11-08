import { Outlet } from 'react-router-dom'
import Header from './Header'

export default function Layout() {
  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-app font-sans text-ink">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-lg">
        Skip to content
      </a>
      <Header />
      <main id="main-content" className="relative flex-1 overflow-hidden">
        {/* Ambient background: two soft palette glows plus a faint dot grid, all behind the content */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0 select-none overflow-hidden">
          <div className="absolute -right-24 -top-32 h-[34rem] w-[34rem] rounded-full bg-primary-400/15 blur-3xl dark:bg-primary-500/10" />
          <div className="absolute -bottom-40 -left-24 h-[30rem] w-[30rem] rounded-full bg-accent-400/15 blur-3xl dark:bg-accent-500/10" />
          <div className="absolute inset-0 opacity-40 [background-image:radial-gradient(rgb(var(--p-500)/0.22)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)] dark:opacity-30" />
        </div>
        <div className="relative z-10 h-full w-full animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
