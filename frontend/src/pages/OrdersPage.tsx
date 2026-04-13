import { useEffect, useState, useCallback } from 'react'
import { fetchOrders, fetchVendors, fetchDeliveryPersons, assignDelivery } from '../lib/api'
import type { Order, Vendor, DeliveryPerson } from '../lib/types'

const STATUS_BADGE: Record<string, string> = {
  PENDING:   'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  ACCEPTED:  'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  PACKED:    'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
  SHIPPED:   'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  COMPLETED: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  CANCELLED: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  REJECTED:  'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
}

const STATUS_SLABS: [string, string][] = [
  ['ALL', 'All'], ['PENDING', 'Pending'], ['ACCEPTED', 'Accepted'],
  ['SHIPPED', 'Shipped'], ['COMPLETED', 'Delivered'],
]

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [deliveryPersons, setDeliveryPersons] = useState<DeliveryPerson[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [vendorFilter, setVendorFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [todayActive, setTodayActive] = useState(false)
  const [statusSlab, setStatusSlab] = useState('ALL')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const vendorMap = Object.fromEntries(vendors.map(v => [v.vendorId, v.vendorName]))

  const getTodayStr = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  const loadOrders = useCallback(async () => {
    setLoading(true)
    try {
      const params: Record<string, string | number> = { page, per_page: 50 }
      if (statusSlab !== 'ALL') params.status = statusSlab
      if (vendorFilter) params.vendor_id = vendorFilter
      if (paymentFilter) params.payment_method = paymentFilter
      if (todayActive) { const t = getTodayStr(); params.date_from = t; params.date_to = t }
      else { if (dateFrom) params.date_from = dateFrom; if (dateTo) params.date_to = dateTo }
      if (search) params.search = search
      const data = await fetchOrders(params)
      setOrders(data.orders); setTotal(data.total)
    } catch {}
    setLoading(false)
  }, [page, statusSlab, vendorFilter, paymentFilter, dateFrom, dateTo, todayActive, search])

  useEffect(() => { fetchVendors().then(setVendors).catch(() => {}) }, [])
  useEffect(() => { fetchDeliveryPersons().then(setDeliveryPersons).catch(() => {}) }, [])
  useEffect(() => { loadOrders() }, [loadOrders])

  const handleSearch = () => { setPage(1); loadOrders() }

  const handleAssignDelivery = async (orderId: string, dpId: number) => {
    try { await assignDelivery(orderId, dpId); loadOrders(); setSelectedOrder(null) } catch {}
  }

  const formatDate = (d: string | null) => {
    if (!d) return '—'
    return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true })
  }

  const fmtRs = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 0 })}`

  const subtitle = todayActive || statusSlab !== 'ALL'
    ? `${todayActive ? "Today" : ""}${todayActive && statusSlab !== 'ALL' ? ' · ' : ''}${statusSlab !== 'ALL' ? statusSlab.toLowerCase() : ''} — ${total} results`
    : `${total} total orders`

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink">Orders</h1>
        <p className="text-sm text-ink-tertiary mt-0.5">{subtitle}</p>
      </div>

      {/* Filters */}
      <div className="qv-card p-4 mb-4 flex flex-wrap gap-3 items-end">
        <Field label="Search">
          <input value={search} onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder="Order ID / Phone" className="qv-input w-44" />
        </Field>
        <Field label="Vendor">
          <select value={vendorFilter} onChange={e => { setVendorFilter(e.target.value); setPage(1) }} className="qv-input">
            <option value="">All</option>
            {vendors.map(v => <option key={v.vendorId} value={v.vendorId}>{v.vendorName}</option>)}
          </select>
        </Field>
        <Field label="Payment">
          <select value={paymentFilter} onChange={e => { setPaymentFilter(e.target.value); setPage(1) }} className="qv-input">
            <option value="">All</option>
            <option value="COD">Cash</option>
            <option value="PREPAID">Prepaid</option>
          </select>
        </Field>
        <Field label="From">
          <input type="date" value={todayActive ? '' : dateFrom}
            onChange={e => { setDateFrom(e.target.value); setTodayActive(false); setPage(1) }}
            disabled={todayActive} className={`qv-input ${todayActive ? 'opacity-30' : ''}`} />
        </Field>
        <Field label="To">
          <input type="date" value={todayActive ? '' : dateTo}
            onChange={e => { setDateTo(e.target.value); setTodayActive(false); setPage(1) }}
            disabled={todayActive} className={`qv-input ${todayActive ? 'opacity-30' : ''}`} />
        </Field>
        <button onClick={handleSearch} className="qv-btn text-xs">Search</button>
        <button onClick={() => { setTodayActive(p => !p); setPage(1) }}
          className={`qv-badge px-3 py-2 rounded-lg text-sm font-medium border transition-all cursor-pointer ${
            todayActive ? 'bg-accent text-white border-accent' : 'bg-inset text-ink-secondary border-line hover:border-accent'
          }`}
        >Today</button>
      </div>

      {/* Status slabs */}
      <div className="flex gap-1.5 mb-4">
        {STATUS_SLABS.map(([key, label]) => (
          <button key={key} onClick={() => { setStatusSlab(key); setPage(1) }}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all border ${
              statusSlab === key
                ? 'bg-accent text-white border-accent shadow-sm'
                : 'text-ink-secondary border-transparent hover:bg-accent-soft hover:text-ink'
            }`}
          >{label}</button>
        ))}
      </div>

      {/* Table */}
      <div className="qv-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-inset">
                <th className="text-left p-3 qv-label">Order ID</th>
                <th className="text-left p-3 qv-label">Customer</th>
                <th className="text-left p-3 qv-label">Vendor</th>
                <th className="text-left p-3 qv-label">Items</th>
                <th className="text-right p-3 qv-label">Amount</th>
                <th className="text-center p-3 qv-label">Payment</th>
                <th className="text-center p-3 qv-label">Status</th>
                <th className="text-left p-3 qv-label">Time</th>
                <th className="text-center p-3 qv-label">Delivery</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="p-10 text-center text-ink-tertiary">Loading...</td></tr>
              ) : orders.length === 0 ? (
                <tr><td colSpan={9} className="p-10 text-center text-ink-tertiary">
                  {todayActive ? `No orders today${statusSlab !== 'ALL' ? ` (${statusSlab})` : ''}.` : 'No orders found. Sync from sidebar.'}
                </td></tr>
              ) : orders.map(o => (
                <tr key={o.orderId} className="border-b border-line hover:bg-accent-soft cursor-pointer transition-colors" onClick={() => setSelectedOrder(o)}>
                  <td className="p-3 font-mono text-xs text-ink-secondary">{o.orderId.slice(-8)}</td>
                  <td className="p-3">
                    <p className="font-medium text-ink">{o.customerName}</p>
                    <p className="text-2xs text-ink-tertiary">{o.customerMobile}</p>
                  </td>
                  <td className="p-3 text-ink-secondary">{vendorMap[String(o.shopId)] || `#${o.shopId}`}</td>
                  <td className="p-3 text-ink-secondary text-xs max-w-[150px] truncate">{o.orderDescription || `${o.totalItemCount} items`}</td>
                  <td className="p-3 text-right font-medium text-ink font-mono">{fmtRs(o.totalAmount)}</td>
                  <td className="p-3 text-center">
                    <span className={`qv-badge ${o.paymentMethod === 'COD' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400'}`}>
                      {o.paymentMethod === 'COD' ? 'Cash' : 'Prepaid'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <span className={`qv-badge ${STATUS_BADGE[o.state] || 'bg-inset text-ink-secondary'}`}>{o.state}</span>
                  </td>
                  <td className="p-3 text-xs text-ink-secondary">
                    <p>{formatDate(o.creationTime)}</p>
                    {o.deliveryTimeMinutes && <p className="text-green-600 dark:text-green-400">{o.deliveryTimeMinutes} min</p>}
                  </td>
                  <td className="p-3 text-center text-xs">
                    {o.deliveryPersonId
                      ? <span className="text-green-600 dark:text-green-400">Assigned</span>
                      : <span className="text-ink-faint">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > 50 && (
          <div className="flex items-center justify-between p-4 border-t border-line">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="qv-btn-ghost text-xs disabled:opacity-30">Previous</button>
            <span className="text-xs text-ink-tertiary">Page {page} of {Math.ceil(total / 50)}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page * 50 >= total} className="qv-btn-ghost text-xs disabled:opacity-30">Next</button>
          </div>
        )}
      </div>

      {/* Modal */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedOrder(null)}>
          <div className="qv-card p-6 w-full max-w-md max-h-[80vh] overflow-auto shadow-lg" style={{ boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start mb-5">
              <div>
                <h2 className="text-base font-semibold text-ink">Order #{selectedOrder.orderId.slice(-8)}</h2>
                <span className={`qv-badge mt-1 inline-block ${STATUS_BADGE[selectedOrder.state] || ''}`}>{selectedOrder.state}</span>
              </div>
              <button onClick={() => setSelectedOrder(null)} className="text-ink-tertiary hover:text-ink text-lg leading-none">&times;</button>
            </div>

            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Customer', selectedOrder.customerName], ['Phone', selectedOrder.customerMobile],
                  ['Vendor', vendorMap[String(selectedOrder.shopId)] || `#${selectedOrder.shopId}`],
                  ['Payment', selectedOrder.paymentMethod === 'COD' ? 'Cash' : 'Prepaid'],
                  ['Amount', fmtRs(selectedOrder.totalAmount)], ['Delivery Fee', fmtRs(selectedOrder.deliveryFee)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <p className="text-2xs text-ink-tertiary uppercase tracking-wider mb-0.5">{l}</p>
                    <p className="text-ink font-medium">{v}</p>
                  </div>
                ))}
              </div>

              {selectedOrder.orderItems.length > 0 && (
                <div className="border-t border-line pt-3">
                  <p className="qv-label mb-2">Items</p>
                  {selectedOrder.orderItems.map((item, i) => (
                    <div key={i} className="flex justify-between py-1">
                      <span className="text-ink">{item.name}</span>
                      <span className="text-ink-tertiary">x{item.itemCount}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t border-line pt-3 space-y-1">
                <p className="qv-label mb-1.5">Timeline</p>
                <p className="text-ink-secondary">Placed: {formatDate(selectedOrder.creationTime)}</p>
                {selectedOrder.acceptedDate && <p className="text-ink-secondary">Accepted: {formatDate(selectedOrder.acceptedDate)}</p>}
                {selectedOrder.completedDate && <p className="text-green-600 dark:text-green-400">Completed: {formatDate(selectedOrder.completedDate)}</p>}
                {selectedOrder.rejectedDate && <p className="text-red-600 dark:text-red-400">Rejected: {formatDate(selectedOrder.rejectedDate)}</p>}
                {selectedOrder.deliveryTimeMinutes && <p className="text-green-600 dark:text-green-400 font-medium">{selectedOrder.deliveryTimeMinutes} min delivery</p>}
              </div>

              <div className="border-t border-line pt-3">
                <p className="qv-label mb-1.5">Assign delivery</p>
                <select value={selectedOrder.deliveryPersonId || ''}
                  onChange={e => { if (e.target.value) handleAssignDelivery(selectedOrder.orderId, parseInt(e.target.value)) }}
                  className="qv-input w-full">
                  <option value="">Select...</option>
                  {deliveryPersons.filter(dp => dp.active).map(dp => (
                    <option key={dp.id} value={dp.id}>{dp.name} — {dp.phone}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block qv-label mb-1.5">{label}</label>{children}</div>
}
