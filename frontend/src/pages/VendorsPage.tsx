import { useEffect, useState } from 'react'
import { fetchVendors, syncVendors, updateVendor, updateVendorLocation } from '../lib/api'
import { useAuthStore } from '../lib/store'
import type { Vendor } from '../lib/types'

const DEFAULT_COMMISSION: Record<string, number> = { grocery: 2, food: 10 }

function getDefaultCommission(category: string): number {
  return category.toLowerCase().includes('grocery')
    ? DEFAULT_COMMISSION.grocery
    : DEFAULT_COMMISSION.food
}

function isGroceryCat(category: string) {
  return category.toLowerCase().includes('grocery')
}

export default function VendorsPage() {
  const regionId = useAuthStore(s => s.regionId)
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [editCommission, setEditCommission] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [editLat, setEditLat] = useState('')
  const [editLng, setEditLng] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try { setVendors(await fetchVendors()) } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleSync = async () => {
    if (!regionId || syncing) return
    setSyncing(true)
    setSyncMsg('')
    try {
      const result = await syncVendors(regionId)
      setSyncMsg(`Synced ${result.synced} vendors`)
      await load()
    } catch (e: any) {
      setSyncMsg(`Sync failed: ${e.response?.data?.detail || e.message}`)
    }
    setSyncing(false)
    setTimeout(() => setSyncMsg(''), 4000)
  }

  const startEdit = (v: Vendor) => {
    setEditId(v.vendorId)
    setEditCommission(v.customCommissionPercent != null ? String(v.customCommissionPercent) : '')
    setEditNotes(v.notes || '')
    setEditLat(v.lat != null ? String(v.lat) : '')
    setEditLng(v.lng != null ? String(v.lng) : '')
  }

  const cancelEdit = () => {
    setEditId(null)
    setEditCommission('')
    setEditNotes('')
    setEditLat('')
    setEditLng('')
  }

  const handleSave = async () => {
    if (!editId) return
    setSaving(true)
    try {
      await updateVendor(editId, {
        custom_commission_percent: editCommission ? parseFloat(editCommission) : undefined,
        notes: editNotes,
      })
      const lat = parseFloat(editLat)
      const lng = parseFloat(editLng)
      if (editLat && editLng && !isNaN(lat) && !isNaN(lng)) {
        await updateVendorLocation(editId, lat, lng)
      }
      cancelEdit()
      await load()
    } catch {}
    setSaving(false)
  }

  const categories = [...new Set(vendors.map(v => v.storeCategory).filter(Boolean))].sort()

  const filtered = vendors.filter(v => {
    const matchSearch = !search || v.vendorName.toLowerCase().includes(search.toLowerCase())
    const matchCat = !catFilter || v.storeCategory === catFilter
    return matchSearch && matchCat
  })

  const totalOrders    = vendors.reduce((s, v) => s + v.totalOrders, 0)
  const totalCompleted = vendors.reduce((s, v) => s + v.completedOrders, 0)
  const completionRate = totalOrders > 0 ? Math.round((totalCompleted / totalOrders) * 100) : 0

  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-line border-t-accent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink">Vendors</h1>
          <p className="text-sm text-ink-tertiary mt-0.5">
            {vendors.length} vendors · {totalOrders.toLocaleString('en-IN')} orders · {completionRate}% completion
          </p>
        </div>
        <div className="flex items-center gap-3">
          {syncMsg && (
            <p className={`text-xs ${syncMsg.startsWith('Sync failed') ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
              {syncMsg}
            </p>
          )}
          <button onClick={handleSync} disabled={syncing} className="qv-btn text-xs disabled:opacity-40">
            {syncing ? 'Syncing...' : 'Sync Vendors'}
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <SummaryCard label="Total Vendors" value={String(vendors.length)} sub={`${categories.length} categories`} />
        <SummaryCard label="Total Orders" value={totalOrders.toLocaleString('en-IN')} sub="all time" />
        <SummaryCard label="Completed" value={totalCompleted.toLocaleString('en-IN')} sub={`${completionRate}% rate`} color="green" />
        <SummaryCard
          label="Location Set"
          value={`${vendors.filter(v => v.lat != null).length} / ${vendors.length}`}
          sub="vendors with map coordinates"
          color="accent"
        />
      </div>

      {/* Filters */}
      <div className="qv-card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block qv-label mb-1.5">Search</label>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Vendor name..."
            className="qv-input w-52"
          />
        </div>
        <div>
          <label className="block qv-label mb-1.5">Category</label>
          <select value={catFilter} onChange={e => setCatFilter(e.target.value)} className="qv-input">
            <option value="">All categories</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(search || catFilter) && (
          <button onClick={() => { setSearch(''); setCatFilter('') }} className="qv-btn-ghost text-xs">
            Clear filters
          </button>
        )}
        <span className="ml-auto text-xs text-ink-tertiary self-center">
          {filtered.length} of {vendors.length} vendors
        </span>
      </div>

      {/* Vendor grid */}
      {vendors.length === 0 ? (
        <div className="qv-card p-16 text-center">
          <p className="text-ink-secondary text-sm">No vendors found.</p>
          <p className="text-ink-tertiary text-xs mt-1">Click <strong>Sync Vendors</strong> to import from Admin Deck.</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="qv-card p-12 text-center text-ink-tertiary">No vendors match your search.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(v => {
            const isEditing  = editId === v.vendorId
            const isGrocery  = isGroceryCat(v.storeCategory)
            const defaultComm = getDefaultCommission(v.storeCategory)
            const effectiveComm = v.customCommissionPercent != null
              ? v.customCommissionPercent
              : defaultComm
            const hasCustom = v.customCommissionPercent != null

            return (
              <div key={v.vendorId} className={`qv-card p-4 transition-shadow ${isEditing ? 'ring-1 ring-accent/30' : ''}`}>
                {/* Vendor header */}
                <div className="flex items-start gap-3 mb-4">
                  <div className="w-11 h-11 rounded-lg bg-inset border border-line flex items-center justify-center overflow-hidden flex-shrink-0">
                    {v.vendorLogoUrl
                      ? <img src={v.vendorLogoUrl} className="w-11 h-11 object-cover" alt="" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      : <span className="text-lg font-semibold text-ink-tertiary">{v.vendorName.charAt(0)}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-ink truncate">{v.vendorName}</h3>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className={`qv-badge ${
                        isGrocery
                          ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400'
                          : 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400'
                      }`}>
                        {v.storeCategory || 'Unknown'}
                      </span>
                      {v.vendorPhone && (
                        <span className="text-2xs text-ink-tertiary">{v.vendorPhone}</span>
                      )}
                      {/* Location status pill */}
                      {v.lat != null && v.lng != null ? (
                        <span
                          className="text-2xs text-green-600 dark:text-green-400 flex items-center gap-0.5 font-medium"
                          title={`Pickup: ${v.lat.toFixed(5)}, ${v.lng.toFixed(5)}`}
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C5.24 0 3 2.24 3 5c0 3.75 5 11 5 11s5-7.25 5-11c0-2.76-2.24-5-5-5zm0 7.5A2.5 2.5 0 1 1 8 2.5 2.5 2.5 0 0 1 8 7.5z"/>
                          </svg>
                          Located
                        </span>
                      ) : (
                        <span
                          className="text-2xs text-amber-500 flex items-center gap-0.5"
                          title="No pickup location set — edit to add coordinates"
                        >
                          <svg className="w-2.5 h-2.5" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 0C5.24 0 3 2.24 3 5c0 3.75 5 11 5 11s5-7.25 5-11c0-2.76-2.24-5-5-5zm0 7.5A2.5 2.5 0 1 1 8 2.5 2.5 2.5 0 0 1 8 7.5z"/>
                          </svg>
                          No location
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => isEditing ? cancelEdit() : startEdit(v)}
                    className="qv-btn-ghost text-xs flex-shrink-0"
                  >
                    {isEditing ? 'Cancel' : 'Edit'}
                  </button>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <StatCell label="Orders" value={v.totalOrders} />
                  <StatCell label="Completed" value={v.completedOrders} color="green" />
                  <div className="bg-inset rounded-lg p-2.5 text-center border border-line">
                    <p className="qv-label">Commission</p>
                    <p className={`text-sm font-semibold font-mono mt-0.5 ${hasCustom ? 'text-accent' : 'text-ink'}`}>
                      {effectiveComm}%{hasCustom && <span className="text-2xs ml-0.5 opacity-70">↑</span>}
                    </p>
                  </div>
                </div>

                {/* Completion bar */}
                {v.totalOrders > 0 && (
                  <div className="mb-3">
                    <div className="flex justify-between text-2xs text-ink-tertiary mb-0.5">
                      <span>Completion</span>
                      <span>{Math.round((v.completedOrders / v.totalOrders) * 100)}%</span>
                    </div>
                    <div className="w-full h-1 bg-line rounded-full overflow-hidden">
                      <div
                        className="h-full bg-green-500 rounded-full"
                        style={{ width: `${Math.round((v.completedOrders / v.totalOrders) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Edit form */}
                {isEditing && (
                  <div className="border-t border-line pt-3 space-y-3">
                    <div>
                      <label className="block qv-label mb-1.5">Custom Commission %</label>
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          step="0.5"
                          min="0"
                          max="100"
                          value={editCommission}
                          onChange={e => setEditCommission(e.target.value)}
                          placeholder={`${defaultComm} (default)`}
                          className="qv-input flex-1"
                        />
                        {editCommission && (
                          <button
                            onClick={() => setEditCommission('')}
                            className="text-xs text-ink-tertiary hover:text-red-500 transition-colors"
                            title="Clear (use default)"
                          >
                            Reset
                          </button>
                        )}
                      </div>
                      <p className="text-2xs text-ink-faint mt-1">Leave blank to use default ({defaultComm}%)</p>
                    </div>
                    <div>
                      <label className="block qv-label mb-1.5">Notes</label>
                      <input
                        value={editNotes}
                        onChange={e => setEditNotes(e.target.value)}
                        placeholder="Internal notes..."
                        className="qv-input w-full"
                      />
                    </div>
                    <div>
                      <label className="block qv-label mb-1.5">
                        Pickup Location
                        <span className="ml-1.5 text-ink-faint font-normal">(for Live Map routes)</span>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="number"
                          step="0.000001"
                          value={editLat}
                          onChange={e => setEditLat(e.target.value)}
                          placeholder="Latitude"
                          className="qv-input"
                        />
                        <input
                          type="number"
                          step="0.000001"
                          value={editLng}
                          onChange={e => setEditLng(e.target.value)}
                          placeholder="Longitude"
                          className="qv-input"
                        />
                      </div>
                      {editLat && editLng && (isNaN(parseFloat(editLat)) || isNaN(parseFloat(editLng))) && (
                        <p className="text-2xs text-red-500 mt-1">Enter valid decimal coordinates</p>
                      )}
                    </div>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="w-full qv-btn text-xs disabled:opacity-40"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                )}

                {/* Notes display */}
                {!isEditing && v.notes && (
                  <p className="text-xs text-ink-tertiary italic border-t border-line pt-3 truncate" title={v.notes}>
                    {v.notes}
                  </p>
                )}

                {/* Vendor ID */}
                <p className="text-2xs text-ink-faint mt-2 font-mono">ID: {v.vendorId}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, sub, color }: { label: string; value: string; sub: string; color?: string }) {
  const borderCls =
    color === 'green'  ? 'border-green-200 dark:border-green-500/20' :
    color === 'accent' ? 'border-accent/20' : ''
  const valueCls =
    color === 'green'  ? 'text-green-700 dark:text-green-400' :
    color === 'accent' ? 'text-accent' : 'text-ink'
  return (
    <div className={`qv-card p-5 ${borderCls}`}>
      <p className="qv-label">{label}</p>
      <p className={`text-2xl font-semibold font-mono mt-2 ${valueCls}`}>{value}</p>
      <p className="text-2xs text-ink-tertiary mt-1">{sub}</p>
    </div>
  )
}

function StatCell({ label, value, color }: { label: string; value: number; color?: string }) {
  const valueCls = color === 'green' ? 'text-green-700 dark:text-green-400' : 'text-ink'
  return (
    <div className="bg-inset rounded-lg p-2.5 text-center border border-line">
      <p className="qv-label">{label}</p>
      <p className={`text-sm font-semibold font-mono mt-0.5 ${valueCls}`}>{value}</p>
    </div>
  )
}
