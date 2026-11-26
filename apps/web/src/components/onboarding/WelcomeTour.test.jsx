import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import WelcomeTour from './WelcomeTour'

const auth = { user: null, updateUser: vi.fn() }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }))
vi.mock('../../api', () => ({ api: { get: vi.fn(), put: vi.fn() } }))
import { api } from '../../api'

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  auth.user = { id: 'new-user', onboarding: { state: 'eligible', step: 0, revision: 0, version: 1 } }
  api.get.mockImplementation(() => Promise.resolve(auth.user.onboarding))
  api.put.mockImplementation((_, body) => Promise.resolve({ ...body, version: 1, revision: body.revision + 1 }))
})
const setup = () => render(<MemoryRouter><WelcomeTour /></MemoryRouter>)

it('automatically starts new accounts, advances six stops, and completes without setup', async () => {
  const user = userEvent.setup()
  setup()
  expect(await screen.findByRole('dialog')).toHaveTextContent('Your workspace')
  for (let i = 0; i < 5; i++) await user.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('dialog')).toHaveTextContent('Manage your workspace')
  await user.click(screen.getByRole('button', { name: 'Explore Quarry' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.put).toHaveBeenLastCalledWith('/users/me/onboarding', expect.objectContaining({ state: 'completed', step: 5 }))
  expect(api.get.mock.calls.every(([url]) => url === '/users/me/onboarding')).toBe(true)
})

it('does not enroll legacy or completed accounts', () => {
  auth.user = { id: 'old-user' }
  setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(api.put).not.toHaveBeenCalled()
})

it('offers quiet resume in a later session and Escape dismisses', async () => {
  auth.user.onboarding = { state: 'in_progress', step: 3, revision: 4, version: 1 }
  const user = userEvent.setup()
  setup()
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Resume introduction' }))
  expect(await screen.findByRole('dialog')).toHaveTextContent('Follow up and monitor')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  expect(api.put).toHaveBeenLastCalledWith('/users/me/onboarding', expect.objectContaining({ state: 'dismissed' }))
})

it('keeps a failed dismissal closed and offers a persistence retry', async () => {
  const user = userEvent.setup()
  setup()
  await screen.findByRole('dialog')
  api.put.mockRejectedValue(new Error('offline'))
  await user.click(screen.getByRole('button', { name: 'Skip tour' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('not saved')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('opens the selected destination after retrying a failed completion', async () => {
  auth.user.onboarding = { state: 'in_progress', step: 5, revision: 6, version: 1 }
  sessionStorage.setItem('quarry:tour:new-user', 'active')
  api.put.mockRejectedValueOnce(new Error('offline'))
  const user = userEvent.setup()
  render(<MemoryRouter><WelcomeTour /><Routes>
    <Route path="/" element={null} />
    <Route path="/new-request" element={<h1>New request form</h1>} />
  </Routes></MemoryRouter>)
  await user.click(await screen.findByRole('button', { name: 'Create a request' }))
  await user.click(await screen.findByRole('button', { name: 'Retry saving progress' }))
  expect(await screen.findByRole('heading', { name: 'New request form' })).toBeInTheDocument()
})

it('does not reopen after a stale automatic-start response arrives after terminal progress', async () => {
  let resolveStart
  api.put.mockImplementation(() => new Promise((resolve) => { resolveStart = resolve }))
  setup()
  await waitFor(() => expect(resolveStart).toBeTypeOf('function'))
  const completed = { state: 'completed', step: 5, revision: 3, version: 1 }
  api.get.mockResolvedValue(completed)
  fireEvent.focus(window)
  await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ onboarding: completed }))
  await act(async () => resolveStart({ state: 'in_progress', step: 0, revision: 1, version: 1 }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})

it('contains keyboard focus and restores it after closing', async () => {
  const trigger = document.createElement('button')
  document.body.append(trigger)
  trigger.focus()
  const user = userEvent.setup()
  setup()
  const dialog = await screen.findByRole('dialog')
  expect(dialog).toHaveFocus()
  await user.tab({ shift: true })
  expect(screen.getByRole('button', { name: 'Next' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Close introduction' })).toHaveFocus()
  await user.tab()
  expect(screen.getByRole('button', { name: 'Skip tour' })).toHaveFocus()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(trigger).toHaveFocus())
  trigger.remove()
})
