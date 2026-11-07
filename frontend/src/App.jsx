import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  return user ? children : <Navigate to="/login" replace />
}

function AppRoutes() {
  const { user, loading } = useAuth()
  if (loading) return null
  return (
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
      </Route>

      <Route path="*" element={<Navigate to="/lead-requests" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <LeadProvider>
            <AppRoutes />
          </LeadProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}
