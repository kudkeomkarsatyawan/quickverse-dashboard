export interface Order {
  id: number
  orderId: string
  campusId: string
  shopId: number
  storeCategory: string
  customerName: string
  customerMobile: number
  customerAddress: string
  state: string
  totalAmount: number
  amountExclDelivery: number
  deliveryFee: number
  paymentMethod: string
  fulfillmentOption: string
  creationTime: string | null
  acceptedDate: string | null
  completedDate: string | null
  rejectedDate: string | null
  orderItems: { id: number; name: string; itemCount: number }[]
  totalItemCount: number
  orderDescription: string
  deliveryPersonId: number | null
  deliveryTimeMinutes: number | null
  syncedAt: string | null
}

export interface Vendor {
  vendorId: string
  vendorName: string
  vendorPhone: string
  vendorLogoUrl: string
  storeCategory: string
  customCommissionPercent: number | null
  notes: string
  totalOrders: number
  completedOrders: number
  lat: number | null
  lng: number | null
}

export interface Settlement {
  id: number
  vendorId: string
  periodStart: string
  periodEnd: string
  totalOrders: number
  totalGmv: number
  foodValue: number
  commission: number
  deliveryFees: number
  platformFees: number
  adjustments: number
  adjustmentReason: string
  netPayable: number
  ourEarnings: number
  status: string
  settledAt: string | null
  settledBy: string | null
  notes: string
  createdAt: string
}

export interface DeliveryStats {
  deliveries: number
  gmvPaise: number
  cashCollectedPaise: number
  deliveryFeesPaise: number
  avgDeliveryTimeMinutes: number | null
  fastestDeliveryMinutes: number | null
  slowestDeliveryMinutes: number | null
  failedOrders: number
}

export interface DeliveryPerson {
  id: number
  name: string
  phone: string
  active: boolean
  vehicleType: string
  salaryPerDay: number
  perDeliveryBonus: number
  joiningDate: string | null
  emergencyContact: string
  idProofNumber: string
  todayDeliveries: number
  weekDeliveries: number
  monthDeliveries: number
  totalDeliveries: number
  avgDeliveryTimeMinutes: number | null
  todayStats: DeliveryStats
  weekStats: DeliveryStats
  monthStats: DeliveryStats
  todayAttendance: string | null
  monthPresentDays: number
  todayCostPaise: number
  costPerDelivery: number | null
}

export interface DeliveryHistoryOrder {
  orderId: string
  customerName: string
  customerAddress: string
  state: string
  totalAmount: number
  deliveryFee: number
  paymentMethod: string
  creationTime: string | null
  completedDate: string | null
  deliveryTimeMinutes: number | null
}

export interface LeaderboardEntry {
  rank: number
  id: number
  name: string
  vehicleType: string
  deliveries: number
  gmv: number
  cashCollected: number
  avgTime: number | null
  fastestTime: number | null
  failedOrders: number
  costPerDelivery: number | null
  successRate: number | null
}

export interface AttendanceRecord {
  date: string
  status: string
  loginTime: string | null
  logoutTime: string | null
  hoursWorked: number
  notes: string
}

export interface EarningsSummary {
  totalDeliveries: number
  totalGmv: number
  cashCollected: number
  deliveryFeesEarned: number
  avgDeliveryTime: number | null
  presentDays: number
  halfDays: number
  absentDays: number
  totalHoursWorked: number
  salaryPaid: number
  bonusPaid: number
  totalCost: number
  costPerDelivery: number | null
  revenuePerDelivery: number | null
  profitPerDelivery: number | null
  failedOrders: number
}

export interface EarningsDaily {
  date: string
  deliveries: number
  gmv: number
  cashCollected: number
  attendance: string | null
  hoursWorked: number
  salary: number
  bonus: number
}

export interface PeriodStats {
  totalOrders: number
  completedOrders: number
  totalGmv: number
  ourRevenue: number
  commission: number
  deliveryFees: number
  platformFees: number
  taxes: number
  avgDeliveryTime: number | null
  avgOrderValue: number
}

export interface AnalyticsSummary {
  period: PeriodStats
  today: PeriodStats
  week: PeriodStats
  month: PeriodStats
}

export interface DailyOrder {
  date: string
  orders: number
  gmv: number
}

export interface HourData {
  hour: number
  orders: number
}

export interface VendorRank {
  vendorId: string
  vendorName: string
  totalOrders: number
  totalGmv: number
  foodValue: number
  avgOrderValue: number
}

export interface PaymentSplit {
  cash: { count: number; amount: number }
  prepaid: { count: number; amount: number }
  total: { count: number; amount: number }
}

export interface Region {
  regionId: string
  regionName: string
  displayName: string
  regionEnabled: boolean
}

export interface PricingConfig {
  serviceType: string
  configKey: string
  actualValue: number
  expectedValue: number
  isActive: boolean
}

export interface DateDetail {
  date: string
  totalOrders: number
  completedOrders: number
  cancelledOrders: number
  totalGmv: number
  ourRevenue: number
  commission: number
  deliveryFees: number
  platformFees: number
  taxes: number
  avgOrderValue: number
  hourlyBreakdown: { hour: number; orders: number; completed: number }[]
}

export interface LiveMapOrder {
  orderId: string
  state: string
  customerName: string
  customerAddress: string
  lat: number | null
  lng: number | null
  creationTime: string | null
  shopId: number
  vendorName: string
  totalAmount: number
  paymentMethod: string
  totalItemCount: number
  orderDescription: string
  vendorLat: number | null
  vendorLng: number | null
}

export interface LiveMapSummary {
  pending: number
  accepted: number
  packed: number
  shipped: number
  total: number
  withCoordinates: number
}
