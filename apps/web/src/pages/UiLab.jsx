// Dev-only showcase of the Aceternity UI components installed in src/components/ui.
// Route: /ui-lab (registered only when import.meta.env.DEV). Not shipped in production builds.
import { Building2, Search, Target, Users } from 'lucide-react'
import { AuroraBackground } from '@/components/ui/aurora-background'
import { Spotlight } from '@/components/ui/spotlight'
import { BackgroundBeams } from '@/components/ui/background-beams'
import { BentoGrid, BentoGridItem } from '@/components/ui/bento-grid'
import { HoverEffect } from '@/components/ui/card-hover-effect'
import { TextGenerateEffect } from '@/components/ui/text-generate-effect'
import { FlipWords } from '@/components/ui/flip-words'
import { Button as MovingBorderButton } from '@/components/ui/moving-border'
import { AnimatedTooltip } from '@/components/ui/animated-tooltip'
import { Tabs } from '@/components/ui/tabs'
import { GlowingEffect } from '@/components/ui/glowing-effect'
import { Modal, ModalBody, ModalContent, ModalFooter, ModalTrigger } from '@/components/ui/animated-modal'

const people = [
  { id: 1, name: 'Ada Lovelace', designation: 'VP Engineering', image: 'https://i.pravatar.cc/100?img=47' },
  { id: 2, name: 'Alan Turing', designation: 'CTO', image: 'https://i.pravatar.cc/100?img=12' },
  { id: 3, name: 'Grace Hopper', designation: 'Head of Data', image: 'https://i.pravatar.cc/100?img=32' },
]

const features = [
  { title: 'Discover', description: 'Turn an ICP into targeted searches.', link: '#discover' },
  { title: 'Enrich', description: 'Scrape sites, extract contacts and signals.', link: '#enrich' },
  { title: 'Qualify', description: 'Score every company against your profile.', link: '#qualify' },
]

const tabContent = (label) => (
  <div className="w-full h-full rounded-2xl p-8 text-xl font-bold text-white bg-gradient-to-br from-primary-600 to-primary-900">
    {label}
  </div>
)

function Section({ title, children, className = '' }) {
  return (
    <section className={`space-y-4 ${className}`}>
      <h2 className="text-sm font-bold uppercase tracking-wider text-slate-500">{title}</h2>
      {children}
    </section>
  )
}

export default function UiLab() {
  return (
    <div className="min-h-screen">
      <AuroraBackground className="h-[60vh] rounded-b-[2rem]">
        <div className="relative z-10 text-center px-4">
          <h1 className="text-4xl md:text-6xl font-black text-slate-900 dark:text-white">Quarry UI Lab</h1>
          <div className="mt-4 text-xl text-slate-600 dark:text-slate-300">
            Find <FlipWords words={['prospects', 'decision makers', 'growth signals']} /> faster
          </div>
        </div>
      </AuroraBackground>

      <div className="max-w-6xl mx-auto px-4 py-12 space-y-16">
        <Section title="Text generate effect">
          <TextGenerateEffect words="Quarry discovers, enriches and qualifies B2B leads from a single ICP." />
        </Section>

        <Section title="Spotlight + background beams">
          <div className="relative h-72 rounded-3xl overflow-hidden bg-slate-950 flex items-center justify-center">
            <Spotlight className="-top-40 left-0 md:left-60 md:-top-20" fill="white" />
            <BackgroundBeams />
            <p className="relative z-10 text-3xl font-black text-white">Hero backdrop</p>
          </div>
        </Section>

        <Section title="Bento grid">
          <BentoGrid>
            <BentoGridItem title="Companies" description="Sourced and scored" icon={<Building2 className="w-4 h-4" />} header={<div className="h-full min-h-[6rem] rounded-xl bg-gradient-to-br from-primary-200 to-primary-400" />} />
            <BentoGridItem title="Decision makers" description="Verified contacts" icon={<Users className="w-4 h-4" />} header={<div className="h-full min-h-[6rem] rounded-xl bg-gradient-to-br from-emerald-200 to-emerald-400" />} />
            <BentoGridItem title="Intent signals" description="Hiring, funding, tech" icon={<Target className="w-4 h-4" />} header={<div className="h-full min-h-[6rem] rounded-xl bg-gradient-to-br from-amber-200 to-amber-400" />} />
          </BentoGrid>
        </Section>

        <Section title="Hover cards">
          <HoverEffect items={features} />
        </Section>

        <Section title="Tabs">
          <div className="h-72 [perspective:1000px] relative flex flex-col max-w-3xl w-full items-start justify-start">
            <Tabs
              tabs={[
                { title: 'Discover', value: 'discover', content: tabContent('Discover') },
                { title: 'Enrich', value: 'enrich', content: tabContent('Enrich') },
                { title: 'Qualify', value: 'qualify', content: tabContent('Qualify') },
              ]}
            />
          </div>
        </Section>

        <Section title="Moving-border button, tooltip, glowing card">
          <div className="flex flex-wrap items-center gap-8">
            <MovingBorderButton borderRadius="1rem" className="bg-white dark:bg-slate-900 text-black dark:text-white border-neutral-200 dark:border-slate-800">
              <Search className="w-4 h-4 mr-2" /> New lead request
            </MovingBorderButton>
            <div className="flex"><AnimatedTooltip items={people} /></div>
            <div className="relative h-32 w-64 rounded-2xl border border-slate-200 dark:border-slate-800 p-4">
              <GlowingEffect spread={40} glow disabled={false} proximity={64} inactiveZone={0.01} borderWidth={2} />
              <p className="relative text-sm font-semibold">Glowing card</p>
            </div>
          </div>
        </Section>

        <Section title="Animated modal">
          <Modal>
            <ModalTrigger className="bg-primary-600 text-white">Open modal</ModalTrigger>
            <ModalBody>
              <ModalContent>
                <h4 className="text-lg font-bold">Export leads</h4>
                <p className="text-sm mt-2">Choose a format for the export.</p>
              </ModalContent>
              <ModalFooter className="gap-4">
                <button className="px-3 py-1 text-sm rounded-md border">Cancel</button>
              </ModalFooter>
            </ModalBody>
          </Modal>
        </Section>
      </div>
    </div>
  )
}
