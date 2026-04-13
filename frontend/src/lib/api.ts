import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// ─── Auth ────────────────────────────────────────────────────────────

export const sendOtp = (phone: string) =>
  api.post('/auth/send-otp', { phone }).then(r => r.data)

export const verifyOtp = (phone: string, otp: string, verificationId: string) =>
  api.post('/auth/verify-otp', { phone, otp, verificationId }).then(r => r.data)

export const fetchRegions = () =>
  api.get('/auth/regions').then(r => r.data.regions)

// ─── Orders ──────────────────────────────────────────────────────────

export const syncOrders = (regionId: string, sessionKey: string, timeRange?: string) =>
  api.post('/orders/sync', { regionId, sessionKey, timeRange: timeRange || 'LAST_1_MONTH' }).then(r => r.data)

export const fetchOrders = (params: Record<string, string | number | undefined>) =>
  api.get('/orders', { params }).then(r => r.data)

export const assignDelivery = (orderId: string, deliveryPersonId: number) =>
  api.put(`/orders/${orderId}/assign-delivery`, { delivery_person_id: deliveryPersonId }).then(r => r.data)

// ─── Vendors ─────────────────────────────────────────────────────────

export const syncVendors = (regionId: string) =>
  api.post('/vendors/sync', { regionId }).then(r => r.data)

export const fetchVendors = () =>
  api.get('/vendors').then(r => r.data.vendors)

export const updateVendor = (vendorId: string, data: { custom_commission_percent?: number; notes?: string }) =>
  api.put(`/vendors/${vendorId}`, data).then(r => r.data)

// ─── Settlements ─────────────────────────────────────────────────────

export const calculateSettlement = (data: {
  vendor_id: string; period_start: string; period_end: string;
  adjustments?: number; adjustment_reason?: string; notes?: string
}) => api.post('/settlements/calculate', data).then(r => r.data)

export const fetchSettlements = (params?: { vendor_id?: string; status?: string }) =>
  api.get('/settlements', { params }).then(r => r.data.settlements)

export const fetchVendorSummary = () =>
  api.get('/settlements/vendor-summary').then(r => r.data.vendors)

export const markSettled = (id: number, settledBy: string = 'admin') =>
  api.put(`/settlements/${id}/settle`, { settled_by: settledBy }).then(r => r.data)

export const updateSettlement = (id: number, data: { adjustments?: number; adjustment_reason?: string; notes?: string }) =>
  api.put(`/settlements/${id}`, data).then(r => r.data)

export const deleteSettlement = (id: number) =>
  api.delete(`/settlements/${id}`).then(r => r.data)

// ─── Delivery Persons ────────────────────────────────────────────────

export const fetchDeliveryPersons = () =>
  api.get('/delivery-persons').then(r => r.data.deliveryPersons)

export const createDeliveryPerson = (data: {
  name: string; phone: string; vehicle_type?: string;
  salary_per_day?: number; per_delivery_bonus?: number;
  joining_date?: string; emergency_contact?: string; id_proof_number?: string
}) => api.post('/delivery-persons', data).then(r => r.data)

export const updateDeliveryPerson = (id: number, data: {
  name: string; phone: string; vehicle_type?: string;
  salary_per_day?: number; per_delivery_bonus?: number;
  joining_date?: string; emergency_contact?: string; id_proof_number?: string
}) => api.put(`/delivery-persons/${id}`, data).then(r => r.data)

export const deleteDeliveryPerson = (id: number) =>
  api.delete(`/delivery-persons/${id}`).then(r => r.data)

export const reactivateDeliveryPerson = (id: number) =>
  api.put(`/delivery-persons/${id}/reactivate`).then(r => r.data)

export const fetchDeliveryHistory = (id: number, params?: { page?: number; per_page?: number; date_from?: string; date_to?: string }) =>
  api.get(`/delivery-persons/${id}/history`, { params }).then(r => r.data)

export const fetchDeliveryEarnings = (id: number, params?: { date_from?: string; date_to?: string }) =>
  api.get(`/delivery-persons/${id}/earnings`, { params }).then(r => r.data)

export const fetchDeliveryLeaderboard = (period: string = 'today') =>
  api.get('/delivery-persons/leaderboard', { params: { period } }).then(r => r.data)

export const markAttendance = (id: number, data: { status: string; login_time?: string; logout_time?: string; notes?: string }) =>
  api.post(`/delivery-persons/${id}/attendance`, data).then(r => r.data)

export const fetchAttendance = (id: number, month?: string) =>
  api.get(`/delivery-persons/${id}/attendance`, { params: month ? { month } : {} }).then(r => r.data)

export const bulkMarkAttendance = () =>
  api.post('/delivery-persons/bulk-attendance').then(r => r.data)

// ─── Analytics ───────────────────────────────────────────────────────

export const fetchAnalyticsSummary = () =>
  api.get('/analytics/summary').then(r => r.data)

export const fetchDailyOrders = (days: number = 30) =>
  api.get('/analytics/daily-orders', { params: { days } }).then(r => r.data.dailyOrders)

export const fetchPeakHours = () =>
  api.get('/analytics/peak-hours').then(r => r.data.peakHours)

export const fetchVendorRanking = () =>
  api.get('/analytics/vendor-ranking').then(r => r.data.vendorRanking)

export const fetchPaymentSplit = () =>
  api.get('/analytics/payment-split').then(r => r.data)

// ─── Config ──────────────────────────────────────────────────────────

export const fetchConfig = () =>
  api.get('/config').then(r => r.data.config)

export const updateConfig = (key: string, value: string) =>
  api.put(`/config/${key}`, { value }).then(r => r.data)
