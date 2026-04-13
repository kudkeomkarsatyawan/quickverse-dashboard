import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../lib/store'
import { syncOrders, syncVendors } from '../lib/api'
import { useState, useEffect } from 'react'

const navItems = [
  { to: '/orders', label: 'Orders', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  { to: '/settlements', label: 'Settlements', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
  { to: '/analytics', label: 'Analytics', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
  { to: '/delivery', label: 'Delivery', icon: 'M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0' },
]

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('qv_theme') === 'dark')

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('qv_theme', dark ? 'dark' : 'light')
  }, [dark])

  return { dark, toggle: () => setDark(d => !d) }
}

export default function Layout() {
  const { token, regionId, userName, logout } = useAuthStore()
  const navigate = useNavigate()
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const { dark, toggle: toggleTheme } = useTheme()

  const handleSync = async () => {
    if (!token || !regionId) return
    setSyncing(true)
    setSyncMsg('')
    try {
      const vendorResult = await syncVendors(regionId)
      const orderResult = await syncOrders(regionId, token)
      setSyncMsg(`Synced ${orderResult.synced} orders, ${vendorResult.synced} vendors`)
      setTimeout(() => setSyncMsg(''), 4000)
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e.response?.data?.detail || e.message}`)
    } finally {
      setSyncing(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-canvas">
      {/* Sidebar */}
      <aside className="w-56 bg-raised border-r border-line flex flex-col">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-line">
          <h1 className="text-sm font-semibold text-ink tracking-wide">Quickverse</h1>
          <p className="text-2xs text-ink-tertiary mt-0.5">Operations Dashboard</p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 px-2">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] mb-0.5 transition-colors ${
                  isActive
                    ? 'bg-accent-soft text-accent font-medium'
                    : 'text-ink-secondary hover:bg-accent-soft hover:text-ink'
                }`
              }
            >
              <svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
              </svg>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Bottom section */}
        <div className="px-3 pb-4 space-y-2.5 border-t border-line pt-3">
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs text-ink-secondary hover:bg-accent-soft transition-colors"
          >
            <span>{dark ? 'Dark Mode' : 'Light Mode'}</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {dark ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              )}
            </svg>
          </button>

          {/* Sync */}
          <button
            onClick={handleSync}
            disabled={syncing}
            className="w-full qv-btn text-xs disabled:opacity-40"
          >
            {syncing ? 'Syncing...' : 'Sync Orders'}
          </button>
          {syncMsg && <p className="text-2xs text-green-600 dark:text-green-400 px-1">{syncMsg}</p>}

          {/* User */}
          <div className="px-1 pt-1">
            <p className="text-xs text-ink font-medium">{userName || 'Admin'}</p>
            <p className="text-2xs text-ink-tertiary">Region: {regionId || '—'}</p>
          </div>
          <button onClick={handleLogout} className="text-2xs text-red-500 hover:text-red-600 px-1 transition-colors">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto bg-canvas">
        <Outlet />
      </main>
    </div>
  )
}
