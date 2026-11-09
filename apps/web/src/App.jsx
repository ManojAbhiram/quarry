import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { LeadProvider } from './context/LeadContext'
import { ThemeProvider } from './context/ThemeContext'
import Login from './pages/Login'
import Signup from './pages/Signup'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import GoogleCallback from './pages/GoogleCallback'
import Dashboard from './pages/Dashboard'
import LeadRequests from './pages/LeadRequests'
import CreateLeadRequest from './pages/CreateLeadRequest'
import NewRequest from './pages/NewRequest'
import DirectCompanies from './pages/DirectCompanies'
import RequestDetails from './pages/RequestDetails'
import Profile from './pages/Profile'
import Layout from './components/Layout'
import LeadLists from './pages/LeadLists'
import UiLab from './pages/UiLab'
import Outreach from './pages/Outreach'
import Integrations from './pages/Integrations'
import Watch from './pages/Watch'
import { BootScreen, ErrorBoundary, NotFound, ToastProvider } from './components/kit'

function ProtectedRoute({ children }) {
  const { user } = useAuth()
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { user, loading, bootError, retry } = useAuth()
  const { pathname } = useLocation()

  // Checking the saved session: show it, and if the server can't be reached say so (and keep the user signed in).
  if (loading || bootError) return <BootScreen error={bootError} onRetry={retry} />

  return (
    // A crash in one page shows an error with "Try again", and navigating away clears it.
    <ErrorBoundary resetKey={pathname}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/lead-requests" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/lead-requests" replace /> : <Signup />} />
        <Route path="/forgot-password" element={user ? <Navigate to="/lead-requests" replace /> : <ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        {import.meta.env.DEV && <Route path="/ui-lab" element={<UiLab />} />}
        <Route path="/auth/google/callback" element={<GoogleCallback />} />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/lead-requests" replace />} />
          <Route path="lead-requests" element={<LeadRequests />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="new-request" element={<CreateLeadRequest />} />
          <Route path="request/:id/intake" element={<NewRequest />} />
          <Route path="request/:id/companies" element={<DirectCompanies />} />
          <Route path="request/:id" element={<RequestDetails />} />
          <Route path="profile" element={<Profile />} />
          <Route path="lead-lists" element={<LeadLists />} />
          <Route path="outreach" element={<Outreach />} />
          <Route path="watch" element={<Watch />} />
          <Route path="integrations" element={<Integrations />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </ErrorBoundary>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <LeadProvider>
              <AppRoutes />
            </LeadProvider>
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  )
}
