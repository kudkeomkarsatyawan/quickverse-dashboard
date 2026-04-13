import { useEffect, useState } from 'react'
import {
  fetchDeliveryPersons, createDeliveryPerson, updateDeliveryPerson,
  deleteDeliveryPerson, reactivateDeliveryPerson, fetchDeliveryHistory,
  fetchDeliveryEarnings, fetchDeliveryLeaderboard, markAttendance,
  fetchAttendance, bulkMarkAttendance,
} from '../lib/api'
import type {
  DeliveryPerson, DeliveryHistoryOrder, LeaderboardEntry,
  AttendanceRecord, EarningsSummary, EarningsDaily,
} from '../lib/types'

type Tab = 'team' | 'leaderboard' | 'attendance'
type DetailTab = 'overview' | 'history' | 'earnings' | 'attendance'
const BREAKEVEN = 13
const vehicleLabels: Record<string, string> = { bike: 'Bike', cycle: 'Cycle', walk: 'Walk', ev: 'EV' }
function paise(p: number) { return (p / 100).toFixed(2) }

const attBadge = (s: string) => s === 'present' ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : s === 'half_day' ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'
const attLabel = (s: string) => s === 'present' ? 'Present' : s === 'half_day' ? 'Half Day' : 'Absent'

export default function DeliveryPage() {
  const [persons, setPersons] = useState<DeliveryPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('team')
  const [showInactive, setShowInactive] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', phone: '', vehicle_type: 'bike', salary_per_day: 0, per_delivery_bonus: 0, joining_date: '', emergency_contact: '', id_proof_number: '' })
  const [selectedPerson, setSelectedPerson] = useState<DeliveryPerson | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('overview')
  const [history, setHistory] = useState<DeliveryHistoryOrder[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [historyDateFrom, setHistoryDateFrom] = useState('')
  const [historyDateTo, setHistoryDateTo] = useState('')
  const [earnings, setEarnings] = useState<{ summary: EarningsSummary; daily: EarningsDaily[] } | null>(null)
  const [earningsFrom, setEarningsFrom] = useState('')
  const [earningsTo, setEarningsTo] = useState('')
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([])
  const [attendanceSummary, setAttendanceSummary] = useState<{ present: number; halfDay: number; absent: number; totalHoursWorked: number } | null>(null)
  const [attMonth, setAttMonth] = useState(new Date().toISOString().slice(0, 7))
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [lbPeriod, setLbPeriod] = useState('today')

  const load = async () => { setLoading(true); try { setPersons(await fetchDeliveryPersons()) } catch {} setLoading(false) }
  useEffect(() => { load() }, [])
  useEffect(() => { if (tab === 'leaderboard') fetchDeliveryLeaderboard(lbPeriod).then(d => setLeaderboard(d.leaderboard)).catch(() => {}) }, [tab, lbPeriod])

  const loadHistory = async (pid: number, page = 1) => {
    const p: Record<string, string | number> = { page, per_page: 15 }
    if (historyDateFrom) p.date_from = historyDateFrom; if (historyDateTo) p.date_to = historyDateTo
    try { const d = await fetchDeliveryHistory(pid, p); setHistory(d.orders); setHistoryTotal(d.total); setHistoryPage(page) } catch {}
  }
  const loadEarnings = async (pid: number) => { const p: Record<string, string> = {}; if (earningsFrom) p.date_from = earningsFrom; if (earningsTo) p.date_to = earningsTo; try { setEarnings(await fetchDeliveryEarnings(pid, p)) } catch {} }
  const loadAttendance = async (pid: number) => { try { const d = await fetchAttendance(pid, attMonth); setAttendanceRecords(d.records); setAttendanceSummary(d.summary) } catch {} }

  const openDetail = (dp: DeliveryPerson) => { setSelectedPerson(dp); setDetailTab('overview'); setHistory([]); setEarnings(null); setAttendanceRecords([]) }
  useEffect(() => { if (!selectedPerson) return; if (detailTab === 'history') loadHistory(selectedPerson.id); if (detailTab === 'earnings') loadEarnings(selectedPerson.id); if (detailTab === 'attendance') loadAttendance(selectedPerson.id) }, [detailTab, selectedPerson?.id])

  const resetForm = () => setForm({ name: '', phone: '', vehicle_type: 'bike', salary_per_day: 0, per_delivery_bonus: 0, joining_date: '', emergency_contact: '', id_proof_number: '' })
  const handleSave = async () => {
    if (!form.name.trim() || !form.phone.trim()) return
    try { if (editId) await updateDeliveryPerson(editId, { ...form, joining_date: form.joining_date || undefined, salary_per_day: +form.salary_per_day || 0, per_delivery_bonus: +form.per_delivery_bonus || 0 }); else await createDeliveryPerson({ ...form, joining_date: form.joining_date || undefined, salary_per_day: +form.salary_per_day || 0, per_delivery_bonus: +form.per_delivery_bonus || 0 }); setShowForm(false); setEditId(null); resetForm(); load() }
    catch (err: any) { alert(err?.response?.data?.detail || 'Failed to save.') }
  }
  const handleEdit = (dp: DeliveryPerson) => { setEditId(dp.id); setForm({ name: dp.name, phone: dp.phone, vehicle_type: dp.vehicleType, salary_per_day: dp.salaryPerDay, per_delivery_bonus: dp.perDeliveryBonus, joining_date: dp.joiningDate?.split('T')[0] || '', emergency_contact: dp.emergencyContact, id_proof_number: dp.idProofNumber }); setShowForm(true) }
  const handleDeactivate = async (id: number) => { if (!confirm('Deactivate?')) return; await deleteDeliveryPerson(id); load(); if (selectedPerson?.id === id) setSelectedPerson(null) }
  const handleReactivate = async (id: number) => { await reactivateDeliveryPerson(id); load() }
  const handleMarkAtt = async (pid: number, status: string) => { await markAttendance(pid, { status, login_time: new Date().toISOString() }); load() }
  const handleBulkAtt = async () => { await bulkMarkAttendance(); load() }
  const fmtDate = (d: string | null) => { if (!d) return '—'; return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true }) }

  const filtered = showInactive ? persons : persons.filter(p => p.active)
  const activeCount = persons.filter(p => p.active).length
  const totalDel = persons.filter(p => p.active).reduce((s, p) => s + p.todayDeliveries, 0)
  const totalCost = persons.filter(p => p.active).reduce((s, p) => s + p.todayCostPaise, 0)

  if (loading) return <div className="p-6 text-ink-tertiary">Loading...</div>

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold text-ink">Delivery Team</h1>
          <p className="text-sm text-ink-tertiary mt-0.5">{activeCount} active · {totalDel} deliveries today · Cost: Rs {paise(totalCost)}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleBulkAtt} className="qv-btn-secondary text-xs">Mark All Present</button>
          <button onClick={() => { setTab('team'); setShowForm(true); setEditId(null); resetForm() }} className="qv-btn text-xs">+ Add Person</button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-inset rounded-lg p-1 w-fit border border-line">
        {([['team', 'Team'], ['leaderboard', 'Leaderboard'], ['attendance', 'Attendance']] as [Tab, string][]).map(([t, l]) => (
          <button key={t} onClick={() => { setTab(t); setShowForm(false) }}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${tab === t ? 'bg-raised text-ink shadow-sm' : 'text-ink-secondary hover:text-ink'}`}
          >{l}</button>
        ))}
      </div>

      {/* TEAM */}
      {tab === 'team' && (
        <>
          {showForm && (
            <div className="qv-card p-5 mb-4">
              <h3 className="text-sm font-medium text-ink mb-4">{editId ? 'Edit' : 'Add'} Delivery Person</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <FI label="Name *" value={form.name} onChange={v => setForm({ ...form, name: v })} placeholder="Full name" />
                <FI label="Phone *" value={form.phone} onChange={v => setForm({ ...form, phone: v })} placeholder="+91..." />
                <div><label className="block qv-label mb-1.5">Vehicle</label><select value={form.vehicle_type} onChange={e => setForm({ ...form, vehicle_type: e.target.value })} className="qv-input w-full"><option value="bike">Bike</option><option value="cycle">Cycle</option><option value="ev">EV</option><option value="walk">Walk</option></select></div>
                <FI label="Joining" type="date" value={form.joining_date} onChange={v => setForm({ ...form, joining_date: v })} />
                <FI label="Daily Salary" type="number" value={String(form.salary_per_day)} onChange={v => setForm({ ...form, salary_per_day: +v })} />
                <FI label="Per Del. Bonus" type="number" value={String(form.per_delivery_bonus)} onChange={v => setForm({ ...form, per_delivery_bonus: +v })} />
                <FI label="Emergency" value={form.emergency_contact} onChange={v => setForm({ ...form, emergency_contact: v })} placeholder="Phone" />
                <FI label="ID Proof" value={form.id_proof_number} onChange={v => setForm({ ...form, id_proof_number: v })} placeholder="Aadhaar / DL" />
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={handleSave} className="qv-btn text-xs">Save</button>
                <button onClick={() => { setShowForm(false); setEditId(null) }} className="qv-btn-ghost text-xs">Cancel</button>
              </div>
            </div>
          )}

          <label className="flex items-center gap-1.5 text-sm text-ink-secondary mb-3 cursor-pointer">
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" /> Show inactive
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filtered.map(dp => (
              <div key={dp.id} className={`qv-card p-4 cursor-pointer hover:shadow-md transition-all ${!dp.active ? 'opacity-40' : ''}`} onClick={() => openDetail(dp)}>
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <h3 className="font-semibold text-ink">{dp.name}</h3>
                    <p className="text-2xs text-ink-tertiary mt-0.5">{dp.phone} · {vehicleLabels[dp.vehicleType] || dp.vehicleType}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`qv-badge ${dp.active ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : 'bg-inset text-ink-tertiary'}`}>{dp.active ? 'Active' : 'Inactive'}</span>
                    {dp.todayAttendance && <span className={`qv-badge ${attBadge(dp.todayAttendance)}`}>{attLabel(dp.todayAttendance)}</span>}
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-1.5 mb-3">
                  {[{ l: 'Today', v: dp.todayDeliveries, g: dp.todayDeliveries >= BREAKEVEN }, { l: 'Week', v: dp.weekDeliveries }, { l: 'Month', v: dp.monthDeliveries }, { l: 'Avg', v: dp.avgDeliveryTimeMinutes ?? '—', s: 'min' }].map((s, i) => (
                    <div key={i} className="bg-inset rounded-lg p-2 text-center border border-line">
                      <p className="text-2xs text-ink-tertiary">{s.l}</p>
                      <p className={`text-base font-semibold font-mono ${s.g ? 'text-green-600 dark:text-green-400' : 'text-ink'}`}>{s.v}</p>
                      {s.s && <p className="text-2xs text-ink-faint">{s.s}</p>}
                    </div>
                  ))}
                </div>

                {/* Breakeven */}
                <div className="mb-3">
                  <div className="flex justify-between text-2xs text-ink-tertiary mb-0.5"><span>Target ({BREAKEVEN})</span><span>{Math.min(100, Math.round(dp.todayDeliveries / BREAKEVEN * 100))}%</span></div>
                  <div className="w-full bg-line rounded-full h-1"><div className={`h-1 rounded-full transition-all ${dp.todayDeliveries >= BREAKEVEN ? 'bg-green-500' : 'bg-amber-500'}`} style={{ width: `${Math.min(100, dp.todayDeliveries / BREAKEVEN * 100)}%` }} /></div>
                </div>

                <div className="flex justify-between text-2xs text-ink-secondary mb-3 px-0.5">
                  <span>CPD: {dp.costPerDelivery != null ? `Rs${dp.costPerDelivery}` : '—'}</span>
                  <span>Cash: Rs{paise(dp.todayStats.cashCollectedPaise)}</span>
                  <span>GMV: Rs{paise(dp.todayStats.gmvPaise)}</span>
                </div>

                <div className="flex gap-2 border-t border-line pt-3" onClick={e => e.stopPropagation()}>
                  {dp.active && !dp.todayAttendance && <button onClick={() => handleMarkAtt(dp.id, 'present')} className="text-2xs text-accent hover:underline">Mark Present</button>}
                  <button onClick={() => openDetail(dp)} className="text-2xs text-accent hover:underline">Details</button>
                  <button onClick={() => handleEdit(dp)} className="text-2xs text-ink-tertiary hover:text-ink">Edit</button>
                  {dp.active ? <button onClick={() => handleDeactivate(dp.id)} className="text-2xs text-red-500 hover:text-red-600">Deactivate</button>
                  : <button onClick={() => handleReactivate(dp.id)} className="text-2xs text-green-600 hover:text-green-700">Reactivate</button>}
                </div>
              </div>
            ))}
          </div>
          {filtered.length === 0 && !showForm && <div className="qv-card p-12 text-center text-ink-tertiary">No delivery persons. Click Add Person.</div>}
        </>
      )}

      {/* LEADERBOARD */}
      {tab === 'leaderboard' && (
        <div className="qv-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-line">
            <h2 className="text-sm font-medium text-ink">Performance Leaderboard</h2>
            <div className="flex gap-1 bg-inset rounded-lg p-0.5 border border-line">
              {(['today', 'week', 'month'] as const).map(p => (
                <button key={p} onClick={() => setLbPeriod(p)} className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${lbPeriod === p ? 'bg-raised text-ink shadow-sm' : 'text-ink-secondary'}`}>{p.charAt(0).toUpperCase() + p.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-line bg-inset">{['#','Name','Deliveries','GMV','Cash','Avg Time','Fastest','Failed','Success %','CPD'].map(h => <th key={h} className={`p-3 qv-label ${['GMV','Cash','CPD'].includes(h) ? 'text-right' : ['Deliveries','Avg Time','Fastest','Failed','Success %'].includes(h) ? 'text-center' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>{leaderboard.map(e => (
                <tr key={e.id} className="border-b border-line hover:bg-accent-soft transition-colors">
                  <td className="p-3 font-semibold">{e.rank <= 3 ? <span className={e.rank === 1 ? 'text-amber-500' : e.rank === 2 ? 'text-ink-tertiary' : 'text-amber-700'}>{e.rank === 1 ? '1st' : e.rank === 2 ? '2nd' : '3rd'}</span> : <span className="text-ink-tertiary">{e.rank}</span>}</td>
                  <td className="p-3"><p className="font-medium text-ink">{e.name}</p><p className="text-2xs text-ink-tertiary">{vehicleLabels[e.vehicleType] || e.vehicleType}</p></td>
                  <td className="p-3 text-center font-semibold text-lg text-ink font-mono">{e.deliveries}</td>
                  <td className="p-3 text-right font-mono text-ink-secondary">Rs{e.gmv.toFixed(0)}</td>
                  <td className="p-3 text-right font-mono text-ink-secondary">Rs{e.cashCollected.toFixed(0)}</td>
                  <td className="p-3 text-center text-ink-secondary">{e.avgTime ?? '—'} min</td>
                  <td className="p-3 text-center text-green-600 dark:text-green-400">{e.fastestTime ?? '—'} min</td>
                  <td className="p-3 text-center text-red-500">{e.failedOrders}</td>
                  <td className="p-3 text-center">{e.successRate != null && <span className={`qv-badge ${e.successRate >= 95 ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : e.successRate >= 85 ? 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400' : 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400'}`}>{e.successRate}%</span>}</td>
                  <td className="p-3 text-right font-mono text-ink-secondary">{e.costPerDelivery != null ? `Rs${e.costPerDelivery}` : '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {leaderboard.length === 0 && <div className="p-8 text-center text-ink-tertiary">No deliveries in this period</div>}
        </div>
      )}

      {/* ATTENDANCE */}
      {tab === 'attendance' && (
        <div className="qv-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-line">
            <h2 className="text-sm font-medium text-ink">Today's Attendance</h2>
            <button onClick={handleBulkAtt} className="qv-btn-secondary text-xs">Mark All Present</button>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-line bg-inset">{['Name','Phone','Status','Deliveries','Month','Actions'].map(h => <th key={h} className={`p-3 qv-label ${['Status','Deliveries','Month','Actions'].includes(h) ? 'text-center' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>{persons.filter(p => p.active).map(dp => (
              <tr key={dp.id} className="border-b border-line hover:bg-accent-soft transition-colors">
                <td className="p-3 font-medium text-ink">{dp.name}</td>
                <td className="p-3 text-ink-secondary text-xs">{dp.phone}</td>
                <td className="p-3 text-center">{dp.todayAttendance ? <span className={`qv-badge ${attBadge(dp.todayAttendance)}`}>{attLabel(dp.todayAttendance)}</span> : <span className="text-2xs text-ink-faint">Not marked</span>}</td>
                <td className="p-3 text-center font-mono text-ink">{dp.todayDeliveries}</td>
                <td className="p-3 text-center text-ink-secondary">{dp.monthPresentDays} days</td>
                <td className="p-3 text-center">
                  <div className="flex gap-1 justify-center">
                    <button onClick={() => handleMarkAtt(dp.id, 'present')} className="text-2xs px-2 py-0.5 bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400 rounded hover:opacity-80">P</button>
                    <button onClick={() => handleMarkAtt(dp.id, 'half_day')} className="text-2xs px-2 py-0.5 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400 rounded hover:opacity-80">H</button>
                    <button onClick={() => handleMarkAtt(dp.id, 'absent')} className="text-2xs px-2 py-0.5 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400 rounded hover:opacity-80">A</button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {/* DETAIL MODAL */}
      {selectedPerson && (
        <div className="fixed inset-0 bg-black/30 dark:bg-black/50 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setSelectedPerson(null)}>
          <div className="qv-card w-full max-w-4xl max-h-[90vh] overflow-auto" style={{ boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-start p-5 border-b border-line sticky top-0 bg-raised z-10">
              <div><h2 className="text-lg font-semibold text-ink">{selectedPerson.name}</h2><p className="text-sm text-ink-tertiary">{selectedPerson.phone} · {vehicleLabels[selectedPerson.vehicleType]}{selectedPerson.joiningDate && ` · Joined ${new Date(selectedPerson.joiningDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`} · {selectedPerson.totalDeliveries} lifetime</p></div>
              <button onClick={() => setSelectedPerson(null)} className="text-ink-tertiary hover:text-ink text-lg">&times;</button>
            </div>
            <div className="flex gap-1 px-5 pt-3 border-b border-line bg-inset">
              {([['overview','Overview'],['history','History'],['earnings','Earnings'],['attendance','Attendance']] as [DetailTab,string][]).map(([t,l]) => (
                <button key={t} onClick={() => setDetailTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${detailTab === t ? 'text-accent border-accent' : 'text-ink-secondary border-transparent hover:text-ink'}`}>{l}</button>
              ))}
            </div>
            <div className="p-5">
              {detailTab === 'overview' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[{ l: 'Today', v: selectedPerson.todayDeliveries, s: `/ ${BREAKEVEN} target` }, { l: 'Week', v: selectedPerson.weekDeliveries }, { l: 'Month', v: selectedPerson.monthDeliveries }, { l: 'Avg Time', v: selectedPerson.avgDeliveryTimeMinutes ?? '—', s: 'minutes' }].map((k, i) => (
                      <div key={i} className="bg-inset rounded-lg p-4 text-center border border-line"><p className="qv-label mb-1">{k.l}</p><p className="text-2xl font-semibold text-ink font-mono">{k.v}</p>{k.s && <p className="text-2xs text-ink-tertiary">{k.s}</p>}</div>
                    ))}
                  </div>
                  <Sec title="Today's Performance"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <ColorStat l="GMV" v={`Rs${paise(selectedPerson.todayStats.gmvPaise)}`} c="blue" />
                    <ColorStat l="Cash" v={`Rs${paise(selectedPerson.todayStats.cashCollectedPaise)}`} c="green" />
                    <ColorStat l="Del. Fees" v={`Rs${paise(selectedPerson.todayStats.deliveryFeesPaise)}`} c="amber" />
                    <ColorStat l="Failed" v={String(selectedPerson.todayStats.failedOrders)} c="red" />
                  </div></Sec>
                  <Sec title="Speed"><div className="grid grid-cols-3 gap-3">
                    <div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Fastest</p><p className="text-xl font-semibold text-green-600 dark:text-green-400 font-mono">{selectedPerson.todayStats.fastestDeliveryMinutes ?? '—'} min</p></div>
                    <div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Average</p><p className="text-xl font-semibold text-ink font-mono">{selectedPerson.todayStats.avgDeliveryTimeMinutes ?? '—'} min</p></div>
                    <div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Slowest</p><p className="text-xl font-semibold text-red-600 dark:text-red-400 font-mono">{selectedPerson.todayStats.slowestDeliveryMinutes ?? '—'} min</p></div>
                  </div></Sec>
                  <Sec title="Economics"><div className="grid grid-cols-3 gap-3">
                    <ColorStat l="Total Cost" v={`Rs${paise(selectedPerson.todayCostPaise)}`} c="purple" sub="Salary + Bonus" />
                    <ColorStat l="Cost/Del" v={selectedPerson.costPerDelivery != null ? `Rs${selectedPerson.costPerDelivery}` : '—'} c="purple" />
                    <ColorStat l="Revenue" v={`Rs${paise(selectedPerson.todayStats.deliveryFeesPaise)}`} c="purple" sub="Del. Fees" />
                  </div></Sec>
                  <Sec title="Details"><div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[['Salary', `Rs${selectedPerson.salaryPerDay}/day`], ['Bonus', `Rs${selectedPerson.perDeliveryBonus}/del`], ['Emergency', selectedPerson.emergencyContact || '—'], ['ID Proof', selectedPerson.idProofNumber || '—']].map(([l, v]) => (
                      <div key={l} className="bg-inset rounded-lg p-3 border border-line"><p className="qv-label">{l}</p><p className="text-sm text-ink mt-1">{v}</p></div>
                    ))}
                  </div></Sec>
                </div>
              )}
              {detailTab === 'history' && (
                <div>
                  <div className="flex gap-2 items-end mb-4">
                    <FI label="From" type="date" value={historyDateFrom} onChange={setHistoryDateFrom} />
                    <FI label="To" type="date" value={historyDateTo} onChange={setHistoryDateTo} />
                    <button onClick={() => loadHistory(selectedPerson.id)} className="qv-btn text-xs">Filter</button>
                    <button onClick={() => { setHistoryDateFrom(''); setHistoryDateTo(''); setTimeout(() => loadHistory(selectedPerson.id), 0) }} className="qv-btn-ghost text-xs">Clear</button>
                    <span className="text-2xs text-ink-tertiary ml-auto">{historyTotal} orders</span>
                  </div>
                  <table className="w-full text-sm"><thead><tr className="border-b border-line">{['Order','Customer','Status','Payment','Time','Amount','Del Fee','Date'].map(h => <th key={h} className={`p-2 qv-label ${['Amount','Del Fee'].includes(h) ? 'text-right' : ['Status','Payment','Time'].includes(h) ? 'text-center' : 'text-left'}`}>{h}</th>)}</tr></thead>
                  <tbody>{history.map(o => (
                    <tr key={o.orderId} className="border-b border-line hover:bg-accent-soft transition-colors">
                      <td className="p-2 font-mono text-xs text-ink-secondary">{o.orderId.slice(-8)}</td>
                      <td className="p-2 text-ink">{o.customerName}</td>
                      <td className="p-2 text-center"><span className={`qv-badge ${o.state === 'COMPLETED' ? 'bg-green-50 text-green-700 dark:bg-green-500/10 dark:text-green-400' : o.state === 'CANCELLED' ? 'bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400' : 'bg-inset text-ink-secondary'}`}>{o.state}</span></td>
                      <td className="p-2 text-center text-2xs text-ink-secondary">{o.paymentMethod}</td>
                      <td className="p-2 text-center">{o.deliveryTimeMinutes != null ? <span className={`text-xs ${o.deliveryTimeMinutes <= 20 ? 'text-green-600 dark:text-green-400' : o.deliveryTimeMinutes <= 35 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{o.deliveryTimeMinutes} min</span> : '—'}</td>
                      <td className="p-2 text-right font-mono text-ink">Rs{o.totalAmount}</td>
                      <td className="p-2 text-right font-mono text-ink-secondary">Rs{o.deliveryFee}</td>
                      <td className="p-2 text-xs text-ink-secondary">{fmtDate(o.creationTime)}</td>
                    </tr>
                  ))}</tbody></table>
                  {history.length === 0 && <div className="p-8 text-center text-ink-tertiary">No history</div>}
                  {historyTotal > 15 && <div className="flex justify-center gap-2 mt-4"><button disabled={historyPage <= 1} onClick={() => loadHistory(selectedPerson.id, historyPage - 1)} className="qv-btn-ghost text-xs disabled:opacity-30">Prev</button><span className="text-xs text-ink-tertiary py-1">Page {historyPage}/{Math.ceil(historyTotal / 15)}</span><button disabled={historyPage >= Math.ceil(historyTotal / 15)} onClick={() => loadHistory(selectedPerson.id, historyPage + 1)} className="qv-btn-ghost text-xs disabled:opacity-30">Next</button></div>}
                </div>
              )}
              {detailTab === 'earnings' && (
                <div>
                  <div className="flex gap-2 items-end mb-4"><FI label="From" type="date" value={earningsFrom} onChange={setEarningsFrom} /><FI label="To" type="date" value={earningsTo} onChange={setEarningsTo} /><button onClick={() => loadEarnings(selectedPerson.id)} className="qv-btn text-xs">Calculate</button></div>
                  {earnings && (<>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5"><ColorStat l="Deliveries" v={String(earnings.summary.totalDeliveries)} c="green" /><ColorStat l="GMV" v={`Rs${earnings.summary.totalGmv.toFixed(0)}`} c="blue" /><ColorStat l="Cash" v={`Rs${earnings.summary.cashCollected.toFixed(0)}`} c="amber" /><ColorStat l="Del Fees" v={`Rs${earnings.summary.deliveryFeesEarned.toFixed(0)}`} c="purple" /></div>
                    <Sec title="Cost & Profitability"><div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Salary</p><p className="text-base font-semibold text-ink font-mono">Rs{earnings.summary.salaryPaid.toFixed(0)}</p><p className="text-2xs text-ink-faint">{earnings.summary.presentDays}d + {earnings.summary.halfDays} half</p></div>
                      <div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Bonus</p><p className="text-base font-semibold text-ink font-mono">Rs{earnings.summary.bonusPaid.toFixed(0)}</p></div>
                      <ColorStat l="Total Cost" v={`Rs${earnings.summary.totalCost.toFixed(0)}`} c="red" />
                      <div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Cost/Del</p><p className="text-base font-semibold text-ink font-mono">{earnings.summary.costPerDelivery != null ? `Rs${earnings.summary.costPerDelivery}` : '—'}</p></div>
                      <div className={`bg-inset rounded-lg p-3 text-center border ${(earnings.summary.profitPerDelivery ?? 0) >= 0 ? 'border-green-200 dark:border-green-500/20' : 'border-red-200 dark:border-red-500/20'}`}><p className="qv-label">Profit/Del</p><p className={`text-base font-semibold font-mono ${(earnings.summary.profitPerDelivery ?? 0) >= 0 ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>{earnings.summary.profitPerDelivery != null ? `Rs${earnings.summary.profitPerDelivery}` : '—'}</p></div>
                    </div></Sec>
                    <Sec title="Work Summary"><div className="grid grid-cols-4 gap-3"><ColorStat l="Present" v={String(earnings.summary.presentDays)} c="green" /><ColorStat l="Absent" v={String(earnings.summary.absentDays)} c="red" /><div className="bg-inset rounded-lg p-3 text-center border border-line"><p className="qv-label">Hours</p><p className="text-base font-semibold text-ink font-mono">{earnings.summary.totalHoursWorked}h</p></div><ColorStat l="Failed" v={String(earnings.summary.failedOrders)} c="red" /></div></Sec>
                    <Sec title="Daily Breakdown"><div className="overflow-x-auto max-h-64 overflow-y-auto qv-card"><table className="w-full text-xs"><thead className="sticky top-0 bg-raised"><tr className="border-b border-line">{['Date','Att','Del','GMV','Cash','Hrs','Salary','Bonus','Total'].map(h => <th key={h} className={`p-2 qv-label ${['GMV','Cash','Salary','Bonus','Total'].includes(h) ? 'text-right' : ['Att','Del','Hrs'].includes(h) ? 'text-center' : 'text-left'}`}>{h}</th>)}</tr></thead>
                    <tbody>{earnings.daily.map(d => (
                      <tr key={d.date} className="border-b border-line hover:bg-accent-soft transition-colors">
                        <td className="p-2 text-ink-secondary">{new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })}</td>
                        <td className="p-2 text-center">{d.attendance ? <span className={`qv-badge text-2xs ${attBadge(d.attendance)}`}>{d.attendance === 'present' ? 'P' : d.attendance === 'half_day' ? 'H' : 'A'}</span> : <span className="text-ink-faint">—</span>}</td>
                        <td className="p-2 text-center font-mono text-ink">{d.deliveries || '—'}</td>
                        <td className="p-2 text-right font-mono text-ink-secondary">Rs{d.gmv.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono text-ink-secondary">Rs{d.cashCollected.toFixed(0)}</td>
                        <td className="p-2 text-center text-ink-secondary">{d.hoursWorked > 0 ? `${d.hoursWorked}h` : '—'}</td>
                        <td className="p-2 text-right font-mono text-ink-secondary">Rs{d.salary.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono text-ink-secondary">Rs{d.bonus.toFixed(0)}</td>
                        <td className="p-2 text-right font-mono text-ink font-medium">Rs{(d.salary + d.bonus).toFixed(0)}</td>
                      </tr>
                    ))}</tbody></table></div></Sec>
                  </>)}
                </div>
              )}
              {detailTab === 'attendance' && (
                <div>
                  <div className="flex gap-2 items-end mb-4"><FI label="Month" type="month" value={attMonth} onChange={v => { setAttMonth(v); setTimeout(() => loadAttendance(selectedPerson.id), 0) }} /><button onClick={() => loadAttendance(selectedPerson.id)} className="qv-btn text-xs">Load</button></div>
                  {attendanceSummary && <div className="grid grid-cols-4 gap-3 mb-4"><ColorStat l="Present" v={String(attendanceSummary.present)} c="green" /><ColorStat l="Half Day" v={String(attendanceSummary.halfDay)} c="amber" /><ColorStat l="Absent" v={String(attendanceSummary.absent)} c="red" /><ColorStat l="Hours" v={`${attendanceSummary.totalHoursWorked}h`} c="blue" /></div>}
                  <table className="w-full text-sm"><thead><tr className="border-b border-line">{['Date','Status','Login','Logout','Hours','Notes'].map(h => <th key={h} className={`p-2 qv-label ${['Status','Login','Logout','Hours'].includes(h) ? 'text-center' : 'text-left'}`}>{h}</th>)}</tr></thead>
                  <tbody>{attendanceRecords.map(r => (
                    <tr key={r.date} className="border-b border-line hover:bg-accent-soft transition-colors">
                      <td className="p-2 text-ink-secondary text-xs">{new Date(r.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' })}</td>
                      <td className="p-2 text-center"><span className={`qv-badge ${attBadge(r.status)}`}>{attLabel(r.status)}</span></td>
                      <td className="p-2 text-center text-xs text-ink-secondary">{r.loginTime ? new Date(r.loginTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="p-2 text-center text-xs text-ink-secondary">{r.logoutTime ? new Date(r.logoutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '—'}</td>
                      <td className="p-2 text-center text-ink-secondary">{r.hoursWorked > 0 ? `${r.hoursWorked}h` : '—'}</td>
                      <td className="p-2 text-xs text-ink-tertiary">{r.notes || '—'}</td>
                    </tr>
                  ))}</tbody></table>
                  {attendanceRecords.length === 0 && <div className="p-8 text-center text-ink-tertiary">No records</div>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FI({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string }) {
  return <div><label className="block qv-label mb-1.5">{label}</label><input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className="qv-input" /></div>
}
function Sec({ title, children }: { title: string; children: React.ReactNode }) {
  return <div><h3 className="text-sm font-medium text-ink-secondary mb-3">{title}</h3>{children}</div>
}
function ColorStat({ l, v, c, sub }: { l: string; v: string; c: string; sub?: string }) {
  const bg: Record<string, string> = { green: 'bg-green-50 dark:bg-green-500/5 border-green-100 dark:border-green-500/10', blue: 'bg-blue-50 dark:bg-blue-500/5 border-blue-100 dark:border-blue-500/10', amber: 'bg-amber-50 dark:bg-amber-500/5 border-amber-100 dark:border-amber-500/10', red: 'bg-red-50 dark:bg-red-500/5 border-red-100 dark:border-red-500/10', purple: 'bg-purple-50 dark:bg-purple-500/5 border-purple-100 dark:border-purple-500/10' }
  const tx: Record<string, string> = { green: 'text-green-700 dark:text-green-400', blue: 'text-blue-700 dark:text-blue-400', amber: 'text-amber-700 dark:text-amber-400', red: 'text-red-700 dark:text-red-400', purple: 'text-purple-700 dark:text-purple-400' }
  return <div className={`rounded-lg p-3 text-center border ${bg[c]}`}><p className="qv-label">{l}</p><p className={`text-base font-semibold font-mono mt-1 ${tx[c]}`}>{v}</p>{sub && <p className="text-2xs text-ink-faint">{sub}</p>}</div>
}
