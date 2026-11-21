import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeft, ArrowRight, ArrowUpRight, Binoculars, Check, ClipboardList, FolderOpen, LayoutDashboard, Plug, UsersRound, X } from 'lucide-react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import { Button } from '../kit'
import BrandLogo from '../BrandLogo'
import { BentoGrid } from '../ui/bento-grid'

gsap.registerPlugin(useGSAP)

export const steps = [
  {
    label: 'Workspace', title: 'Your workspace', icon: LayoutDashboard,
    description: 'Start with Requests to see your discovery runs. Open Dashboard for a view of activity across your workspace.',
    places: [['Requests', 'Track the status and results of each run'], ['Dashboard', 'Review workspace activity']],
  },
  {
    label: 'Discovery', title: 'Find companies and people', icon: ClipboardList,
    description: 'Start with an ideal customer profile or a list of companies. Follow the run as Quarry finds companies and decision makers.',
    places: [['New request', 'Define who you want to find'], ['Request details', 'Review companies, contacts and enrichment']],
  },
  {
    label: 'Lead lists', title: 'Organize your leads', icon: FolderOpen,
    description: 'Save the contacts you want to keep in a lead list. Export the list when it’s ready to share or use in another tool.',
    places: [['Lead lists', 'Collect and review contacts'], ['Export', 'Take your results into another workflow']],
  },
  {
    label: 'Outreach and Watch', title: 'Follow up and monitor', icon: Binoculars,
    description: 'Use Outreach for follow-up. Add targets to Watch so you can track signals that make a conversation timely.',
    places: [['Outreach', 'Manage follow-up work'], ['Watch', 'Monitor saved targets and signals']],
  },
  {
    label: 'Connections', title: 'Connect your tools', icon: Plug,
    description: 'Add a Serper key for search and choose an AI provider and model for research. You can set up both from Account settings.',
    places: [['API connections', 'Set up Serper search and AI models'], ['Integrations', 'Connect your CRM and other tools']],
  },
  {
    label: 'Management', title: 'Manage your workspace', icon: UsersRound,
    description: 'Invite teammates, review your plan and usage, and find the privacy controls for your workspace.',
    places: [['Team', 'Manage workspace members'], ['Billing and Compliance', 'Review usage and privacy controls']],
  },
]

export default function WelcomeTourDialog({ dialog, step, busy, failure, onMove, onDismiss, onFinish, onRetry }) {
  const content = useRef(null)
  const scrollArea = useRef(null)
  const { title, description, icon: Icon, places } = steps[step]
  const isLast = step === steps.length - 1

  useGSAP(() => {
    scrollArea.current.scrollTop = 0
    const media = gsap.matchMedia()
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('[data-tour-reveal]', {
        y: 8, opacity: 0, duration: 0.26, stagger: 0.035,
        ease: 'power3.out', clearProps: 'transform,opacity',
      })
    })
    return () => media.revert()
  }, { scope: content, dependencies: [step], revertOnUpdate: true })

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/65 p-3 sm:p-6">
      <div
        ref={dialog}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="quarry-tour-title"
        aria-describedby="quarry-tour-copy"
        className="grid max-h-full w-full max-w-[54rem] grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-line bg-surface text-ink shadow-2xl outline-none md:grid-cols-[14.5rem_minmax(0,1fr)]"
      >
        <aside className="hidden flex-col border-r border-white/10 bg-[#111d2b] p-6 text-white md:flex">
          <div className="flex items-center gap-2.5 text-lg font-semibold">
            <BrandLogo title={null} className="h-6 w-6 text-teal-300 dark:text-teal-300" />
            Quarry
          </div>
          <ol aria-label="Introduction steps" className="mt-8 space-y-1">
            {steps.map(({ label, icon: StepIcon }, index) => (
              <li key={label} aria-current={index === step ? 'step' : undefined} className={
                `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${index === step ? 'bg-white/10 font-semibold text-white' : 'text-slate-300'}`
              }>
                {index < step
                  ? <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-teal-300" />
                  : <StepIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${index === step ? 'text-teal-300' : 'text-slate-400'}`} />}
                {label}
              </li>
            ))}
          </ol>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 items-center gap-4 border-b border-line px-4 py-3 sm:px-7">
            <BrandLogo title={null} className="h-5 w-5 md:hidden" />
            <p className="flex-1 text-sm font-medium tabular-nums text-muted" aria-live="polite">Step {step + 1} of {steps.length}</p>
            <div aria-hidden="true" className="flex gap-1.5">
              {steps.map(({ label }, index) => <span key={label} className={`h-1 w-3 rounded-full sm:w-4 ${index <= step ? 'bg-btn' : 'bg-line'}`} />)}
            </div>
            <Button variant="ghost" size="sm" className="!w-9 !rounded-lg !px-0" aria-label="Close introduction" disabled={busy} onClick={onDismiss}>
              <X aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>
          <div ref={scrollArea} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div ref={content} className="space-y-5 px-4 py-6 sm:px-7 sm:py-7">
              <div data-tour-reveal>
                <span className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-line bg-head text-btn dark:text-primary-300">
                  <Icon aria-hidden="true" className="h-5 w-5" />
                </span>
                <h2 id="quarry-tour-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h2>
                <p id="quarry-tour-copy" className="mt-2 max-w-lg text-sm leading-relaxed text-muted">{description}</p>
              </div>
              <BentoGrid className="grid-cols-1 gap-2 sm:grid-cols-2 md:auto-rows-auto md:grid-cols-2">
                {places.map(([name, detail]) => (
                  <div key={name} data-tour-reveal className="rounded-lg border border-line bg-app p-3.5">
                    <p className="text-sm font-semibold">{name}</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
                  </div>
                ))}
              </BentoGrid>
              {step === 4 && <Button variant="secondary" className="!rounded-lg !shadow-none" disabled={busy} onClick={() => onFinish('/profile#api-connections')}>
                Open API connections <ArrowUpRight aria-hidden="true" className="h-4 w-4" />
              </Button>}
              {failure && <div className="flex flex-wrap items-center gap-2 rounded-lg border border-bad/20 bg-bad-soft p-3 text-sm text-bad">
                <p role="alert">Your tour progress was not saved.</p>
                <Button variant="secondary" size="sm" disabled={busy} onClick={onRetry}>Retry saving progress</Button>
              </div>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-line bg-app px-4 py-3 sm:px-7">
            <Button variant="ghost" className="!rounded-lg !px-2.5" disabled={busy} onClick={onDismiss}>Skip tour</Button>
            <div className="flex flex-wrap gap-2">
              {step > 0 && <Button variant="ghost" className="!rounded-lg !px-2.5" disabled={busy} onClick={() => onMove(step - 1)}>
                <ArrowLeft aria-hidden="true" className="h-4 w-4" /> Back
              </Button>}
              {isLast && <Button variant="secondary" className="!rounded-lg !shadow-none" disabled={busy} onClick={() => onFinish()}>Explore Quarry</Button>}
              <Button variant="solid" disabled={busy} onClick={() => isLast ? onFinish('/new-request') : onMove(step + 1)}>
                {isLast ? 'Create a request' : 'Next'} <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>, document.body,
  )
}
