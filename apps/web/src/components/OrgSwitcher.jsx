import { Link } from 'react-router-dom'
import clsx from 'clsx'
import { Building2, Check, ChevronDown, Settings2, User } from 'lucide-react'
import { Menu } from './kit'
import { useOrg } from '../context/OrgContext'

/** Header control to switch between the personal workspace and the organizations the user belongs to. */
export default function OrgSwitcher({ block = false, compact = false }) {
  const { orgs, activeOrg, switchOrg } = useOrg()
  const currentName = activeOrg ? activeOrg.name : 'Personal'

  return (
    <Menu
      className={block ? 'w-full' : undefined}
      label={`Switch workspace, current: ${currentName}`}
      align="left"
      buttonClassName={clsx("flex items-center gap-1.5 rounded-xl border border-line bg-surface/80 text-xs font-semibold text-ink shadow-sm transition-all hover:bg-surface hover:shadow-md", block ? "w-full px-3 py-2.5" : "max-w-[9rem] px-3 py-2 sm:max-w-[13rem]", compact && "mx-auto h-10 w-10 justify-center !px-0")}
      panelClassName="w-72 py-1"
      button={
        <>
          {activeOrg ? <Building2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-400" /> : <User aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted" />}
          <span className={clsx('truncate', compact && 'sr-only')}>{currentName}</span>
          {!compact && <ChevronDown aria-hidden="true" className={clsx('h-3 w-3 shrink-0 text-muted', block && 'ml-auto')} />}
        </>
      }
    >
      {({ close }) => (
        <div>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Workspace</p>
          <button
            type="button"
            aria-current={!activeOrg ? 'true' : undefined}
            onClick={() => {
              close()
              if (activeOrg) switchOrg('')
            }}
            className={clsx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-head', !activeOrg ? 'font-semibold text-primary-800 dark:text-primary-300' : 'text-ink')}
          >
            <span className="flex items-center gap-2 truncate">
              <User aria-hidden="true" className="h-4 w-4 text-muted" /> Personal workspace
            </span>
            {!activeOrg && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
          </button>
          {orgs.map((o) => {
            const current = activeOrg?.id === o.id
            return (
              <button
                key={o.id}
                type="button"
                aria-current={current ? 'true' : undefined}
                onClick={() => {
                  close()
                  if (!current) switchOrg(o.id)
                }}
                className={clsx('flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-head', current ? 'font-semibold text-primary-800 dark:text-primary-300' : 'text-ink')}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Building2 aria-hidden="true" className="h-4 w-4 shrink-0 text-muted" />
                  <span className="truncate">{o.name}</span>
                  <span className="shrink-0 rounded-full bg-head px-1.5 py-0.5 text-[10px] font-semibold capitalize text-muted">{o.role}</span>
                </span>
                {current && <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
              </button>
            )
          })}
          <div className="mt-1 border-t border-line pt-1">
            <Link to="/team" onClick={close} className="flex items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-head">
              <Settings2 aria-hidden="true" className="h-4 w-4 text-muted" /> Team settings
            </Link>
          </div>
        </div>
      )}
    </Menu>
  )
}
