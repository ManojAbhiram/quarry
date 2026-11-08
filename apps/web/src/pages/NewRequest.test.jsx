import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ToastProvider } from '../components/kit'

vi.mock('../api', () => ({
  api: {
    getSerperKey: vi.fn(),
    generateStructuredIcp: vi.fn(),
    updateLeadRequest: vi.fn(),
    checkIcpConsistency: vi.fn(),
    createRequest: vi.fn(),
    analyzeSource: vi.fn(),
    suggestChip: vi.fn(),
  },
}))
const leads = { requests: [], refreshRequests: vi.fn(() => Promise.resolve()) }
vi.mock('../context/LeadContext', () => ({ useLeads: () => leads }))

import { api } from '../api'
import NewRequest from './NewRequest'

const ICP = {
  firmographic: { value: 'Industry: B2B SaaS\nSize: 50-200', confidence: 'High Confidence', warning: null },
  technographic: 'Uses a CRM',
  team_structure: 'VP Sales',
  buying_signals: 'Hiring SDRs',
  compliance: 'SOC 2',
  deployment_pref: 'Cloud',
}
const DRAFT = {
  id: 'r1',
  title: 'Acme Lead Request',
  status: 'Draft',
  product_intake: { product_name: 'Acme', product_category: 'SaaS' },
  icp_dimensions: ICP,
}

function Where() {
  return <p data-testid="where">{useLocation().pathname}</p>
}

function setup(requests = [{ id: 'r1', title: 'Acme Lead Request', status: 'Draft' }]) {
  leads.requests = requests
  return render(
    <MemoryRouter initialEntries={['/request/r1/intake']}>
      <ToastProvider>
        <Routes>
          <Route path="/request/:id/intake" element={<NewRequest />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
}

const generateButton = () => screen.getByRole('button', { name: /generate icp/i })

describe('NewRequest step 1', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leads.refreshRequests = vi.fn(() => Promise.resolve())
    api.getSerperKey.mockResolvedValue({ has_key: true, masked: 'abcd' })
    api.updateLeadRequest.mockResolvedValue({})
  })

  it('asks for a product name or description inline and calls nothing when both are empty', async () => {
    setup([])
    await userEvent.click(generateButton())
    expect(screen.getByLabelText(/product name/i)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText(/enter a product name or a description/i)).toBeInTheDocument()
    expect(api.generateStructuredIcp).not.toHaveBeenCalled()
  })

  it('rejects a number of leads outside 1 to 1000 before calling the API', async () => {
    setup([])
    await userEvent.type(screen.getByLabelText(/product name/i), 'Acme')
    const n = screen.getByLabelText(/number of leads/i)
    await userEvent.clear(n)
    await userEvent.type(n, '5000')
    await userEvent.click(generateButton())
    expect(screen.getByText(/between 1 and 1,000/i)).toBeInTheDocument()
    expect(api.generateStructuredIcp).not.toHaveBeenCalled()
  })

  it('generates the ICP, saves the draft and moves to step 2', async () => {
    api.generateStructuredIcp.mockResolvedValue(ICP)
    setup([{ id: 'r1', title: 'Untitled', status: 'Draft' }])
    await userEvent.clear(screen.getByLabelText(/product name/i))
    await userEvent.type(screen.getByLabelText(/product name/i), 'Acme')
    await userEvent.click(generateButton())
    expect(await screen.findByRole('heading', { name: /icp definition/i })).toBeInTheDocument()
    expect(api.generateStructuredIcp).toHaveBeenCalledWith(expect.objectContaining({ product_name: 'Acme' }), 'r1')
    expect(api.updateLeadRequest).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'Draft' }))
  })

  it('shows loading on the button and blocks a second click while generating', async () => {
    let finish
    api.generateStructuredIcp.mockReturnValue(new Promise((r) => (finish = r)))
    setup([])
    await userEvent.type(screen.getByLabelText(/product name/i), 'Acme')
    const button = generateButton()
    await userEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(api.generateStructuredIcp).toHaveBeenCalledTimes(1)
    await act(async () => finish(ICP))
  })

  it('shows the error and stays on step 1 when generation fails', async () => {
    api.generateStructuredIcp.mockRejectedValue(Object.assign(new Error('Model is busy'), { status: 503 }))
    setup([])
    await userEvent.type(screen.getByLabelText(/product name/i), 'Acme')
    await userEvent.click(generateButton())
    expect(await screen.findByRole('alert')).toHaveTextContent('Model is busy')
    expect(screen.getByRole('heading', { name: /describe your product/i })).toBeInTheDocument()
  })

  it('says the server could not be reached on a network error', async () => {
    api.generateStructuredIcp.mockRejectedValue(Object.assign(new Error('Failed to fetch'), { isNetworkError: true }))
    setup([])
    await userEvent.type(screen.getByLabelText(/product name/i), 'Acme')
    await userEvent.click(generateButton())
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn.t reach quarry/i)
  })
})

describe('NewRequest search key notice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leads.refreshRequests = vi.fn(() => Promise.resolve())
  })

  it('tells the user up front, with a link to Account settings, when no key is set', async () => {
    api.getSerperKey.mockResolvedValue({ has_key: false, masked: null })
    setup([])
    const note = await screen.findByText(/no search key on your account/i)
    const link = within(note.closest('[role="status"]')).getByRole('link', { name: /account settings/i })
    expect(link).toHaveAttribute('href', '/profile')
  })

  it('shows nothing when a key is set', async () => {
    api.getSerperKey.mockResolvedValue({ has_key: true, masked: 'abcd' })
    setup([])
    await waitFor(() => expect(api.getSerperKey).toHaveBeenCalled())
    expect(screen.queryByText(/no search key/i)).not.toBeInTheDocument()
  })

  it('shows nothing, and invents nothing, when the lookup fails', async () => {
    api.getSerperKey.mockRejectedValue(new Error('down'))
    setup([])
    await waitFor(() => expect(api.getSerperKey).toHaveBeenCalled())
    expect(screen.queryByText(/no search key/i)).not.toBeInTheDocument()
  })
})

describe('NewRequest step 2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leads.refreshRequests = vi.fn(() => Promise.resolve())
    api.getSerperKey.mockResolvedValue({ has_key: true, masked: 'abcd' })
    api.updateLeadRequest.mockResolvedValue({})
  })

  const open = async () => {
    setup([DRAFT])
    await screen.findByRole('heading', { name: /icp definition/i })
  }

  it('opens straight on the ICP for a draft that already has one, with all six sections', async () => {
    await open()
    ;['Firmographics', 'Technographics', 'Team & decision makers', 'Buying signals', 'Compliance needs', 'Deployment preferences'].forEach((n) => expect(screen.getByRole('region', { name: n })).toBeInTheDocument())
  })

  it('saves the draft and confirms with a toast', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }))
    await waitFor(() => expect(api.updateLeadRequest).toHaveBeenCalledWith('r1', expect.objectContaining({ status: 'Draft', icp_dimensions: ICP })))
    expect(await screen.findByRole('status')).toHaveTextContent(/draft saved/i)
  })

  it('shows an error toast when the draft cannot be saved', async () => {
    api.updateLeadRequest.mockRejectedValue(new Error('Disk full'))
    await open()
    await userEvent.click(screen.getByRole('button', { name: /save draft/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full')
  })

  it('shows the consistency check error instead of swallowing it', async () => {
    api.checkIcpConsistency.mockRejectedValue(new Error('Checker offline'))
    await open()
    await userEvent.click(screen.getByRole('button', { name: /verify consistency/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Checker offline')
  })

  it('launches the search with the draft id, blocks a double click and shows the launched state', async () => {
    let finish
    api.createRequest.mockReturnValue(new Promise((r) => (finish = r)))
    await open()
    const launch = screen.getByRole('button', { name: /find matching companies/i })
    await userEvent.click(launch)
    expect(launch).toBeDisabled()
    await userEvent.click(launch)
    expect(api.createRequest).toHaveBeenCalledTimes(1)
    expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ icp_dimensions: ICP }), 'r1')
    await act(async () => finish({}))
    expect(await screen.findByRole('heading', { name: /request launched/i })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /view requests/i }))
    expect(screen.getByTestId('where')).toHaveTextContent('/lead-requests')
  })

  it('links to Account settings when the launch fails because the search key is missing', async () => {
    api.createRequest.mockRejectedValue(Object.assign(new Error('Add your Serper API key in Profile to launch lead generation.'), { status: 400 }))
    await open()
    await userEvent.click(screen.getByRole('button', { name: /find matching companies/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/serper api key/i)
    expect(within(alert).getByRole('link', { name: /account settings/i })).toHaveAttribute('href', '/profile')
  })

  it('goes back to the inputs with Modify inputs', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: /modify inputs/i }))
    expect(screen.getByRole('heading', { name: /describe your product/i })).toBeInTheDocument()
  })
})
