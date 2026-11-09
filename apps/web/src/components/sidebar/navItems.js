import { CreditCard, FolderKanban, LayoutDashboard, ListChecks, Plug, PlugZap, Radar, Send, ShieldCheck, UserCircle, Users } from 'lucide-react'

/**
 * Sidebar sections. `also` adds extra path prefixes that count as "inside" the item (a request's detail pages
 * belong to Requests); `exact` stops an item from matching its children (CRM integrations is not Integrations).
 */
export const NAV_SECTIONS = [
  {
    id: 'workspace',
    label: 'Workspace',
    items: [
      { to: '/lead-requests', label: 'Requests', icon: FolderKanban, also: ['/request/'] },
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/lead-lists', label: 'Lead lists', icon: ListChecks },
    ],
  },
  {
    id: 'outreach',
    label: 'Outreach',
    items: [
      { to: '/outreach', label: 'Outreach', icon: Send },
      { to: '/watch', label: 'Watch', icon: Radar },
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    items: [
      { to: '/integrations', label: 'Integrations', icon: Plug, exact: true },
      { to: '/integrations/crm', label: 'CRM integrations', icon: PlugZap },
      { to: '/team', label: 'Team', icon: Users },
      { to: '/billing', label: 'Billing', icon: CreditCard },
      { to: '/compliance', label: 'Compliance', icon: ShieldCheck },
      { to: '/profile', label: 'Account', icon: UserCircle },
    ],
  },
]

export function isActivePath(pathname, { to, also = [], exact = false }) {
  if (pathname === to) return true
  if (exact) return false
  return pathname.startsWith(`${to}/`) || also.some((prefix) => pathname.startsWith(prefix))
}
