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
        {/* Ambient glow — reduced opacity so it doesn't wash out content in light mode */}
        <div
          aria-hidden="true"
          className="absolute top-0 right-0 w-96 h-96 bg-primary-200/10 dark:bg-primary-900/10 rounded-full blur-3xl pointer-events-none select-none z-0"
        />
        <div className="relative z-10 w-full h-full animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

