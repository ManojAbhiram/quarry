import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('../../api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))
vi.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ theme: 'light', toggleTheme: vi.fn(), palette: 'indigo', setPalette: vi.fn() }) }))

const auth = { login: vi.fn(), register: vi.fn(), applyAuth: vi.fn() }
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }))

import { api } from '../../api'
import Login from '../Login'
import Signup from '../Signup'
import ForgotPassword from '../ForgotPassword'
import ResetPassword from '../ResetPassword'
import GoogleCallback from '../GoogleCallback'

const httpErr = (status, message = 'x') => Object.assign(new Error(message), { status })
const netErr = () => Object.assign(new Error('Failed to fetch'), { isNetworkError: true })

function Where() {
  const l = useLocation()
  return <div data-testid="where">{l.pathname}</div>
}

function renderAt(url, element, path = '/') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})

describe('Login', () => {
  const open = () => renderAt('/login', <Login />, '/login')

  it('focuses the email field and uses correct autocomplete hints', () => {
    open()
    const email = screen.getByLabelText(/^Email/)
    expect(email).toHaveFocus()
    expect(email).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'current-password')
  })

  it('links to sign up and to forgot password', () => {
    open()
    expect(screen.getByRole('link', { name: /Forgot password/i })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: /Create an account/i })).toHaveAttribute('href', '/register')
  })

  it('validates the email on blur', async () => {
    open()
    await userEvent.type(screen.getByLabelText(/^Email/), 'nope')
    await userEvent.tab()
    expect(await screen.findByText('Enter a valid email address.')).toBeInTheDocument()
  })

  it('shows required errors on submit and does not call the API', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your password.')).toBeInTheDocument()
    expect(auth.login).not.toHaveBeenCalled()
  })

  it('toggles password visibility with an accessible label', async () => {
    open()
    const pw = screen.getByLabelText(/^Password/)
    expect(pw).toHaveAttribute('type', 'password')
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect(pw).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: 'Hide password' })).toBeInTheDocument()
  })

  async function fillAndSubmit() {
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co')
    await userEvent.type(screen.getByLabelText(/^Password/), 'secret123')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
  }

  it('signs in and goes to the app', async () => {
    auth.login.mockResolvedValue()
    open()
    await fillAndSubmit()
    expect(auth.login).toHaveBeenCalledWith('a@b.co', 'secret123')
    expect(await screen.findByTestId('where')).toHaveTextContent('/')
  })

  it('shows one uniform message for wrong credentials', async () => {
    auth.login.mockRejectedValue(httpErr(401, 'Invalid email or password. If you signed up with Google, use Continue with Google.'))
    open()
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect email or password.')
  })

  it('shows a friendly message on 429', async () => {
    auth.login.mockRejectedValue(httpErr(429, 'Rate limit'))
    open()
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts, please wait a minute and try again')
  })

  it('says the server cannot be reached and offers a retry', async () => {
    auth.login.mockRejectedValueOnce(netErr())
    open()
    await fillAndSubmit()
    expect(await screen.findByRole('alert')).toHaveTextContent(/can.t be reached/i)
    auth.login.mockResolvedValue()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(auth.login).toHaveBeenCalledTimes(2))
  })

  it('blocks a double submit while signing in', async () => {
    auth.login.mockReturnValue(new Promise(() => {}))
    open()
    await fillAndSubmit()
    const btn = await screen.findByRole('button', { name: /Signing in/ })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(auth.login).toHaveBeenCalledTimes(1)
  })

  it('shows the Google failure passed in the URL', () => {
    renderAt('/login?error=google_auth_failed', <Login />, '/login')
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in failed')
  })

  it('reports a Google start failure', async () => {
    api.get.mockRejectedValue(netErr())
    open()
    await userEvent.click(screen.getByRole('button', { name: /Continue with Google/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/can.t be reached/i)
  })
})

describe('Signup', () => {
  const open = () => renderAt('/register', <Signup />, '/register')

  it('focuses the first field and uses new-password', () => {
    open()
    expect(screen.getByLabelText(/^Full name/)).toHaveFocus()
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByLabelText(/^Confirm password/)).toHaveAttribute('autocomplete', 'new-password')
    expect(screen.getByRole('link', { name: /Sign in/ })).toHaveAttribute('href', '/login')
  })

  it('shows required errors for every field on submit', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Enter your name.')).toBeInTheDocument()
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument()
    expect(screen.getByText('Enter your organization name.')).toBeInTheDocument()
    expect(screen.getByText('Enter your organization domain.')).toBeInTheDocument()
    expect(auth.register).not.toHaveBeenCalled()
  })

  async function fill({ password = 'secret123', confirm = 'secret123' } = {}) {
    await userEvent.type(screen.getByLabelText(/^Full name/), 'Asha')
    await userEvent.type(screen.getByLabelText(/^Work email/), 'a@b.co')
    await userEvent.type(screen.getByLabelText(/^Organization name/), 'Acme')
    await userEvent.type(screen.getByLabelText(/^Organization domain/), 'acme.io')
    await userEvent.type(screen.getByLabelText(/^Password/), password)
    await userEvent.type(screen.getByLabelText(/^Confirm password/), confirm)
  }

  it('flags a short password and a mismatch', async () => {
    open()
    await fill({ password: 'abc', confirm: 'abd' })
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByText('Use at least 6 characters.')).toBeInTheDocument()
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    expect(auth.register).not.toHaveBeenCalled()
  })

  it('registers and goes to the app', async () => {
    auth.register.mockResolvedValue()
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(auth.register).toHaveBeenCalledWith('a@b.co', 'secret123', 'Asha', 'Acme', 'acme.io')
    expect(await screen.findByTestId('where')).toHaveTextContent('/')
  })

  it('shows the server reason, 429 and network errors', async () => {
    open()
    await fill()
    auth.register.mockRejectedValueOnce(httpErr(400, 'Email already registered'))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Email already registered')
    auth.register.mockRejectedValueOnce(httpErr(429))
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Too many attempts'))
    auth.register.mockRejectedValueOnce(netErr())
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/can.t be reached/i))
  })

  it('blocks a double submit', async () => {
    auth.register.mockReturnValue(new Promise(() => {}))
    open()
    await fill()
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }))
    const btn = await screen.findByRole('button', { name: /Creating account/ })
    await userEvent.click(btn)
    expect(auth.register).toHaveBeenCalledTimes(1)
  })
})

describe('ForgotPassword', () => {
  const open = () => renderAt('/forgot-password', <ForgotPassword />, '/forgot-password')

  it('validates the email', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('shows a success state that does not reveal whether the account exists', async () => {
    api.post.mockResolvedValue({})
    open()
    expect(screen.getByLabelText(/^Email/)).toHaveFocus()
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co')
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(api.post).toHaveBeenCalledWith('/auth/forgot-password', { email: 'a@b.co' })
    expect(await screen.findByRole('status')).toHaveTextContent('If an account exists for a@b.co')
    expect(screen.getByRole('link', { name: /Back to sign in/ })).toHaveAttribute('href', '/login')
  })

  it('handles 429 and network errors', async () => {
    open()
    await userEvent.type(screen.getByLabelText(/^Email/), 'a@b.co')
    api.post.mockRejectedValueOnce(httpErr(429))
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
    api.post.mockRejectedValueOnce(netErr())
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/can.t be reached/i))
  })
})

describe('ResetPassword', () => {
  it('shows an error with a link to request a new link when the token is missing', () => {
    renderAt('/reset-password', <ResetPassword />, '/reset-password')
    expect(screen.getByRole('alert')).toHaveTextContent(/link/i)
    expect(screen.getByRole('link', { name: /Request a new link/ })).toHaveAttribute('href', '/forgot-password')
  })

  const open = () => renderAt('/reset-password?token=abc', <ResetPassword />, '/reset-password')
  async function fill(confirm = 'secret123') {
    await userEvent.type(screen.getByLabelText(/^New password/), 'secret123')
    await userEvent.type(screen.getByLabelText(/^Confirm password/), confirm)
    await userEvent.click(screen.getByRole('button', { name: 'Reset password' }))
  }

  it('validates the match', async () => {
    open()
    expect(screen.getByLabelText(/^New password/)).toHaveFocus()
    expect(screen.getByLabelText(/^New password/)).toHaveAttribute('autocomplete', 'new-password')
    await fill('different')
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument()
    expect(api.post).not.toHaveBeenCalled()
  })

  it('confirms success with a link to sign in', async () => {
    api.post.mockResolvedValue({})
    open()
    await fill()
    expect(api.post).toHaveBeenCalledWith('/auth/reset-password', { token: 'abc', new_password: 'secret123' })
    expect(await screen.findByRole('status')).toHaveTextContent('Password updated')
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('treats an invalid or expired token as an error state with a new-link action', async () => {
    api.post.mockRejectedValue(httpErr(400, 'Invalid or expired password reset token'))
    open()
    await fill()
    expect(await screen.findByRole('alert')).toHaveTextContent(/expired|invalid/i)
    expect(screen.getByRole('link', { name: /Request a new link/ })).toHaveAttribute('href', '/forgot-password')
  })

  it('keeps the form on a network error', async () => {
    api.post.mockRejectedValue(netErr())
    open()
    await fill()
    expect(await screen.findByRole('alert')).toHaveTextContent(/can.t be reached/i)
    expect(screen.getByRole('button', { name: 'Reset password' })).toBeInTheDocument()
  })
})

describe('GoogleCallback', () => {
  const open = (qs) => renderAt(`/auth/google/callback${qs}`, <GoogleCallback />, '/auth/google/callback')

  it('shows a labelled loading state while it finishes', () => {
    api.get.mockReturnValue(new Promise(() => {}))
    open('?access_token=t&refresh_token=r')
    expect(screen.getByRole('status')).toHaveTextContent('Completing sign in')
  })

  it('applies auth and goes to the app on success', async () => {
    api.get.mockResolvedValue({ id: 1 })
    open('?access_token=t&refresh_token=r')
    await waitFor(() => expect(auth.applyAuth).toHaveBeenCalled())
    expect(await screen.findByTestId('where')).toHaveTextContent('/lead-requests')
  })

  it('shows an error with a link back to sign in when tokens are missing', () => {
    open('?error=access_denied')
    expect(screen.getByRole('alert')).toHaveTextContent(/Google sign-in failed/)
    expect(screen.getByRole('link', { name: /Back to sign in/ })).toHaveAttribute('href', '/login')
  })

  it('shows the error and clears tokens when /users/me fails', async () => {
    api.get.mockRejectedValue(httpErr(401))
    open('?access_token=t&refresh_token=r')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Google sign-in failed/)
    expect(localStorage.getItem('token')).toBeNull()
  })
})

describe('Auth screen visual layer', () => {
  const open = () => renderAt('/login', <Login />, '/login')

  it('always has the brand headline and three feature cards in the DOM', () => {
    open()
    expect(screen.getByText(/Find the companies worth contacting/i)).toBeInTheDocument()
    expect(screen.getAllByTestId('auth-feature')).toHaveLength(3)
  })

  it('keeps decorative layers hidden from assistive tech', () => {
    open()
    expect(screen.getByTestId('backdrop')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('auth-aurora')).toHaveAttribute('aria-hidden', 'true')
  })

  it('offers the palette switcher and theme toggle', () => {
    open()
    expect(screen.getByRole('button', { name: /Colour palette/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Switch to dark theme/i })).toBeInTheDocument()
  })

  it('has exactly one h1, the form title, and the form comes before the brand panel in the DOM', () => {
    open()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    const form = screen.getByRole('button', { name: /^Sign in$/ })
    const headline = screen.getByText(/Find the companies worth contacting/i)
    expect(form.compareDocumentPosition(headline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
