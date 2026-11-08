import { Outlet } from 'react-router-dom'
import Header from './Header'

export default function Layout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-app font-sans text-ink">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-lg">
        Skip to content
      </a>
      <Header />
      <main id="main-content" className="relative flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  )
}
