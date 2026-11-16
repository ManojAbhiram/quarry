import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AIConnectionSettings from './AIConnectionSettings'

vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() } }))
import { api } from '../../api'
const empty = { has_key: false, models: [], providers: [{ id: 'openai', name: 'OpenAI' }] }
beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(empty) })

it('saves a password field without browser persistence or automatic discovery', async () => {
  const user = userEvent.setup()
  api.put.mockResolvedValue({ ...empty, has_key: true, provider: 'openai', masked: 'se…ey', revision: 'r1' })
  render(<AIConnectionSettings />)
  const key = await screen.findByLabelText('AI provider API key')
  expect(key).toHaveAttribute('type', 'password')
  await user.type(key, 'secret-key')
  await user.click(screen.getByRole('button', { name: 'Save connection' }))
  await waitFor(() => expect(key).toHaveValue(''))
  expect(api.post).not.toHaveBeenCalled()
  expect(screen.getByText('se…ey')).toBeInTheDocument()
})

it('shows unavailable metadata honestly and permits deferred setup', async () => {
  api.get.mockResolvedValue({ ...empty, has_key: true, provider: 'openai', revision: 'r1', verification: { message: 'Saved; unverified.' } })
  api.post.mockResolvedValue({ ...empty, has_key: true, provider: 'openai', revision: 'r2', discovery_status: 'unavailable', verification: { state: 'verification_unsupported', message: 'Non-billable metadata policy has not been established.' } })
  render(<AIConnectionSettings />)
  await userEvent.click(await screen.findByRole('button', { name: 'Refresh models' }))
  expect(await screen.findByText(/Non-billable metadata policy/)).toBeInTheDocument()
  expect(screen.getByLabelText('Primary model')).toBeDisabled()
})

it('disables unknown models and only saves selected eligible IDs', async () => {
  api.get.mockResolvedValue({ ...empty, has_key: true, provider: 'openai', revision: 'r1', models: [
    { id: 'eligible', display_name: 'Text model', eligible: true },
    { id: 'unknown', display_name: 'Unknown model', eligible: false },
  ] })
  api.put.mockResolvedValue({ ...empty, has_key: true, provider: 'openai', primary_model: 'eligible' })
  const user = userEvent.setup()
  render(<AIConnectionSettings />)
  const primary = await screen.findByLabelText('Primary model')
  expect(screen.getAllByRole('option', { name: /Unknown model/ })[0]).toBeDisabled()
  await user.selectOptions(primary, 'eligible')
  await user.click(screen.getByRole('button', { name: 'Save models' }))
  expect(api.put).toHaveBeenCalledWith('/users/me/ai-connection', expect.objectContaining({ primary_model: 'eligible', revision: 'r1' }))
})

const rolloutProviders = [
  { id: 'openai', name: 'OpenAI', metadata_available: false, verification_available: false },
  { id: 'openrouter', name: 'OpenRouter', metadata_available: true, verification_available: false, public_catalogue: true },
]

it('defaults a new connection to a provider with discovery and explains deferred providers', async () => {
  api.get.mockResolvedValue({ ...empty, providers: rolloutProviders })
  const user = userEvent.setup()
  render(<AIConnectionSettings />)
  await waitFor(() => expect(screen.getByLabelText('Provider')).toHaveValue('openrouter'))
  expect(screen.getByText(/public catalogue without sending your API key/i)).toBeInTheDocument()
  await user.selectOptions(screen.getByLabelText('Provider'), 'openai')
  expect(screen.getByText(/Model discovery is not yet enabled for this provider/i)).toBeInTheDocument()
})

it('finishes OpenRouter model setup without claiming key verification', async () => {
  const saved = { has_key: true, provider: 'openrouter', revision: 'r1', models: [], providers: rolloutProviders }
  api.get.mockResolvedValue(saved)
  const discovered = { ...saved, revision: 'r2', models: [{ id: 'vendor/text', display_name: 'Text model', eligible: true }],
    verification: { state: 'verification_unsupported', message: 'Public model catalogue loaded without sending your API key. Credentials have not been checked; no generation performed.' } }
  api.post.mockResolvedValue(discovered)
  api.put.mockResolvedValue({ ...discovered, revision: 'r3', primary_model: 'vendor/text', fast_model: 'vendor/text', ready: true })
  const user = userEvent.setup()
  render(<AIConnectionSettings />)
  await user.click(await screen.findByRole('button', { name: 'Refresh models' }))
  expect(await screen.findByText(/Credentials have not been checked/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Verify credentials' })).toBeDisabled()
  await user.selectOptions(screen.getByLabelText('Primary model'), 'vendor/text')
  await user.click(screen.getByRole('button', { name: 'Save models' }))
  expect(await screen.findByText('Model choices saved.')).toBeInTheDocument()
  expect(screen.getByLabelText('Primary model')).toHaveValue('vendor/text')
  expect(api.post).toHaveBeenCalledTimes(1)
})
