import { useEffect, useState } from 'react'
import {
  fetchSettlements, fetchVendorSummary, calculateSettlement,
  markSettled, deleteSettlement, updateVendor, fetchOrders
} from '../lib/api'
import type { Settlement, Order } from '../lib/types'

interface VendorSummary {
  vendorId: string; vendorName: string; vendorPhone: string; vendorLogoUrl: string
  commissionPercent: number; customCommission: number | null; clearedTill: string | null
  remainingOrders: number; remainingGmv: number; remainingFoodValue: number
  remainingCommission: number; remainingDeliveryFees: number
  remainingPayable: number; remainingEarnings: number
  pendingSettlements: number; totalHistoricallySettled: number; notes: string
}

const fmt = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const STATUS_BADGE: Record<string, string> = {
  COMPLETED: 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400',
  CANCELLED: 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400',
  REJECTED: 'bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-400',
  ACCEPTED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400',
  PENDING: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400',
  SHIPPED: 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-400',
  PACKED: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-400',
}

export default function SettlementPage() {
  const [vendorSummaries, setVendorSummaries] = useState<VendorSummary[]>([])
  const [settlements, setSettlements] = useState<Settlement[]>([])
  const [selectedVendor, setSelectedVendor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'status' | 'create' | 'history'>('status')

  const [dateStart, setDateStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().split('T')[0] })
  const [dateEnd, setDateEnd] = useState(() => new Date().toISOString().split('T')[0])
  const [adjustments, setAdjustments] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [notes, setNotes] = useState('')
  const [calcError, setCalcError] = useState('')

  const [viewOrdersSettlement, setViewOrdersSettlement] = useState<Settlement | null>(null)
  const [settlementOrders, setSettlementOrders] = useState<Order[]>([])
  const [ordersLoading, setOrdersLoading] = useState(false)

  const [editingVendor, setEditingVendor] = useState(false)
  const [editCommission, setEditCommission] = useState('')
  const [editNotes, setEditNotes] = useState('')

  const load = async () => {
    setLoading(true)
    try { const [vs, s] = await Promise.all([fetchVendorSummary(), fetchSettlements()]); setVendorSummaries(vs); setSettlements(s) } catch {}
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const sv = selectedVendor ? vendorSummaries.find(v => v.vendorId === selectedVendor) : null
  const vendorSettlements = selectedVendor ? settlements.filter(s => s.vendorId === selectedVendor) : []
  const pendingList = vendorSettlements.filter(s => s.status === 'pending')
  const historyList = vendorSettlements.filter(s => s.status === 'settled')

  const totalRemaining = vendorSummaries.reduce((a, v) => a + v.remainingPayable, 0)
  const totalPendingCount = vendorSummaries.reduce((a, v) => a + v.pendingSettlements, 0)
  const totalHistorical = vendorSummaries.reduce((a, v) => a + v.totalHistoricallySettled, 0)
  const totalRemainingEarnings = vendorSummaries.reduce((a, v) => a + v.remainingEarnings, 0)

  const handleCalculate = async () => {
    if (!selectedVendor) return; setCalcError('')
    try {
      await calculateSettlement({ vendor_id: selectedVendor, period_start: dateStart, period_end: dateEnd, adjustments: adjustments ? parseFloat(adjustments) : 0, adjustment_reason: adjustReason, notes })
      setAdjustments(''); setAdjustReason(''); setNotes(''); setView('status'); load()
    } catch (e: any) { setCalcError(e.response?.data?.detail || 'Failed') }
  }
  const handleSettle = async (id: number) => { if (!confirm('Mark as settled?')) return; await markSettled(id); load() }
  const handleDelete = async (id: number) => {
    const s = settlements.find(x => x.id === id)
    const msg = s?.status === 'settled' ? 'This is already SETTLED. Deleting resets cleared-till. Continue?' : 'Delete this pending settlement?'
    if (!window.confirm(msg)) return
    try { await deleteSettlement(id); await load() } catch (e: any) { alert('Delete failed: ' + (e.response?.data?.detail || e.message)) }
  }
  const handleViewOrders = async (s: Settlement) => {
    setViewOrdersSettlement(s); setSettlementOrders([]); setOrdersLoading(true)
    try { const data = await fetchOrders({ vendor_id: s.vendorId, date_from: s.periodStart, date_to: s.periodEnd, per_page: 500 }); setSettlementOrders(data.orders) } catch {}
    setOrdersLoading(false)
  }
  const handleSaveVendor = async () => {
    if (!selectedVendor) return
    await updateVendor(selectedVendor, { custom_commission_percent: editCommission ? parseFloat(editCommission) : undefined, notes: editNotes })
    setEditingVendor(false); load()
  }
  const selectVendor = (vid: string) => {
    setSelectedVendor(vid); setView('status'); setEditingVendor(false)
    const v = vendorSummaries.find(x => x.vendorId === vid)
    if (v?.clearedTill) { const next = new Date(v.clearedTill); next.setDate(next.getDate() + 1); setDateStart(next.toISOString().split('T')[0]) }
    else { const d = new Date(); d.setDate(d.getDate() - 30); setDateStart(d.toISOString().split('T')[0]) }
    setDateEnd(new Date().toISOString().split('T')[0])
  }

  if (loading) return <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-line border-t-accent rounded-full animate-spin" /></div>

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold text-ink">Settlements</h1>
        <p className="text-sm text-ink-tertiary mt-0.5">Track payments and outstanding balances</p>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatBlock label="Outstanding" value={fmt(totalRemaining)} sub={`${vendorSummaries.filter(v => v.remainingOrders > 0).length} vendors`} color="amber" />
        <StatBlock label="Pending" value={String(totalPendingCount)} sub="Awaiting payment" color="orange" />
        <StatBlock label="Cleared" value={fmt(totalHistorical)} sub={`${settlements.filter(s => s.status === 'settled').length} settlements`} color="green" />
        <StatBlock label="Unrealized Earnings" value={fmt(totalRemainingEarnings)} sub="From outstanding" color="accent" />
      </div>

      <div className="flex gap-6">
        {/* Vendor list */}
        <div className="w-72 flex-shrink-0">
          <div className="qv-card overflow-hidden">
            <div className="p-4 border-b border-line">
              <h2 className="text-sm font-medium text-ink-secondary">Vendors</h2>
            </div>
            <div className="max-h-[68vh] overflow-auto">
              {vendorSummaries.map(v => {
                const active = selectedVendor === v.vendorId
                return (
                  <div key={v.vendorId} onClick={() => selectVendor(v.vendorId)}
                    className={`p-3.5 cursor-pointer transition-colors border-b border-line ${active ? 'bg-accent-soft' : 'hover:bg-inset'}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-xs font-semibold flex-shrink-0 ${active ? 'bg-accent text-white' : 'bg-inset text-ink-tertiary'}`}>
                        {v.vendorLogoUrl ? <img src={v.vendorLogoUrl} className="w-9 h-9 rounded-lg object-cover" alt="" /> : v.vendorName.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm truncate ${active ? 'text-accent font-medium' : 'text-ink'}`}>{v.vendorName}</p>
                        <p className="text-2xs text-ink-tertiary mt-0.5">
                          {v.clearedTill ? `Cleared ${v.clearedTill}` : 'Never settled'}
                        </p>
                      </div>
                      {v.remainingOrders > 0 && (
                        <div className="text-right flex-shrink-0">
                          <p className="text-2xs font-semibold text-amber-600 dark:text-amber-400">{fmt(v.remainingPayable)}</p>
                          <p className="text-2xs text-ink-faint">{v.remainingOrders} orders</p>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        {/* Main */}
        <div className="flex-1 space-y-4">
          {sv ? (
            <>
              {/* Header */}
              <div className="qv-card p-5">
                <div className="flex justify-between items-start">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{sv.vendorName}</h2>
                    <p className="text-sm text-ink-tertiary mt-0.5">
                      {sv.vendorPhone} · Commission: {sv.commissionPercent}%
                      {sv.customCommission !== null && <span className="text-accent ml-1">(custom)</span>}
                    </p>
                  </div>
                  <button onClick={() => { setEditingVendor(!editingVendor); setEditCommission(sv.customCommission?.toString() || ''); setEditNotes(sv.notes || '') }}
                    className="qv-btn-ghost text-xs">{editingVendor ? 'Cancel' : 'Edit'}</button>
                </div>
                {editingVendor && (
                  <div className="mt-4 pt-4 border-t border-line flex gap-3 items-end">
                    <div className="flex-1"><label className="block qv-label mb-1.5">Commission %</label><input type="number" step="0.5" value={editCommission} onChange={e => setEditCommission(e.target.value)} placeholder="Default 10" className="qv-input w-full" /></div>
                    <div className="flex-1"><label className="block qv-label mb-1.5">Notes</label><input value={editNotes} onChange={e => setEditNotes(e.target.value)} className="qv-input w-full" /></div>
                    <button onClick={handleSaveVendor} className="qv-btn text-xs">Save</button>
                  </div>
                )}
              </div>

              {/* Outstanding */}
              <div className={`qv-card p-5 ${sv.remainingOrders > 0 ? 'border-amber-200 dark:border-amber-500/20' : 'border-green-200 dark:border-green-500/20'}`}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${sv.remainingOrders > 0 ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
                    <h3 className="text-sm font-medium text-ink">{sv.remainingOrders > 0 ? 'Outstanding Balance' : 'All Cleared'}</h3>
                  </div>
                  {sv.clearedTill && <span className="qv-badge bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400">Cleared till {sv.clearedTill}</span>}
                </div>
                {sv.remainingOrders > 0 ? (
                  <>
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      <MiniStat label="Orders" value={String(sv.remainingOrders)} />
                      <MiniStat label="Food Value" value={fmt(sv.remainingFoodValue)} />
                      <MiniStat label="Pay Vendor" value={fmt(sv.remainingPayable)} highlight="amber" />
                      <MiniStat label="Our Cut" value={fmt(sv.remainingEarnings)} highlight="green" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setView('create')} className="qv-btn text-xs">+ Create Settlement</button>
                      <button onClick={() => handleViewOrders({ vendorId: sv.vendorId, periodStart: sv.clearedTill ? (() => { const d = new Date(sv.clearedTill); d.setDate(d.getDate() + 1); return d.toISOString().split('T')[0] })() : (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().split('T')[0] })(), periodEnd: new Date().toISOString().split('T')[0] } as Settlement)} className="qv-btn-secondary text-xs">View Orders</button>
                      {historyList.length > 0 && <button onClick={() => setView(view === 'history' ? 'status' : 'history')} className="qv-btn-ghost text-xs">{view === 'history' ? 'Hide' : `History (${historyList.length})`}</button>}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-ink-secondary">No unsettled orders.</p>
                    {historyList.length > 0 && <button onClick={() => setView(view === 'history' ? 'status' : 'history')} className="text-sm text-accent hover:underline">{view === 'history' ? 'Hide' : `History (${historyList.length})`}</button>}
                  </div>
                )}
              </div>

              {/* Create Form */}
              {view === 'create' && (
                <div className="qv-card p-5">
                  <div className="flex justify-between mb-4"><h3 className="text-sm font-medium text-ink">Create Settlement</h3><button onClick={() => setView('status')} className="text-ink-tertiary hover:text-ink">&times;</button></div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <Inp label="Period Start" type="date" value={dateStart} onChange={setDateStart} />
                    <Inp label="Period End" type="date" value={dateEnd} onChange={setDateEnd} />
                    <Inp label="Adjustments (Rs)" type="number" value={adjustments} onChange={setAdjustments} placeholder="Negative for deductions" />
                    <Inp label="Reason" value={adjustReason} onChange={setAdjustReason} placeholder="e.g. packaging" />
                  </div>
                  <Inp label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
                  {calcError && <p className="text-sm text-red-600 dark:text-red-400 mt-3 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-lg">{calcError}</p>}
                  <button onClick={handleCalculate} className="w-full mt-4 qv-btn">Calculate & Create</button>
                </div>
              )}

              {/* Pending */}
              {pendingList.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-ink-secondary mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" /> Pending ({pendingList.length})
                  </h3>
                  <div className="space-y-3">{pendingList.map(s => <SettlementCard key={s.id} s={s} isPending onSettle={() => handleSettle(s.id)} onDelete={() => handleDelete(s.id)} onViewOrders={() => handleViewOrders(s)} />)}</div>
                </div>
              )}

              {/* History */}
              {view === 'history' && historyList.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-ink-secondary mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500" /> History ({historyList.length})
                  </h3>
                  <div className="space-y-3">{historyList.map(s => <SettlementCard key={s.id} s={s} isPending={false} onDelete={() => handleDelete(s.id)} onViewOrders={() => handleViewOrders(s)} />)}</div>
                </div>
              )}
            </>
          ) : (
            <div className="qv-card p-16 text-center">
              <p className="text-ink-secondary">Select a vendor to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* Orders Modal */}
      {viewOrdersSettlement && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setViewOrdersSettlement(null)}>
          <div className="qv-card w-full max-w-5xl max-h-[85vh] overflow-hidden flex flex-col" style={{ boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center p-5 border-b border-line flex-shrink-0">
              <div>
                <h2 className="text-base font-semibold text-ink">{viewOrdersSettlement.periodStart} → {viewOrdersSettlement.periodEnd}</h2>
                <p className="text-sm text-ink-tertiary">{vendorSummaries.find(v => v.vendorId === viewOrdersSettlement.vendorId)?.vendorName} · {settlementOrders.length} orders</p>
              </div>
              <button onClick={() => setViewOrdersSettlement(null)} className="text-ink-tertiary hover:text-ink text-lg">&times;</button>
            </div>
            {!ordersLoading && settlementOrders.length > 0 && (
              <div className="flex gap-1.5 px-5 py-3 border-b border-line flex-shrink-0 flex-wrap">
                {(() => {
                  const counts: Record<string, number> = {}; settlementOrders.forEach(o => { counts[o.state] = (counts[o.state] || 0) + 1 })
                  return Object.entries(counts).map(([status, count]) => (
                    <span key={status} className={`qv-badge ${STATUS_BADGE[status] || 'bg-inset text-ink-secondary'}`}>{status}: {count}</span>
                  ))
                })()}
                <span className="qv-badge bg-inset text-ink font-medium">GMV: {fmt(settlementOrders.reduce((s, o) => s + o.totalAmount, 0))}</span>
              </div>
            )}
            <div className="overflow-auto flex-1">
              {ordersLoading ? <div className="p-12 text-center text-ink-tertiary">Loading...</div>
              : settlementOrders.length === 0 ? <div className="p-12 text-center text-ink-tertiary">No orders found</div>
              : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-raised"><tr className="border-b border-line">
                    {['Order ID','Customer','Items','Amount','Del. Fee','Payment','Status','Date'].map(h => (
                      <th key={h} className={`p-3 qv-label ${h === 'Amount' || h === 'Del. Fee' ? 'text-right' : h === 'Payment' || h === 'Status' ? 'text-center' : 'text-left'}`}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>{settlementOrders.map(o => (
                    <tr key={o.orderId} className="border-b border-line hover:bg-accent-soft transition-colors">
                      <td className="p-3 font-mono text-xs text-ink-secondary">{o.orderId.slice(-8)}</td>
                      <td className="p-3"><p className="font-medium text-ink">{o.customerName}</p><p className="text-2xs text-ink-tertiary">{o.customerMobile}</p></td>
                      <td className="p-3 text-ink-secondary text-xs max-w-[180px] truncate">{o.orderDescription || `${o.totalItemCount} items`}</td>
                      <td className="p-3 text-right font-mono text-ink">{fmt(o.totalAmount)}</td>
                      <td className="p-3 text-right font-mono text-ink-secondary">{fmt(o.deliveryFee)}</td>
                      <td className="p-3 text-center"><span className={`qv-badge ${o.paymentMethod === 'COD' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-purple-50 text-purple-700 dark:bg-purple-500/10 dark:text-purple-400'}`}>{o.paymentMethod === 'COD' ? 'Cash' : 'Prepaid'}</span></td>
                      <td className="p-3 text-center"><span className={`qv-badge ${STATUS_BADGE[o.state] || 'bg-inset text-ink-secondary'}`}>{o.state}</span></td>
                      <td className="p-3 text-xs text-ink-secondary">{o.creationTime ? new Date(o.creationTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* Sub-components */
function StatBlock({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colors: Record<string, string> = {
    amber: 'border-amber-200 dark:border-amber-500/20', orange: 'border-orange-200 dark:border-orange-500/20',
    green: 'border-green-200 dark:border-green-500/20', accent: 'border-accent/20',
  }
  return (
    <div className={`qv-card p-5 ${colors[color] || ''}`}>
      <p className="qv-label">{label}</p>
      <p className="text-xl font-semibold text-ink mt-2 font-mono">{value}</p>
      <p className="text-2xs text-ink-tertiary mt-1">{sub}</p>
    </div>
  )
}

function MiniStat({ label, value, highlight }: { label: string; value: string; highlight?: string }) {
  const cls = highlight === 'amber' ? 'text-amber-700 dark:text-amber-400' : highlight === 'green' ? 'text-green-700 dark:text-green-400' : 'text-ink'
  return (
    <div className="bg-inset rounded-lg p-3 border border-line">
      <p className="qv-label">{label}</p>
      <p className={`text-base font-semibold mt-1 font-mono ${cls}`}>{value}</p>
    </div>
  )
}

function Inp({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return <div><label className="block qv-label mb-1.5">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="qv-input w-full" /></div>
}

function SettlementCard({ s, isPending, onSettle, onDelete, onViewOrders }: { s: Settlement; isPending: boolean; onSettle?: () => void; onDelete?: () => void; onViewOrders?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className={`qv-card overflow-hidden ${isPending ? 'border-amber-200 dark:border-amber-500/20' : ''}`}>
      <div className="p-4 cursor-pointer flex items-center justify-between" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3 flex-1">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isPending ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
          <div className="flex-1">
            <p className="text-sm font-medium text-ink">{s.periodStart} → {s.periodEnd}</p>
            <p className="text-2xs text-ink-tertiary mt-0.5">{s.totalOrders} orders · GMV {fmt(s.totalGmv)}</p>
          </div>
          <div className="flex items-center gap-6 flex-shrink-0">
            <div className="text-right"><p className="qv-label">Vendor Pay</p><p className={`text-base font-semibold font-mono ${isPending ? 'text-amber-700 dark:text-amber-400' : 'text-ink'}`}>{fmt(s.netPayable)}</p></div>
            <div className="text-right"><p className="qv-label">Our Cut</p><p className="text-base font-semibold font-mono text-green-700 dark:text-green-400">{fmt(s.ourEarnings)}</p></div>
          </div>
        </div>
        <svg className={`w-4 h-4 text-ink-faint ml-3 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </div>
      {expanded && (
        <div className="border-t border-line bg-inset p-5">
          <div className="qv-card divide-y divide-line mb-4">
            <Row label="Food Value" value={fmt(s.foodValue)} />
            <Row label="Commission" value={`- ${fmt(s.commission)}`} color="red" />
            <Row label="Delivery Fees" value={`+ ${fmt(s.deliveryFees)}`} color="green" />
            {s.platformFees > 0 && <Row label="Platform Fees" value={`+ ${fmt(s.platformFees)}`} color="green" />}
            {s.adjustments !== 0 && <Row label={`Adjustments${s.adjustmentReason ? ` (${s.adjustmentReason})` : ''}`} value={`${s.adjustments > 0 ? '+' : ''} ${fmt(s.adjustments)}`} color={s.adjustments > 0 ? 'green' : 'red'} />}
            <div className="flex justify-between px-4 py-3 bg-inset"><span className="text-sm font-semibold text-ink">Net Payable</span><span className="text-lg font-bold text-ink font-mono">{fmt(s.netPayable)}</span></div>
            <div className="flex justify-between px-4 py-3 bg-green-50/50 dark:bg-green-500/5"><span className="text-sm font-semibold text-green-800 dark:text-green-400">Our Earnings</span><span className="text-lg font-bold text-green-700 dark:text-green-400 font-mono">{fmt(s.ourEarnings)}</span></div>
          </div>
          <div className="flex items-center justify-between">
            <div className="text-2xs text-ink-tertiary">
              {s.notes && <p>Notes: {s.notes}</p>}
              {s.settledAt && <p>Settled {new Date(s.settledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} by {s.settledBy}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={e => { e.stopPropagation(); onViewOrders?.() }} className="qv-btn-ghost text-xs">Orders</button>
              <button onClick={e => { e.stopPropagation(); onDelete?.() }} className="text-red-500 hover:text-red-600 text-xs px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors">Delete</button>
              {isPending && <button onClick={e => { e.stopPropagation(); onSettle?.() }} className="qv-btn text-xs">Mark Settled</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: string; color?: string }) {
  const c = color === 'red' ? 'text-red-600 dark:text-red-400' : color === 'green' ? 'text-green-600 dark:text-green-400' : 'text-ink'
  return <div className="flex justify-between px-4 py-2.5"><span className="text-sm text-ink-secondary">{label}</span><span className={`text-sm font-medium font-mono ${c}`}>{value}</span></div>
}
