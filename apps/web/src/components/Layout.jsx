import { Outlet } from 'react-router-dom'
import Header from './Header'

export default function Layout() {
  return (
    <div className="flex flex-col h-screen bg-slate-50 dark:bg-[#0f172a] overflow-hidden font-sans transition-colors duration-300 relative">
      {/* Global Top Navbar Header */}
      <Header />

      {/* Content view scrollable container */}
      <main
        id="main-content"
        className="flex-1 overflow-hidden relative"
      >
        {/* Ambient background: two soft palette glows plus a faint dot grid, all behind the content */}
        <div aria-hidden="true" className="pointer-events-none select-none absolute inset-0 z-0 overflow-hidden">
          <div className="absolute -top-32 -right-24 w-[34rem] h-[34rem] rounded-full bg-primary-400/10 dark:bg-primary-500/10 blur-3xl" />
          <div className="absolute -bottom-40 -left-24 w-[30rem] h-[30rem] rounded-full bg-accent-400/10 dark:bg-accent-500/10 blur-3xl" />
          <div className="absolute inset-0 opacity-40 dark:opacity-30 [background-image:radial-gradient(rgb(var(--p-500)/0.22)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:radial-gradient(ellipse_at_top,black,transparent_72%)]" />
        </div>
        <div className="relative z-10 w-full h-full animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

