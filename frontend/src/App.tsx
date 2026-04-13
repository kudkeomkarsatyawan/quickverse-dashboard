import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './lib/store'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import OrdersPage from './pages/OrdersPage'
import SettlementPage from './pages/SettlementPage'
import AnalyticsPage from './pages/AnalyticsPage'
import DeliveryPage from './pages/DeliveryPage'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore(s => s.token)
  if (!token) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<Navigate to="/orders" replace />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="settlements" element={<SettlementPage />} />
        <Route path="analytics" element={<AnalyticsPage />} />
        <Route path="delivery" element={<DeliveryPage />} />
      </Route>
    </Routes>
  )
}
