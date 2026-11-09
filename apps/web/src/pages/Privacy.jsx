import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import BrandLogo from '../components/BrandLogo'

const REGIONS = [
  ['EU / EEA', 'GDPR. You need a lawful basis (usually legitimate interest), must identify the source of the data, and must honour objection and erasure requests.'],
  ['United Kingdom', 'UK GDPR and PECR. Business email to corporate subscribers is lighter-touch, but opt-outs and erasure requests must be honoured.'],
  ['Canada', 'CASL. Commercial email needs express or implied consent and a working unsubscribe. PIPEDA governs the personal data itself.'],
  ['India', 'Digital Personal Data Protection Act 2023. Use personal data for a lawful purpose and honour withdrawal and erasure requests.'],
]

/** Public privacy notice. Reachable without signing in, because people named in leads may never have an account. */
export default function Privacy() {
  return (
    <div className="min-h-screen bg-app font-sans text-ink">
      <header className="border-b border-line bg-surface/80 px-4 py-3 backdrop-blur-xl sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2" aria-label="Quarry home"><BrandLogo /></Link>
      </header>
      <main id="main-content" className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary-500 to-accent-600 text-white shadow-lg"><ShieldCheck aria-hidden="true" className="h-6 w-6" /></span>
          <h1 className="text-3xl font-black tracking-tight">Privacy notice</h1>
        </div>

        <div className="space-y-8 text-sm leading-relaxed">
          <section aria-labelledby="p-what">
            <h2 id="p-what" className="mb-2 text-lg font-bold">What Quarry collects</h2>
            <p>Quarry helps its users find companies that match their ideal customer and the people who make buying decisions there. It collects business information from public web pages and search results: company names and websites, work email addresses, phone numbers, and the names, job titles and public professional profile links of employees. Each stored value records the page it came from and when it was retrieved.</p>
          </section>
          <section aria-labelledby="p-why">
            <h2 id="p-why" className="mb-2 text-lg font-bold">Why, and on what basis</h2>
            <p>The data is used by our customers for business-to-business outreach to people in a relevant professional role. Where the law requires a lawful basis, that basis is legitimate interest, balanced against your rights. We verify email addresses to reduce bounces and label each as Verified, Likely, Risky or Invalid.</p>
          </section>
          <section aria-labelledby="p-keep">
            <h2 id="p-keep" className="mb-2 text-lg font-bold">How long we keep it</h2>
            <p>Leads that a customer rejects are deleted 30 days later. Search results that are never turned into a lead or added to a list are deleted after 30 days. Customers can delete requests and accounts at any time, which also deletes the people recorded in them.</p>
          </section>
          <section aria-labelledby="p-rights">
            <h2 id="p-rights" className="mb-2 text-lg font-bold">Your choices</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Every message sent with Quarry carries a link to opt out. Following it adds your address to that customer&rsquo;s suppression list, so you are not contacted or exported again.</li>
              <li>You can ask the customer who contacted you to erase your data. Customers have a tool that removes a person&rsquo;s records across Quarry by email address and keeps an audit record that holds no copy of the address.</li>
              <li>You can object to processing or ask what is held about you by contacting the customer or the operator of this Quarry service.</li>
            </ul>
          </section>
          <section aria-labelledby="p-regions">
            <h2 id="p-regions" className="mb-2 text-lg font-bold">Regional rules</h2>
            <p className="mb-3 text-muted">Quarry flags leads that appear to be in these regions, inferred from the website domain and stated location. This is a prompt to check the rules, not legal advice.</p>
            <dl className="divide-y divide-line rounded-xl border border-line bg-surface">
              {REGIONS.map(([name, text]) => (
                <div key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr]">
                  <dt className="font-semibold">{name}</dt>
                  <dd className="text-muted">{text}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-labelledby="p-sec">
            <h2 id="p-sec" className="mb-2 text-lg font-bold">Security</h2>
            <p>Third-party API keys are stored encrypted. Exported files include a source notice and exclude suppressed addresses.</p>
          </section>
        </div>
      </main>
    </div>
  )
}
