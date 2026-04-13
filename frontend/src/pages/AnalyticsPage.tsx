import { useEffect, useState, useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, ComposedChart, Line,
} from 'recharts'
import {
  fetchAnalyticsSummary, fetchDailyOrders, fetchPeakHours,
  fetchVendorRanking, fetchPaymentSplit, fetchVendorSummary,
  fetchDeliveryPersons, fetchOrders,
} from '../lib/api'
import type {
  AnalyticsSummary, DailyOrder, HourData, VendorRank, PaymentSplit,
  DeliveryPerson,
} from '../lib/types'

/* ── Helpers ── */
const fmt = (n: number) => `Rs ${n.toLocaleString('en-IN', { minimumFractionDigits: 0 })}`
const vehicleLabels: Record<string, string> = { bike: 'Bike', cycle: 'Cycle', walk: 'Walk', ev: 'EV' }
const pct = (a: number, b: number) => b === 0 ? '0' : ((a / b) * 100).toFixed(1)
const delta = (curr: number, prev: number) => {
  if (prev === 0) return curr > 0 ? '+100%' : '—'
  const d = ((curr - prev) / prev) * 100
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`
}

/* ── Period range selector ── */
const RANGES = [
  { key: '7', label: '7 days' },
  { key: '14', label: '14 days' },
  { key: '30', label: '30 days' },
  { key: '60', label: '60 days' },
  { key: '90', label: '90 days' },
]

interface VendorSummaryItem {
  vendorId: string; vendorName: string
  remainingPayable: number; remainingEarnings: number
  remainingOrders: number; pendingSettlements: number
  totalHistoricallySettled: number; commissionPercent: number
}

interface OrderStatusCounts {
  total: number; completed: number; cancelled: number; rejected: number
  pending: number; accepted: number; shipped: number; packed: number
}

export default function AnalyticsPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [daily, setDaily] = useState<DailyOrder[]>([])
  const [hours, setHours] = useState<HourData[]>([])
  const [ranking, setRanking] = useState<VendorRank[]>([])
  const [payment, setPayment] = useState<PaymentSplit | null>(null)
  const [vendorSummaries, setVendorSummaries] = useState<VendorSummaryItem[]>([])
  const [deliveryPersons, setDeliveryPersons] = useState<DeliveryPerson[]>([])
  const [statusCounts, setStatusCounts] = useState<OrderStatusCounts | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState('30')

  const load = async (d: string) => {
    setLoading(true)
    try {
      const [sumData, dailyData, hourData, rankData, payData, vsData, dpData] = await Promise.all([
        fetchAnalyticsSummary(),
        fetchDailyOrders(parseInt(d)),
        fetchPeakHours(),
        fetchVendorRanking(),
        fetchPaymentSplit(),
        fetchVendorSummary().catch(() => []),
        fetchDeliveryPersons().catch(() => []),
      ])
      setSummary(sumData)
      setDaily(dailyData)
      setHours(hourData)
      setRanking(rankData)
      setPayment(payData)
      setVendorSummaries(vsData)
      setDeliveryPersons(dpData)

      // Fetch status breakdown from orders (all time)
      try {
        const allOrders = await fetchOrders({ per_page: 1 })
        const total = allOrders.total
        const [comp, canc, rej] = await Promise.all([
          fetchOrders({ status: 'COMPLETED', per_page: 1 }).then(r => r.total).catch(() => 0),
          fetchOrders({ status: 'CANCELLED', per_page: 1 }).then(r => r.total).catch(() => 0),
          fetchOrders({ status: 'REJECTED', per_page: 1 }).then(r => r.total).catch(() => 0),
        ])
        setStatusCounts({
          total, completed: comp, cancelled: canc, rejected: rej,
          pending: 0, accepted: 0, shipped: 0, packed: 0,
        })
      } catch {}
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load(days) }, [])

  const handleRangeChange = (d: string) => {
    setDays(d)
    fetchDailyOrders(parseInt(d)).then(setDaily).catch(() => {})
  }

  /* ── Computed metrics ── */
  const activeDps = deliveryPersons.filter(p => p.active)
  const totalOutstanding = vendorSummaries.reduce((a, v) => a + v.remainingPayable, 0)
  const totalEarnings = vendorSummaries.reduce((a, v) => a + v.remainingEarnings, 0)

  // Daily trend with GMV + rolling average
  const dailyWithAvg = useMemo(() => {
    return daily.map((d, i) => {
      const slice = daily.slice(Math.max(0, i - 6), i + 1)
      const avg = slice.reduce((s, x) => s + x.orders, 0) / slice.length
      return { ...d, avg: Math.round(avg * 10) / 10 }
    })
  }, [daily])

  // Week-over-week comparison
  const wow = useMemo(() => {
    if (daily.length < 14) return null
    const thisWeek = daily.slice(-7)
    const lastWeek = daily.slice(-14, -7)
    const tw = thisWeek.reduce((s, d) => s + d.orders, 0)
    const lw = lastWeek.reduce((s, d) => s + d.orders, 0)
    const twGmv = thisWeek.reduce((s, d) => s + d.gmv, 0)
    const lwGmv = lastWeek.reduce((s, d) => s + d.gmv, 0)
    return { orders: { curr: tw, prev: lw }, gmv: { curr: twGmv, prev: lwGmv } }
  }, [daily])

  // Peak day
  const peakDay = useMemo(() => {
    if (daily.length === 0) return null
    return daily.reduce((best, d) => d.orders > best.orders ? d : best, daily[0])
  }, [daily])

  // Fulfillment rate
  const fulfillmentRate = statusCounts
    ? pct(statusCounts.completed, statusCounts.total)
    : null

  // Cancellation rate
  const cancelRate = statusCounts
    ? pct(statusCounts.cancelled + statusCounts.rejected, statusCounts.total)
    : null

  // Delivery fleet utilization
  const fleetUtil = useMemo(() => {
    if (activeDps.length === 0) return null
    const totalDel = activeDps.reduce((s, p) => s + p.todayDeliveries, 0)
    const avgTime = activeDps.filter(p => p.avgDeliveryTimeMinutes).reduce((s, p) => s + (p.avgDeliveryTimeMinutes || 0), 0) / (activeDps.filter(p => p.avgDeliveryTimeMinutes).length || 1)
    const totalCost = activeDps.reduce((s, p) => s + p.todayCostPaise, 0) / 100
    const totalRevenue = activeDps.reduce((s, p) => s + p.todayStats.deliveryFeesPaise, 0) / 100
    return { totalDel, avgTime: Math.round(avgTime), totalCost, totalRevenue, count: activeDps.length }
  }, [activeDps])

  // Chart theming
  const isDark = document.documentElement.classList.contains('dark')
  const gridStroke = isDark ? '#2a2a2a' : '#f0f0f0'
  const tickFill = isDark ? '#6e6e73' : '#aeaeb2'
  const tooltipStyle = { background: isDark ? '#1a1a1a' : '#fff', border: `1px solid ${isDark ? '#2a2a2a' : '#e5e5ea'}`, borderRadius: 8, fontSize: 12 }
  const accentColor = isDark ? '#0a84ff' : '#007aff'
  const greenColor = isDark ? '#30d158' : '#34c759'
  const purpleColor = isDark ? '#bf5af2' : '#af52de'
  const orangeColor = isDark ? '#ff9f0a' : '#ff9500'
  const pieColors = [accentColor, purpleColor, greenColor, orangeColor]

  if (loading) return <div className="p-6 text-ink-tertiary">Loading analytics...</div>
  if (!summary) return <div className="p-6 text-ink-tertiary">No data. Sync orders first.</div>

  const s = summary

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      {/* Header + Range selector */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Analytics</h1>
          <p className="text-sm text-ink-tertiary mt-0.5">Performance overview and business intelligence</p>
        </div>
        <div className="flex gap-1 bg-inset rounded-lg p-0.5 border border-line">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => handleRangeChange(r.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                days === r.key ? 'bg-raised text-ink shadow-sm' : 'text-ink-secondary hover:text-ink'
              }`}
            >{r.label}</button>
          ))}
        </div>
      </div>

      {/* ── ROW 1: Headline KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KPI
          label="Monthly GMV"
          value={fmt(s.month.totalGmv)}
          sub={`${s.month.totalOrders} orders`}
          trend={wow ? delta(wow.gmv.curr, wow.gmv.prev) : undefined}
          trendUp={wow ? wow.gmv.curr >= wow.gmv.prev : undefined}
        />
        <KPI
          label="Revenue"
          value={fmt(s.month.ourRevenue)}
          sub={`${pct(s.month.ourRevenue, s.month.totalGmv)}% margin`}
        />
        <KPI
          label="Avg Order Value"
          value={fmt(s.month.avgOrderValue)}
          sub={`${s.month.completedOrders} completed`}
        />
        <KPI
          label="Fulfillment Rate"
          value={fulfillmentRate ? `${fulfillmentRate}%` : '—'}
          sub={cancelRate ? `${cancelRate}% cancelled/rejected` : ''}
          trendUp={fulfillmentRate ? parseFloat(fulfillmentRate) >= 80 : undefined}
        />
        <KPI
          label="Avg Delivery Time"
          value={s.month.avgDeliveryTime ? `${s.month.avgDeliveryTime} min` : '—'}
          sub={fleetUtil ? `${fleetUtil.count} riders active` : ''}
        />
      </div>

      {/* ── ROW 2: Today vs This Week comparison ── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-3">Today</h3>
          <div className="grid grid-cols-4 gap-3">
            <MiniKPI label="Orders" value={s.today.totalOrders} />
            <MiniKPI label="GMV" value={fmt(s.today.totalGmv)} mono />
            <MiniKPI label="Revenue" value={fmt(s.today.ourRevenue)} mono />
            <MiniKPI label="Completed" value={s.today.completedOrders} />
          </div>
        </div>
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-3">This Week</h3>
          <div className="grid grid-cols-4 gap-3">
            <MiniKPI label="Orders" value={s.week.totalOrders} />
            <MiniKPI label="GMV" value={fmt(s.week.totalGmv)} mono />
            <MiniKPI label="Revenue" value={fmt(s.week.ourRevenue)} mono />
            <MiniKPI label="Avg Del." value={s.week.avgDeliveryTime ? `${s.week.avgDeliveryTime}m` : '—'} />
          </div>
        </div>
      </div>

      {/* ── ROW 3: Order volume trend + GMV trend ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 qv-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-ink-secondary">Order Volume & Trend</h3>
            {peakDay && <span className="text-2xs text-ink-tertiary">Peak: {peakDay.date.slice(5)} ({peakDay.orders} orders)</span>}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={dailyWithAvg}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickFill }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10, fill: tickFill }} />
              <Tooltip contentStyle={tooltipStyle}
                formatter={(v: number, name: string) => [name === 'avg' ? v.toFixed(1) : v, name === 'avg' ? '7-day avg' : 'Orders']}
                labelFormatter={l => `Date: ${l}`} />
              <Bar dataKey="orders" fill={accentColor} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
              <Line dataKey="avg" stroke={orangeColor} strokeWidth={2} dot={false} name="avg" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* GMV trend (area chart) */}
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">GMV Trend</h3>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: tickFill }} tickFormatter={d => d.slice(8)} />
              <YAxis tick={{ fontSize: 10, fill: tickFill }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [fmt(v), 'GMV']} labelFormatter={l => l} />
              <defs>
                <linearGradient id="gmvGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={greenColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={greenColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="gmv" stroke={greenColor} fill="url(#gmvGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── ROW 4: Revenue breakdown + Payment split + Peak hours ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Revenue breakdown */}
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">Revenue Breakdown (Month)</h3>
          <div className="space-y-3">
            <RevenueBar label="Commission" value={s.month.commission} total={s.month.ourRevenue} color="bg-blue-500 dark:bg-blue-400" />
            <RevenueBar label="Delivery Fees" value={s.month.deliveryFees} total={s.month.ourRevenue} color="bg-green-500 dark:bg-green-400" />
          </div>
          <div className="mt-4 pt-4 border-t border-line">
            <div className="flex justify-between items-baseline">
              <span className="text-sm text-ink-secondary">Total Revenue</span>
              <span className="text-xl font-semibold text-ink font-mono">{fmt(s.month.ourRevenue)}</span>
            </div>
            <div className="flex justify-between items-baseline mt-1">
              <span className="text-2xs text-ink-tertiary">vs GMV</span>
              <span className="text-sm text-ink-tertiary font-mono">{fmt(s.month.totalGmv)}</span>
            </div>
          </div>
          {/* Outstanding */}
          {totalOutstanding > 0 && (
            <div className="mt-3 pt-3 border-t border-line">
              <div className="flex justify-between">
                <span className="text-2xs text-amber-600 dark:text-amber-400">Outstanding to vendors</span>
                <span className="text-sm font-medium text-amber-600 dark:text-amber-400 font-mono">{fmt(totalOutstanding)}</span>
              </div>
              <div className="flex justify-between mt-0.5">
                <span className="text-2xs text-green-600 dark:text-green-400">Unrealized earnings</span>
                <span className="text-sm font-medium text-green-600 dark:text-green-400 font-mono">{fmt(totalEarnings)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Payment split */}
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">Payment Methods</h3>
          {payment && payment.total.count > 0 && (
            <>
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie data={[
                    { name: 'Cash', value: payment.cash.count },
                    { name: 'Prepaid', value: payment.prepaid.count },
                  ]} cx="50%" cy="50%" outerRadius={70} innerRadius={40} dataKey="value" strokeWidth={0} paddingAngle={3}>
                    {[0, 1].map(i => <Cell key={i} fill={pieColors[i]} fillOpacity={0.85} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div className="bg-inset rounded-lg p-3 border border-line">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: pieColors[0] }} />
                    <span className="text-2xs text-ink-tertiary">Cash (COD)</span>
                  </div>
                  <p className="text-base font-semibold text-ink font-mono">{fmt(payment.cash.amount)}</p>
                  <p className="text-2xs text-ink-tertiary">{payment.cash.count} orders · {pct(payment.cash.count, payment.total.count)}%</p>
                </div>
                <div className="bg-inset rounded-lg p-3 border border-line">
                  <div className="flex items-center gap-1.5 mb-1">
                    <div className="w-2 h-2 rounded-full" style={{ background: pieColors[1] }} />
                    <span className="text-2xs text-ink-tertiary">Prepaid</span>
                  </div>
                  <p className="text-base font-semibold text-ink font-mono">{fmt(payment.prepaid.amount)}</p>
                  <p className="text-2xs text-ink-tertiary">{payment.prepaid.count} orders · {pct(payment.prepaid.count, payment.total.count)}%</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Peak hours */}
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">Order Heatmap (by hour)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hours.filter(h => h.orders > 0)}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="hour" tick={{ fontSize: 10, fill: tickFill }} tickFormatter={h => `${h}h`} />
              <YAxis tick={{ fontSize: 10, fill: tickFill }} />
              <Tooltip contentStyle={tooltipStyle} formatter={(v: number) => [v, 'Orders']} labelFormatter={h => `${h}:00 – ${Number(h)+1}:00`} />
              <Bar dataKey="orders" fill={purpleColor} radius={[3, 3, 0, 0]} fillOpacity={0.8} />
            </BarChart>
          </ResponsiveContainer>
          {hours.length > 0 && (() => {
            const peak = hours.reduce((b, h) => h.orders > b.orders ? h : b, hours[0])
            const total = hours.reduce((s, h) => s + h.orders, 0)
            return (
              <div className="mt-3 pt-3 border-t border-line flex justify-between text-2xs text-ink-tertiary">
                <span>Peak: {peak.hour}:00–{peak.hour + 1}:00 ({peak.orders} orders)</span>
                <span>Total: {total}</span>
              </div>
            )
          })()}
        </div>
      </div>

      {/* ── ROW 5: Vendor leaderboard + Fleet overview ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Vendor table */}
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">Vendor Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className="text-left pb-2 qv-label">#</th>
                  <th className="text-left pb-2 qv-label">Vendor</th>
                  <th className="text-right pb-2 qv-label">Orders</th>
                  <th className="text-right pb-2 qv-label">GMV</th>
                  <th className="text-right pb-2 qv-label">AOV</th>
                  <th className="text-right pb-2 qv-label">Share</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((v, i) => {
                  const totalOrders = ranking.reduce((s, x) => s + x.totalOrders, 0)
                  const share = pct(v.totalOrders, totalOrders)
                  return (
                    <tr key={v.vendorId} className="border-b border-line last:border-0">
                      <td className="py-2.5 text-ink-tertiary">{i + 1}</td>
                      <td className="py-2.5 text-ink font-medium">{v.vendorName}</td>
                      <td className="py-2.5 text-right font-mono text-ink-secondary">{v.totalOrders}</td>
                      <td className="py-2.5 text-right font-mono text-ink">{fmt(v.totalGmv)}</td>
                      <td className="py-2.5 text-right font-mono text-ink-secondary">{fmt(v.avgOrderValue)}</td>
                      <td className="py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-12 h-1.5 bg-line rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${share}%`, background: accentColor }} />
                          </div>
                          <span className="text-2xs text-ink-tertiary w-8 text-right">{share}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Fleet / Delivery overview */}
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">Delivery Fleet (Today)</h3>
          {fleetUtil && fleetUtil.count > 0 ? (
            <>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-inset rounded-lg p-3 text-center border border-line">
                  <p className="qv-label">Deliveries</p>
                  <p className="text-2xl font-semibold text-ink font-mono mt-1">{fleetUtil.totalDel}</p>
                  <p className="text-2xs text-ink-tertiary">{(fleetUtil.totalDel / fleetUtil.count).toFixed(1)} per rider</p>
                </div>
                <div className="bg-inset rounded-lg p-3 text-center border border-line">
                  <p className="qv-label">Avg Time</p>
                  <p className="text-2xl font-semibold text-ink font-mono mt-1">{fleetUtil.avgTime}m</p>
                  <p className="text-2xs text-ink-tertiary">{fleetUtil.count} riders</p>
                </div>
                <div className={`bg-inset rounded-lg p-3 text-center border ${fleetUtil.totalRevenue >= fleetUtil.totalCost ? 'border-green-200 dark:border-green-500/20' : 'border-red-200 dark:border-red-500/20'}`}>
                  <p className="qv-label">Net P&L</p>
                  <p className={`text-2xl font-semibold font-mono mt-1 ${fleetUtil.totalRevenue >= fleetUtil.totalCost ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {fmt(fleetUtil.totalRevenue - fleetUtil.totalCost)}
                  </p>
                  <p className="text-2xs text-ink-tertiary">Rev {fmt(fleetUtil.totalRevenue)} · Cost {fmt(fleetUtil.totalCost)}</p>
                </div>
              </div>

              {/* Top riders today */}
              <h4 className="text-2xs text-ink-tertiary uppercase tracking-wider mb-2 mt-4">Top Riders Today</h4>
              <div className="space-y-1.5">
                {activeDps
                  .sort((a, b) => b.todayDeliveries - a.todayDeliveries)
                  .slice(0, 5)
                  .map((dp, i) => (
                    <div key={dp.id} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-2xs text-ink-faint w-4">{i + 1}</span>
                        <span className="text-sm text-ink">{dp.name}</span>
                        <span className="text-2xs text-ink-faint">{vehicleLabels[dp.vehicleType]}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-mono font-medium text-ink">{dp.todayDeliveries}</span>
                        {dp.avgDeliveryTimeMinutes && (
                          <span className={`text-2xs ${dp.avgDeliveryTimeMinutes <= 25 ? 'text-green-600 dark:text-green-400' : dp.avgDeliveryTimeMinutes <= 40 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                            {dp.avgDeliveryTimeMinutes}m
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                }
              </div>
            </>
          ) : (
            <p className="text-ink-tertiary text-sm py-8 text-center">No active delivery persons</p>
          )}
        </div>
      </div>

      {/* ── ROW 6: Week-over-Week comparison cards ── */}
      {wow && (
        <div className="qv-card p-5">
          <h3 className="text-sm font-medium text-ink-secondary mb-4">Week-over-Week Comparison</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <WoWCard label="Orders" curr={wow.orders.curr} prev={wow.orders.prev} format={v => String(v)} />
            <WoWCard label="GMV" curr={wow.gmv.curr} prev={wow.gmv.prev} format={fmt} />
            <WoWCard label="Avg/Day (Orders)" curr={Math.round(wow.orders.curr / 7)} prev={Math.round(wow.orders.prev / 7)} format={v => String(v)} />
            <WoWCard label="Avg/Day (GMV)" curr={Math.round(wow.gmv.curr / 7)} prev={Math.round(wow.gmv.prev / 7)} format={fmt} />
          </div>
        </div>
      )}
    </div>
  )
}


/* ── Sub-components ── */

function KPI({ label, value, sub, trend, trendUp }: {
  label: string; value: string; sub?: string; trend?: string; trendUp?: boolean
}) {
  return (
    <div className="qv-card p-4">
      <p className="qv-label">{label}</p>
      <div className="flex items-baseline gap-2 mt-1.5">
        <p className="text-xl font-semibold text-ink font-mono">{value}</p>
        {trend && (
          <span className={`text-2xs font-medium ${trendUp ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
            {trend}
          </span>
        )}
      </div>
      {sub && <p className="text-2xs text-ink-tertiary mt-1">{sub}</p>}
    </div>
  )
}

function MiniKPI({ label, value, mono }: { label: string; value: string | number; mono?: boolean }) {
  return (
    <div className="text-center">
      <p className="text-2xs text-ink-tertiary">{label}</p>
      <p className={`text-base font-semibold text-ink mt-0.5 ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  )
}

function RevenueBar({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const w = total > 0 ? (value / total) * 100 : 0
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-ink-secondary">{label}</span>
        <span className="text-ink font-mono font-medium">{fmt(value)}</span>
      </div>
      <div className="w-full h-2 bg-line rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${w}%` }} />
      </div>
    </div>
  )
}

function WoWCard({ label, curr, prev, format }: { label: string; curr: number; prev: number; format: (v: number) => string }) {
  const d = prev === 0 ? (curr > 0 ? 100 : 0) : ((curr - prev) / prev) * 100
  const up = d >= 0
  return (
    <div className="bg-inset rounded-lg p-4 border border-line">
      <p className="qv-label mb-2">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-lg font-semibold text-ink font-mono">{format(curr)}</p>
        <span className={`text-2xs font-medium ${up ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
          {up ? '+' : ''}{d.toFixed(1)}%
        </span>
      </div>
      <p className="text-2xs text-ink-tertiary mt-1">vs prev week: {format(prev)}</p>
    </div>
  )
}
