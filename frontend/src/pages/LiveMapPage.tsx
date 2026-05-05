/// <reference types="google.maps" />
/// <reference types="vite/client" />
import { useState, useEffect, useRef, useCallback } from 'react'
import { fetchLiveMapOrders, syncOrders, getSyncStatus } from '../lib/api'
import { useAuthStore } from '../lib/store'
import { LiveMapOrder, LiveMapSummary } from '../lib/types'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

const GOOGLE_MAPS_API_KEY: string = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || ''

// ─── Constants ───────────────────────────────────────────────────────

const BEED_CENTER = { lat: 18.9900, lng: 75.7531 }
const BEED_BOUNDS = {
  north: 19.05,
  south: 18.93,
  east: 75.83,
  west: 75.67,
}
const REFRESH_INTERVAL_MS = 60_000

const STATUS_CONFIG: Record<string, { color: string; label: string; bg: string; border: string }> = {
  PENDING:  { color: '#EF4444', label: 'Pending',  bg: 'bg-red-50 dark:bg-red-950/30',     border: 'border-red-200 dark:border-red-800' },
  ACCEPTED: { color: '#F59E0B', label: 'Accepted', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800' },
  PACKED:   { color: '#6366F1', label: 'Packed',   bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border-indigo-200 dark:border-indigo-800' },
  SHIPPED:  { color: '#22C55E', label: 'Shipped',  bg: 'bg-green-50 dark:bg-green-950/30',  border: 'border-green-200 dark:border-green-800' },
}

const MAP_DARK_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#1d2033' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d2033' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8898aa' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#cbd5e1' }, { visibility: 'on' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2033' }, { visibility: 'on' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#94a3b8' }, { visibility: 'on' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.stroke', stylers: [{ color: '#1d2033' }, { visibility: 'on' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry.fill', stylers: [{ color: '#2a3147' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212736' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#697a91' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#334155' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3e4f6b' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#2a3a50' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#8898aa' }] },
  { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#546a80' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f172a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#2d4a6e' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#1a2234' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#1a2820' }] },
]

// ─── Helpers ─────────────────────────────────────────────────────────

function getElapsedTime(creationTime: string | null): string {
  if (!creationTime) return '--'
  const created = new Date(creationTime).getTime()
  const now = Date.now()
  const diffMs = now - created
  if (diffMs < 0) return '0m'
  const totalMins = Math.floor(diffMs / 60000)
  const hours = Math.floor(totalMins / 60)
  const mins = totalMins % 60
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function buildMarkerSvgUrl(order: LiveMapOrder): string {
  const cfg = STATUS_CONFIG[order.state] || STATUS_CONFIG.PENDING
  const c = cfg.color

  let icon = ''
  if (order.state === 'PENDING') {
    icon = `
      <circle cx="22" cy="22" r="7.5" stroke="${c}" stroke-width="1.5" fill="none"/>
      <line x1="22" y1="22" x2="22" y2="16" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>
      <line x1="22" y1="22" x2="27.5" y2="22" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="22" cy="22" r="1.5" fill="${c}"/>
    `
  } else if (order.state === 'ACCEPTED') {
    icon = `
      <polyline points="14,22 20,28 30,14" stroke="${c}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    `
  } else {
    icon = `
      <rect x="13" y="17" width="14" height="9" rx="1" fill="${c}"/>
      <path d="M27 17 L31 20 L31 26 L27 26 Z" fill="${c}"/>
      <path d="M27.5 18 L30 20.5 L30 22 L27.5 22 Z" fill="white" fill-opacity="0.6"/>
      <circle cx="16" cy="27" r="2" fill="white" stroke="${c}" stroke-width="1.5"/>
      <circle cx="28" cy="27" r="2" fill="white" stroke="${c}" stroke-width="1.5"/>
    `
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="56" viewBox="0 0 44 56" fill="none">
    <path d="M22 0C9.85 0 0 9.85 0 22c0 16.5 22 34 22 34s22-17.5 22-34C44 9.85 34.15 0 22 0z" fill="${c}"/>
    <circle cx="22" cy="22" r="11" fill="white"/>
    ${icon}
  </svg>`

  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}

// Small shop-icon pin used to mark the vendor's pickup location.
// Dark slate so it doesn't compete with the bright order markers.
function buildVendorPinSvgUrl(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="44" viewBox="0 0 36 44" fill="none">
    <path d="M18 0C9.16 0 2 7.16 2 16C2 26 18 44 18 44S34 26 34 16C34 7.16 26.84 0 18 0z" fill="#1e293b" stroke="#475569" stroke-width="1"/>
    <circle cx="18" cy="16" r="10" fill="#0f172a"/>
    <polyline points="10,17 18,10 26,17" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <rect x="11" y="17" width="14" height="9" rx="1" fill="#334155"/>
    <rect x="15" y="20" width="4" height="6" rx="0.5" fill="#0f172a"/>
  </svg>`
  return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg)
}

// Returns polyline style options — dim dashed when idle, solid highlight when selected.
function buildPolylineOptions(
  color: string,
  isSelected: boolean,
): google.maps.PolylineOptions {
  if (isSelected) {
    return {
      strokeColor: color,
      strokeOpacity: 0.85,
      strokeWeight: 3,
      icons: [],
      zIndex: 10,
      clickable: false,
    }
  }
  return {
    strokeColor: color,
    strokeOpacity: 0,
    strokeWeight: 2,
    icons: [
      {
        icon: {
          path: 'M 0,-1 0,1',
          strokeOpacity: 0.28,
          strokeColor: color,
          scale: 3,
        },
        offset: '0',
        repeat: '10px',
      },
    ],
    zIndex: 1,
    clickable: false,
  }
}

function buildInfoWindowContent(order: LiveMapOrder): string {
  const cfg = STATUS_CONFIG[order.state] || STATUS_CONFIG.PENDING
  const elapsed = getElapsedTime(order.creationTime)
  const time = order.creationTime
    ? new Date(order.creationTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
    : '--'

  return `
    <div style="font-family: 'Inter', system-ui, sans-serif; min-width: 220px; max-width: 280px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
        <span style="font-weight: 700; font-size: 13px; color: #1a1a1a;">#${order.orderId}</span>
        <span style="
          background: ${cfg.color};
          color: white;
          font-size: 10px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 12px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        ">${cfg.label}</span>
      </div>

      <div style="font-size: 12px; color: #555; line-height: 1.6;">
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Customer</span>
          <span style="font-weight: 500; color: #333;">${order.customerName || 'N/A'}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Vendor</span>
          <span style="font-weight: 500; color: #333;">${order.vendorName || 'N/A'}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Items</span>
          <span style="font-weight: 500; color: #333;">${order.totalItemCount} item${order.totalItemCount !== 1 ? 's' : ''}</span>
        </div>
        ${order.orderDescription ? `<div style="margin-top: 2px; color: #666; font-style: italic; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${order.orderDescription.slice(0, 60)}${order.orderDescription.length > 60 ? '…' : ''}</div>` : ''}
        <div style="height: 1px; background: #eee; margin: 6px 0;"></div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Amount</span>
          <span style="font-weight: 700; color: #1a1a1a;">₹${order.totalAmount.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Payment</span>
          <span style="font-weight: 500; color: ${order.paymentMethod === 'COD' ? '#D97706' : '#059669'};">${order.paymentMethod || 'N/A'}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Placed</span>
          <span style="font-weight: 500; color: #333;">${time}</span>
        </div>
        ${elapsed !== '--' ? `
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #888;">Elapsed</span>
          <span style="font-weight: 700; color: ${cfg.color};">${elapsed}</span>
        </div>` : ''}
      </div>
    </div>
  `
}

// ─── Component ───────────────────────────────────────────────────────

export default function LiveMapPage() {
  const [orders, setOrders] = useState<LiveMapOrder[]>([])
  const [summary, setSummary] = useState<LiveMapSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(REFRESH_INTERVAL_MS / 1000)
  const [selectedOrder, setSelectedOrder] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [showRoutes, setShowRoutes] = useState(false)

  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<Map<string, google.maps.Marker>>(new Map())
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null)
  const polylinesRef = useRef<Map<string, google.maps.Polyline>>(new Map())
  const vendorPinRef = useRef<google.maps.Marker | null>(null)
  const mapsInitRef = useRef(false)
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const syncInProgressRef = useRef(false)
  const isInitialLoadRef = useRef(true)

  // ─── Sync + fetch ────────────────────────────────────────────────

  const fetchAndSync = useCallback(async () => {
    if (syncInProgressRef.current) return
    if (document.hidden) return

    const { token, regionId } = useAuthStore.getState()
    if (!token || !regionId) return

    syncInProgressRef.current = true
    setError(null)
    if (isInitialLoadRef.current) setLoading(true)

    try {
      await syncOrders(regionId, token, 'TODAY')

      await new Promise<void>((resolve, reject) => {
        const poll = setInterval(async () => {
          try {
            const status = await getSyncStatus()
            if (!status.running) {
              clearInterval(poll)
              if (status.error) reject(new Error(status.error))
              else resolve()
            }
          } catch (e) {
            clearInterval(poll)
            reject(e)
          }
        }, 2000)
      })

      const data = await fetchLiveMapOrders()
      setOrders(data.orders || [])
      setSummary(data.summary || null)
      setLastRefresh(new Date())
      setCountdown(REFRESH_INTERVAL_MS / 1000)
      isInitialLoadRef.current = false
    } catch (e: any) {
      const isNetworkError =
        !navigator.onLine ||
        e.code === 'ERR_NETWORK' ||
        e.message === 'Network Error'

      setError(
        isNetworkError
          ? 'No internet connection, failed to fetch.'
          : (e.response?.data?.detail || e.message || 'Failed to fetch orders')
      )

      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current)
        autoRefreshRef.current = null
      }
    } finally {
      setLoading(false)
      syncInProgressRef.current = false
    }
  }, [])

  const startAutoRefresh = useCallback(() => {
    if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
    autoRefreshRef.current = setInterval(fetchAndSync, REFRESH_INTERVAL_MS)
    setCountdown(REFRESH_INTERVAL_MS / 1000)
  }, [fetchAndSync])

  // ─── Initialize Google Map ────────────────────────────────────────

  useEffect(() => {
    const initMap = async () => {
      if (mapsInitRef.current) return
      mapsInitRef.current = true

      setOptions({ key: GOOGLE_MAPS_API_KEY, v: 'quarterly' })
      await importLibrary('maps')

      if (mapRef.current && !mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapRef.current, {
          center: BEED_CENTER,
          zoom: 13,
          minZoom: 11,
          maxZoom: 18,
          restriction: {
            latLngBounds: BEED_BOUNDS,
            strictBounds: false,
          },
          styles: MAP_DARK_STYLES,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        })

        infoWindowRef.current = new google.maps.InfoWindow()
      }
    }

    initMap().then(() => {
      fetchAndSync()
      startAutoRefresh()
    })

    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current)
      polylinesRef.current.forEach(pl => pl.setMap(null))
      polylinesRef.current.clear()
      if (vendorPinRef.current) {
        vendorPinRef.current.setMap(null)
        vendorPinRef.current = null
      }
    }
  }, [fetchAndSync, startAutoRefresh])

  // Countdown ticker
  useEffect(() => {
    const tick = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1))
    }, 1000)
    return () => clearInterval(tick)
  }, [])

  // Pause auto-refresh when tab is hidden
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        if (autoRefreshRef.current) {
          clearInterval(autoRefreshRef.current)
          autoRefreshRef.current = null
        }
      } else {
        fetchAndSync()
        startAutoRefresh()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [fetchAndSync, startAutoRefresh])

  // ─── Update customer markers when orders change ───────────────────

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    const currentOrderIds = new Set(orders.map(o => o.orderId))

    // Remove stale markers
    markersRef.current.forEach((marker, id) => {
      if (!currentOrderIds.has(id)) {
        marker.setMap(null)
        markersRef.current.delete(id)
      }
    })

    // Add/update markers
    orders.forEach(order => {
      if (order.lat == null || order.lng == null) return

      const existingMarker = markersRef.current.get(order.orderId)

      if (existingMarker) {
        existingMarker.setPosition({ lat: order.lat, lng: order.lng })
        existingMarker.setIcon({
          url: buildMarkerSvgUrl(order),
          scaledSize: new google.maps.Size(44, 56),
          anchor: new google.maps.Point(22, 56),
        })
      } else {
        const marker = new google.maps.Marker({
          map,
          position: { lat: order.lat, lng: order.lng },
          icon: {
            url: buildMarkerSvgUrl(order),
            scaledSize: new google.maps.Size(28, 36),
            anchor: new google.maps.Point(14, 36),
          },
          title: `#${order.orderId} — ${order.customerName}`,
        })

        marker.addListener('click', () => {
          if (infoWindowRef.current) {
            infoWindowRef.current.setContent(buildInfoWindowContent(order))
            infoWindowRef.current.open(map, marker)
            setSelectedOrder(order.orderId)
          }
        })

        markersRef.current.set(order.orderId, marker)
      }
    })
  }, [orders])

  // ─── Manage route polylines and vendor pin ────────────────────────
  //
  // Runs whenever orders refresh, the routes toggle changes, or the selected
  // order changes. Doing all three in one effect ensures the stale-polyline
  // cleanup, visibility, and highlight styling always stay in sync.

  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return

    const currentOrderIds = new Set(orders.map(o => o.orderId))

    // Remove polylines for orders that are no longer in the list
    polylinesRef.current.forEach((pl, id) => {
      if (!currentOrderIds.has(id)) {
        pl.setMap(null)
        polylinesRef.current.delete(id)
      }
    })

    // Create / update a polyline for every order that has both endpoints
    orders.forEach(order => {
      const hasRoute =
        order.lat != null && order.lng != null &&
        order.vendorLat != null && order.vendorLng != null

      if (!hasRoute) return

      const cfg = STATUS_CONFIG[order.state] || STATUS_CONFIG.PENDING
      const isSelected = order.orderId === selectedOrder
      const opts = buildPolylineOptions(cfg.color, isSelected)
      const path = [
        { lat: order.vendorLat as number, lng: order.vendorLng as number },
        { lat: order.lat as number,       lng: order.lng as number       },
      ]

      const existing = polylinesRef.current.get(order.orderId)
      if (existing) {
        existing.setPath(path)
        existing.setOptions({ ...opts, map: showRoutes ? map : null })
      } else {
        const polyline = new google.maps.Polyline({
          path,
          map: showRoutes ? map : null,
          ...opts,
        })
        polylinesRef.current.set(order.orderId, polyline)
      }
    })

    // ── Vendor pin: show only for the currently selected order ────────
    const selOrder = showRoutes && selectedOrder
      ? orders.find(o => o.orderId === selectedOrder)
      : null
    const hasVendorCoords =
      selOrder && selOrder.vendorLat != null && selOrder.vendorLng != null

    if (!hasVendorCoords) {
      // Hide vendor pin
      if (vendorPinRef.current) {
        vendorPinRef.current.setMap(null)
        vendorPinRef.current = null
      }
    } else {
      const pos = {
        lat: selOrder!.vendorLat as number,
        lng: selOrder!.vendorLng as number,
      }
      if (vendorPinRef.current) {
        // Reuse existing pin — just move it if needed
        vendorPinRef.current.setPosition(pos)
        vendorPinRef.current.setMap(map)
      } else {
        vendorPinRef.current = new google.maps.Marker({
          map,
          position: pos,
          icon: {
            url: buildVendorPinSvgUrl(),
            scaledSize: new google.maps.Size(28, 36),
            anchor: new google.maps.Point(14, 36),
          },
          title: `${selOrder!.vendorName || 'Vendor'} (Pickup)`,
          zIndex: 5,
        })
      }
    }
  }, [orders, showRoutes, selectedOrder])

  // ─── Filtered list for sidebar ───────────────────────────────────

  const filteredOrders = statusFilter
    ? orders.filter(o => o.state === statusFilter)
    : orders

  const handleOrderClick = (order: LiveMapOrder) => {
    setSelectedOrder(order.orderId)
    if (order.lat != null && order.lng != null && mapInstanceRef.current) {
      mapInstanceRef.current.panTo({ lat: order.lat, lng: order.lng })
      mapInstanceRef.current.setZoom(16)

      const marker = markersRef.current.get(order.orderId)
      if (marker && infoWindowRef.current) {
        infoWindowRef.current.setContent(buildInfoWindowContent(order))
        infoWindowRef.current.open(mapInstanceRef.current, marker)
      }
    }
  }

  const handleManualRefresh = useCallback(() => {
    fetchAndSync()
    startAutoRefresh()
  }, [fetchAndSync, startAutoRefresh])

  // Count how many orders have a drawable route (both endpoints known)
  const routeCount = orders.filter(
    o => o.lat != null && o.lng != null && o.vendorLat != null && o.vendorLng != null
  ).length

  // ─── Render ──────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-line bg-raised flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-ink">Live Order Map</h1>
          <p className="text-xs text-ink-tertiary mt-0.5">
            Today's active orders • Beed Region
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Countdown / paused indicator */}
          <span className="text-xs tabular-nums">
            {error
              ? <span className="text-amber-500">Auto-refresh paused</span>
              : <span className="text-ink-tertiary">Refresh in {countdown}s</span>}
          </span>
          {lastRefresh && (
            <span className="text-2xs text-ink-tertiary">
              Updated {lastRefresh.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          )}

          {/* Routes toggle */}
          <button
            onClick={() => setShowRoutes(prev => !prev)}
            title={
              routeCount === 0
                ? 'No vendor locations set — add coordinates via Vendors page'
                : `Toggle vendor → customer route lines (${routeCount} routes available)`
            }
            className={`
              text-xs px-3 py-1.5 rounded-md border font-medium flex items-center gap-1.5 transition-all
              ${showRoutes
                ? 'bg-accent text-white border-accent'
                : 'bg-canvas text-ink-secondary border-line hover:border-accent hover:text-ink'
              }
              ${routeCount === 0 ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            disabled={routeCount === 0}
          >
            {/* Route icon */}
            <svg className="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="3" cy="3" r="1.5"/>
              <circle cx="13" cy="13" r="1.5"/>
              <path d="M3 4.5 C3 8 13 8 13 11.5"/>
            </svg>
            Routes {showRoutes ? 'On' : 'Off'}
          </button>

          <button
            onClick={handleManualRefresh}
            disabled={loading}
            className="qv-btn text-xs disabled:opacity-40"
          >
            {loading ? 'Syncing...' : 'Refresh Now'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {/* ─── Map ─────────────────────────────────────────────── */}
        <div className="flex-1 relative">
          <div ref={mapRef} className="absolute inset-0" />

          {/* Loading overlay */}
          {loading && orders.length === 0 && (
            <div className="absolute inset-0 bg-canvas/80 flex items-center justify-center z-10">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-ink-secondary">Loading map data...</span>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 px-4 py-2 rounded-lg text-xs shadow-lg flex items-center gap-2">
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              {error}
            </div>
          )}

          {/* Map legend */}
          <div className="absolute bottom-4 left-4 z-10 bg-white dark:bg-zinc-900 rounded-lg shadow-lg border border-line px-3 py-2.5 flex flex-col gap-2">
            <div className="flex gap-4">
              {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                <div key={key} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full" style={{ background: cfg.color }} />
                  <span className="text-2xs text-ink-secondary font-medium">{cfg.label}</span>
                </div>
              ))}
            </div>
            {showRoutes && (
              <div className="flex items-center gap-1.5 border-t border-line/60 pt-1.5">
                {/* Dashed line icon */}
                <svg className="w-6 h-3 shrink-0" viewBox="0 0 24 4">
                  <line x1="0" y1="2" x2="8" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2"/>
                  <line x1="10" y1="2" x2="18" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2"/>
                  <line x1="20" y1="2" x2="24" y2="2" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2"/>
                </svg>
                <span className="text-2xs text-ink-tertiary">Vendor → Customer</span>
              </div>
            )}
          </div>
        </div>

        {/* ─── Sidebar ─────────────────────────────────────────── */}
        <aside className="w-80 bg-raised border-l border-line flex flex-col shrink-0">
          {/* Summary cards */}
          <div className="p-3 border-b border-line grid grid-cols-4 gap-1.5">
            {(['PENDING', 'ACCEPTED', 'PACKED', 'SHIPPED'] as const).map(status => {
              const cfg = STATUS_CONFIG[status]
              const count = summary ? summary[status.toLowerCase() as keyof LiveMapSummary] as number : 0
              const isActive = statusFilter === status

              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(isActive ? null : status)}
                  className={`
                    rounded-lg p-2.5 text-center border transition-all
                    ${cfg.bg} ${cfg.border}
                    ${isActive ? 'ring-2 ring-offset-1 dark:ring-offset-zinc-900' : ''}
                  `}
                  style={isActive ? { outlineColor: cfg.color, outlineWidth: '2px', outlineStyle: 'solid', outlineOffset: '1px' } : {}}
                >
                  <div className="text-xl font-bold" style={{ color: cfg.color }}>{count}</div>
                  <div className="text-2xs font-medium text-ink-secondary mt-0.5">{cfg.label}</div>
                </button>
              )
            })}
          </div>

          {/* Total bar */}
          <div className="px-3 py-2 border-b border-line flex items-center justify-between">
            <span className="text-xs text-ink-secondary font-medium">
              {statusFilter ? STATUS_CONFIG[statusFilter].label : 'All Active'} Orders
            </span>
            <span className="text-xs text-ink-tertiary tabular-nums">
              {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
              {summary && summary.total > summary.withCoordinates && (
                <span className="text-amber-500 ml-1" title="Orders without map coordinates">
                  ({summary.total - summary.withCoordinates} no location)
                </span>
              )}
            </span>
          </div>

          {/* Order list */}
          <div className="flex-1 overflow-y-auto">
            {filteredOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-ink-tertiary px-4 text-center">
                <svg className="w-12 h-12 mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                <p className="text-sm font-medium">No active orders</p>
                <p className="text-2xs mt-1">Orders will appear here when placed</p>
              </div>
            ) : (
              filteredOrders.map(order => {
                const cfg = STATUS_CONFIG[order.state] || STATUS_CONFIG.PENDING
                const isSelected = selectedOrder === order.orderId
                const hasLocation = order.lat != null && order.lng != null
                const hasRoute = hasLocation && order.vendorLat != null && order.vendorLng != null

                return (
                  <button
                    key={order.orderId}
                    onClick={() => handleOrderClick(order)}
                    className={`
                      w-full text-left px-3 py-2.5 border-b border-line/50 transition-colors
                      hover:bg-accent-soft
                      ${isSelected ? 'bg-accent-soft' : ''}
                      ${!hasLocation ? 'opacity-60' : ''}
                    `}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.color }} />
                          <span className="text-xs font-semibold text-ink truncate">
                            #{order.orderId}
                          </span>
                          {!hasLocation && (
                            <span className="text-2xs text-amber-500" title="No location">📍✕</span>
                          )}
                          {showRoutes && hasRoute && (
                            <span
                              className="text-2xs shrink-0"
                              style={{ color: cfg.color }}
                              title="Route available"
                            >
                              ↗
                            </span>
                          )}
                        </div>
                        <p className="text-2xs text-ink-secondary mt-0.5 ml-4 truncate">
                          {order.customerName || 'Unknown'} • {order.vendorName || 'Unknown'}
                        </p>
                        {order.orderDescription && (
                          <p className="text-2xs text-ink-tertiary mt-0.5 ml-4 truncate">
                            {order.orderDescription.slice(0, 40)}{order.orderDescription.length > 40 ? '…' : ''}
                          </p>
                        )}
                      </div>

                      <div className="text-right shrink-0">
                        <span className="text-xs font-bold text-ink">₹{order.totalAmount.toFixed(0)}</span>
                        {order.state === 'PENDING' && (
                          <p className="text-2xs font-semibold mt-0.5" style={{ color: cfg.color }}>
                            {getElapsedTime(order.creationTime)}
                          </p>
                        )}
                        {order.state !== 'PENDING' && order.creationTime && (
                          <p className="text-2xs text-ink-tertiary mt-0.5">
                            {new Date(order.creationTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
