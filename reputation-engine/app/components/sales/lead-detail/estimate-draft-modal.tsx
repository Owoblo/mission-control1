'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { estimateLeadQuote, formatMoney } from '@/lib/sales'
import { DEFAULT_ROOM_OPTIONS } from './helpers'
import { AddressAutocomplete } from '@/app/components/address-autocomplete'
import type { EstimateRouteContext, JobFactors, CRMLead, CRMQuote, InventoryItem, QuoteLineItem } from '@/lib/types'

type RouteResult = {
  pricingStatus: 'ready' | 'provisional'
  category: 'local' | 'medium' | 'long-distance'
  originResolved: string
  destResolved?: string
  yardResolved?: string
  distanceKm?: number
  distanceMiles?: number
  driveHours?: number
  billableDistanceKm?: number
  operationalDistanceKm?: number
  billableDriveHours?: number
  operationalDriveHours?: number
  yardToOrigin?: {
    distanceKm: number
    driveHours: number
  } | null
  originToDestination?: {
    distanceKm: number
    driveHours: number
  } | null
  returnToOrigin?: {
    distanceKm: number
    driveHours: number
  } | null
  missingRequirements?: string[]
}

type GroupedInventory = Array<[string, Array<{ item: InventoryItem; index: number }>]>

type Props = {
  open: boolean
  quote: CRMQuote | null
  lead: CRMLead
  originAddress: string
  originCity: string
  destCity: string
  listingLookupBusy: boolean
  analysisBusy: boolean
  recalculateBusy: boolean
  listingPhotos: string[]
  activePhotoIndex: number
  inventoryMetrics: {
    totalItems: number
    totalCubicFeet: number
    totalWeightLbs: number
  }
  groupedInventory: GroupedInventory
  presetMatches: Array<{ id: string; label: string }>
  quoteLineItems: QuoteLineItem[]
  quoteModalTotals: {
    subtotal: number
    total: number
    deposit: number
  }
  quoteModalBusy: boolean
  jobFactors: JobFactors
  destAddress: string
  onClose: () => void
  onOriginAddressChange: (value: string) => void
  onOriginCityChange: (value: string) => void
  onDestCityChange: (value: string) => void
  onDestAddressChange: (value: string) => void
  onLookupListing: () => void
  onRefreshInventory: () => void
  onRecalculate: (options?: {
    quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
    distanceKm?: number
    routeContext?: EstimateRouteContext
  }) => void
  onAddLineItem: () => void
  onSetActivePhotoIndex: (index: number) => void
  onAddPreset: (presetId: string) => void
  onUpdateLineItem: (index: number, field: keyof QuoteLineItem, value: string) => void
  onRemoveLineItem: (index: number) => void
  onSetLineItems: (items: QuoteLineItem[]) => void
  onSaveDraft: () => void
  onSaveAndPreview: () => void
  onJobFactorsChange: (factors: JobFactors) => void
  onAddInventoryItems: (items: InventoryItem[]) => void
  onUpdateInventoryItem: (index: number, field: keyof InventoryItem, value: string) => void
  onToggleInventoryItem: (index: number) => void
  onRemoveInventoryItem: (index: number) => void
  customerNotes: string
  onCustomerNotesChange: (value: string) => void
}

function Toggle({ label, value, onChange }: { label: string; value: boolean | undefined; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <div className="flex rounded-[6px] border border-[var(--app-line)] overflow-hidden text-[10px] font-semibold">
        <button
          type="button"
          onClick={() => onChange(true)}
          className={`px-2.5 py-1 ${value === true ? 'bg-[var(--app-ink)] text-white' : 'bg-white text-[var(--app-muted)]'}`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onChange(false)}
          className={`px-2.5 py-1 border-l border-[var(--app-line)] ${value === false ? 'bg-[var(--app-ink)] text-white' : 'bg-white text-[var(--app-muted)]'}`}
        >
          No
        </button>
      </div>
    </div>
  )
}

function FloorSelect({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--app-muted)]">{label}</span>
      <select
        value={value ?? 1}
        onChange={e => onChange(Number(e.target.value))}
        className="crm-input w-24 py-1 text-xs"
      >
        {[1, 2, 3, 4, 5].map(n => (
          <option key={n} value={n}>{n === 1 ? '1 – Bungalow' : `${n} storeys`}</option>
        ))}
      </select>
    </div>
  )
}

export function EstimateDraftModal({
  open,
  quote,
  lead,
  originAddress,
  originCity,
  destCity,
  destAddress,
  listingLookupBusy,
  analysisBusy,
  recalculateBusy,
  listingPhotos,
  activePhotoIndex,
  inventoryMetrics,
  groupedInventory,
  presetMatches,
  quoteLineItems,
  quoteModalTotals,
  quoteModalBusy,
  jobFactors,
  onClose,
  onOriginAddressChange,
  onOriginCityChange,
  onDestCityChange,
  onDestAddressChange,
  onLookupListing,
  onRefreshInventory,
  onRecalculate,
  onAddLineItem,
  onSetActivePhotoIndex,
  onAddPreset,
  onUpdateLineItem,
  onRemoveLineItem,
  onSetLineItems,
  onSaveDraft,
  onSaveAndPreview,
  onJobFactorsChange,
  onAddInventoryItems,
  onUpdateInventoryItem,
  onToggleInventoryItem,
  onRemoveInventoryItem,
  customerNotes,
  onCustomerNotesChange,
}: Props) {
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [quoteType, setQuoteType] = useState<'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'>(
    lead.quoteType || 'standard'
  )
  const [distanceKm, setDistanceKm] = useState<number>(0)
  const [manualDriveHours, setManualDriveHours] = useState<number | undefined>(undefined)
  const [bookTodayActive, setBookTodayActive] = useState(false)
  const [tenPctActive, setTenPctActive] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')
  const [overrideReason, setOverrideReason] = useState('relationship')
  const [overrideApplied, setOverrideApplied] = useState(false)

  // Manual inventory quick-add state
  const [quickRoom, setQuickRoom] = useState('Living Room')
  const [quickItem, setQuickItem] = useState('')
  const [quickQty, setQuickQty] = useState(1)
  const [quickCuFt, setQuickCuFt] = useState('')

  // Auto-calculate route when both origin and destination are present
  const originFull = [originAddress || lead.originAddress, originCity || lead.originCity].filter(Boolean).join(', ')
  const destFull = [destAddress || lead.destAddress, destCity || lead.destCity].filter(Boolean).join(', ')

  const routeContext = useMemo<EstimateRouteContext | undefined>(() => {
    if (!originFull) return undefined
    if (!route) {
      if (destFull) return undefined
      return {
        pricingStatus: 'provisional',
        routeCategory: quoteType === 'long_distance' ? 'long-distance' : 'local',
        missingRequirements: ['Destination address or city needed for travel estimate'],
      }
    }
    return {
      pricingStatus: route.pricingStatus,
      routeCategory: route.category,
      billableDriveHours: route.billableDriveHours,
      operationalDriveHours: route.operationalDriveHours,
      originToDestinationHours: route.originToDestination?.driveHours ?? route.driveHours,
      yardToOriginHours: route.yardToOrigin?.driveHours,
      returnTripHours: route.returnToOrigin?.driveHours,
      originToDestinationDistanceKm: route.originToDestination?.distanceKm ?? route.distanceKm,
      yardToOriginDistanceKm: route.yardToOrigin?.distanceKm,
      returnTripDistanceKm: route.returnToOrigin?.distanceKm,
      billableDistanceKm: route.billableDistanceKm,
      operationalDistanceKm: route.operationalDistanceKm,
      missingRequirements: route.missingRequirements,
    }
  }, [destFull, originFull, quoteType, route])

  useEffect(() => {
    if (!open || !originFull) return
    let cancelled = false
    setRouteBusy(true)
    setRouteError(null)
    fetch('/api/sales/route-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: originFull,
        destination: destFull || undefined,
        originCity: originCity || lead.originCity || undefined,
        manualDriveHours: manualDriveHours,
      }),
      credentials: 'include',
    })
      .then(r => r.json())
      .then((data: RouteResult & { error?: string }) => {
        if (cancelled) return
        if (data.error) { setRouteError(data.error); setRoute(null) }
        else setRoute(data)
      })
      .catch(() => { if (!cancelled) setRouteError('Could not calculate route') })
      .finally(() => { if (!cancelled) setRouteBusy(false) })
    return () => { cancelled = true }
  }, [open, originFull, destFull])

  useEffect(() => {
    if (!open) return
    if (routeBusy) return  // wait for route API to settle — prevents provisional→final price flicker
    onRecalculate({
      quoteType,
      distanceKm: distanceKm || route?.distanceKm || undefined,
      routeContext,
    })
  }, [
    open,
    routeBusy,
    originFull,
    quoteType,
    distanceKm,
    route?.pricingStatus,
    route?.category,
    route?.billableDriveHours,
    route?.operationalDriveHours,
    route?.billableDistanceKm,
    route?.operationalDistanceKm,
    route?.originToDestination?.driveHours,
    route?.yardToOrigin?.driveHours,
    route?.returnToOrigin?.driveHours,
    route?.missingRequirements,
    onRecalculate,
    routeContext,
  ])

  const pricingBreakdown = useMemo(() => {
    if (!open) return null
    const snapshot = {
      ...lead,
      totalCubicFeet: inventoryMetrics.totalCubicFeet,
      totalWeightLbs: inventoryMetrics.totalWeightLbs,
      moveType: route?.category === 'long-distance' ? ('long-distance' as const) : lead.moveType,
    }
    return estimateLeadQuote(snapshot, {
      quoteType,
      distanceKm: distanceKm || route?.distanceKm || undefined,
      routeContext,
    }, jobFactors).pricingBreakdown
  }, [open, lead, inventoryMetrics.totalCubicFeet, inventoryMetrics.totalWeightLbs, jobFactors, quoteType, distanceKm, route, routeContext])

  if (!open) return null

  function setFactor<K extends keyof JobFactors>(key: K, value: JobFactors[K]) {
    onJobFactorsChange({ ...jobFactors, [key]: value })
  }

  const hasWarnings = jobFactors.hasHotTub || jobFactors.hasPoolTable
  const flags = pricingBreakdown?.intelligenceFlags
  const needsTwoTrucks = flags?.twoTruckRequired ?? false

  function addQuickItem() {
    if (!quickItem.trim()) return
    const cf = Number(quickCuFt) || 0
    onAddInventoryItems([{
      id: `manual-${Date.now()}`,
      room: quickRoom,
      name: quickItem.trim(),
      item: quickItem.trim(),
      qty: quickQty,
      cubicFeet: cf,
      weightLbs: Math.round(cf * 7),
      included: true,
    }])
    setQuickItem('')
    setQuickQty(1)
    setQuickCuFt('')
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 px-0 py-0 md:px-4 md:py-6" onClick={onClose}>
      <div
        className="mx-auto flex min-h-screen w-full max-w-6xl flex-col overflow-hidden rounded-none border border-[var(--app-line)] bg-[var(--app-panel)] shadow-2xl md:my-4 md:min-h-0 md:rounded-[12px]"
        onClick={event => event.stopPropagation()}
      >
        {/* Price lock warning — quote already accepted */}
        {quote?.status === 'accepted' && (
          <div className="flex items-start gap-2 border-b border-amber-300 bg-amber-50 px-4 py-3 md:px-6">
            <span className="mt-0.5 text-amber-500 text-sm">⚠</span>
            <div className="text-xs text-amber-800">
              <span className="font-semibold">This quote has been accepted by the customer.</span> Any price changes will not automatically notify them. If you need to adjust the price, send the customer a separate update.
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-[var(--app-line)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <div className="crm-label">Estimate Draft</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{quote?.number || 'Preparing draft...'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--app-muted)]">
              <span>{originAddress || originCity || lead.originAddress || lead.originCity || 'Origin TBD'} → {destCity || lead.destCity || 'Destination TBD'}</span>
              <span>· {inventoryMetrics.totalCubicFeet} cu ft · {inventoryMetrics.totalWeightLbs} lbs</span>
              {routeBusy && <span className="text-[10px] text-[var(--app-muted)]">Calculating route...</span>}
              {route && !routeBusy && (
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                  route.category === 'local' ? 'bg-emerald-50 text-emerald-700' :
                  route.category === 'medium' ? 'bg-amber-50 text-amber-700' :
                  'bg-rose-50 text-rose-700'
                }`}>
                  {route.pricingStatus === 'provisional'
                    ? 'Provisional — destination pending'
                    : `${route.billableDistanceKm || route.distanceKm} km billable · ${route.billableDriveHours || route.driveHours}h drive · ${route.category === 'local' ? 'Local' : route.category === 'medium' ? 'Medium Distance' : 'Long Distance'}`
                  }
                </span>
              )}
              {routeError && !routeBusy && <span className="text-[10px] text-rose-500">{routeError}</span>}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {quote ? <Link href={`/sales/quotes/${quote.id}`} className="crm-button w-full sm:w-auto">Open Full Workspace</Link> : null}
            <button onClick={onClose} className="crm-button w-full sm:w-auto">Close</button>
          </div>
        </div>

        <div className="grid xl:grid-cols-[minmax(0,1fr)_340px]">
          {/* Main content */}
          <div className="overflow-y-auto p-4 md:p-6 space-y-6">

            {/* Quote Type Selector */}
            <div>
              <div className="crm-label mb-2">Quote Type</div>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'standard', label: 'Standard Move' },
                  { id: 'labor_only', label: 'Labor Only' },
                  { id: 'packing_only', label: 'Packing Only' },
                  { id: 'long_distance', label: 'Long Distance' },
                  { id: 'storage', label: 'Storage' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => {
                      setQuoteType(opt.id)
                      onRecalculate({
                        quoteType: opt.id,
                        distanceKm: distanceKm || route?.distanceKm || undefined,
                        routeContext,
                      })
                    }}
                    className={quoteType === opt.id
                      ? 'rounded-full px-4 py-1.5 text-sm font-semibold bg-[#1a2744] text-white'
                      : 'rounded-full border border-slate-200 bg-white text-slate-500 px-4 py-1.5 text-sm hover:border-[#1a2744] transition'}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {quoteType === 'long_distance' && (
                <div className="mt-3">
                  <label className="crm-label">Distance (km)</label>
                  <input
                    type="number"
                    value={distanceKm || ''}
                    onChange={e => setDistanceKm(Number(e.target.value))}
                    className="crm-input mt-1 w-full"
                    placeholder="e.g. 450"
                  />
                </div>
              )}
              {/* Manual drive time override — use when Google Maps gives wrong result */}
              <div className="mt-3 flex items-end gap-2">
                <div className="flex-1">
                  <label className="crm-label">Manual Drive Time Override (hrs)</label>
                  <input
                    type="number"
                    step="0.25"
                    min="0"
                    value={manualDriveHours || ''}
                    onChange={e => setManualDriveHours(e.target.value ? Number(e.target.value) : undefined)}
                    className="crm-input mt-1 w-full"
                    placeholder="e.g. 6 — overrides Google Maps"
                  />
                </div>
                {manualDriveHours !== undefined && (
                  <button
                    type="button"
                    onClick={() => setManualDriveHours(undefined)}
                    className="crm-button text-rose-600 hover:bg-rose-50 shrink-0"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Addresses */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="crm-kpi">
                <div className="crm-label">Origin Address</div>
                <AddressAutocomplete
                  value={originAddress}
                  onChange={onOriginAddressChange}
                  onPlaceSelect={(addr, city) => { onOriginAddressChange(addr); if (city) onOriginCityChange(city) }}
                  placeholder="Search or enter origin address"
                  className="mt-3 crm-input"
                />
                <input value={originCity} onChange={e => onOriginCityChange(e.target.value)} className="mt-2 crm-input" placeholder="Origin city" />
                <button onClick={onLookupListing} disabled={listingLookupBusy} className="mt-3 crm-button disabled:opacity-60">
                  {listingLookupBusy ? 'Matching...' : 'Match Listing'}
                </button>
              </div>
              <div className="crm-kpi">
                <div className="crm-label">Destination + Scope</div>
                <AddressAutocomplete
                  value={destAddress}
                  onChange={onDestAddressChange}
                  onPlaceSelect={(addr, city) => { onDestAddressChange(addr); if (city) onDestCityChange(city) }}
                  placeholder="Destination address"
                  className="mt-3 crm-input"
                />
                <input value={destCity} onChange={e => onDestCityChange(e.target.value)} className="mt-2 crm-input" placeholder="Destination city" />
                <div className="mt-3 flex gap-2">
                  <button onClick={onRefreshInventory} disabled={analysisBusy || !lead.supabaseListing?.address} className="crm-button disabled:opacity-60">
                    {analysisBusy ? 'Scanning...' : 'Refresh Inventory'}
                  </button>
                  <button onClick={onAddLineItem} className="crm-button">Add Line Item</button>
                </div>
              </div>
            </div>

            {/* Inventory + Photos */}
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label">Inventory Snapshot</div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="crm-kpi">
                    <div className="crm-label">Items</div>
                    <div className="crm-value">{inventoryMetrics.totalItems}</div>
                  </div>
                  <div className="crm-kpi">
                    <div className="crm-label">Cubic Feet</div>
                    <div className="crm-value">{inventoryMetrics.totalCubicFeet}</div>
                  </div>
                  <div className="crm-kpi">
                    <div className="crm-label">Weight</div>
                    <div className="crm-value">{inventoryMetrics.totalWeightLbs}</div>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  {groupedInventory.length === 0 && (
                    <div className="rounded-[6px] border border-dashed border-[var(--app-line)] px-3 py-3 text-xs text-[var(--app-muted)]">
                      No inventory yet. Add items below or match a listing above.
                    </div>
                  )}
                  {groupedInventory.map(([room, items]) => {
                    const roomCuFt = items.reduce((s, el) => s + (el.item.cubicFeet || 0) * (el.item.qty || 1), 0).toFixed(0)
                    return (
                      <details key={room} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-panel)]">
                        <summary className="flex cursor-pointer items-center justify-between px-3 py-2" style={{ listStyle: 'none' }}>
                          <div className="text-sm font-medium text-[var(--app-ink)]">{room}</div>
                          <div className="text-xs text-[var(--app-muted)]">{items.length} items · {roomCuFt} cu ft</div>
                        </summary>
                        <div className="border-t border-[var(--app-line)] px-3 py-2 space-y-1">
                          {items.map(el => (
                            <div key={el.index} className={`rounded-[6px] border px-2 py-2 text-xs ${el.item.included === false ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-transparent bg-white text-[var(--app-muted)]'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className={`font-medium ${el.item.included === false ? 'text-slate-500 line-through' : 'text-[var(--app-ink)]'}`}>{el.item.name || el.item.item}</span>
                                <div className="flex items-center gap-2 shrink-0">
                                  <input
                                    type="number"
                                    min={1}
                                    value={el.item.qty || 1}
                                    onChange={event => onUpdateInventoryItem(el.index, 'qty', event.target.value)}
                                    className="crm-input h-8 w-16 py-1 text-right text-xs"
                                  />
                                  {el.item.cubicFeet ? <span>{((el.item.cubicFeet || 0) * (el.item.qty || 1)).toFixed(0)} cu ft</span> : null}
                                </div>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => onToggleInventoryItem(el.index)}
                                  className={`rounded-[6px] px-2.5 py-1 text-[10px] font-semibold ${el.item.included === false ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}
                                >
                                  {el.item.included === false ? 'Include Back' : 'Stays Behind'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRemoveInventoryItem(el.index)}
                                  className="rounded-[6px] bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700"
                                >
                                  Remove
                                </button>
                              </div>
                              {el.item.included === false && el.item.exclusionReason ? (
                                <div className="mt-1 text-[10px] text-slate-500">{el.item.exclusionReason}</div>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </details>
                    )
                  })}
                  {/* Quick-add preset buttons — boxes first, then matched presets */}
                  <div className="space-y-2 pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">📦 Boxes — ask every customer</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['box-small','box-medium','box-large','box-xl','tv-box-55','mirror-box'].map(id => {
                        const p = presetMatches.find(x => x.id === id) || { id, label: id }
                        return <button key={id} onClick={() => onAddPreset(id)} className="crm-button text-xs py-1 px-2.5">+ {p.label}</button>
                      })}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] pt-1">🏠 Appliances (opt-in)</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['fridge-standard','fridge-large','stove-freestanding','dishwasher','freezer-standalone','washer-freestanding','dryer-freestanding'].map(id => {
                        const p = presetMatches.find(x => x.id === id) || { id, label: id }
                        return <button key={id} onClick={() => onAddPreset(id)} className="crm-button text-xs py-1 px-2.5">+ {p.label}</button>
                      })}
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] pt-1">🚗 Garage & Outdoor</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['tool-chest','lawn-mower-push','wheelbarrow','bicycle','garage-shelving','barbecue','patio-set','hot-tub','junk-item-large'].map(id => {
                        const p = presetMatches.find(x => x.id === id) || { id, label: id }
                        return <button key={id} onClick={() => onAddPreset(id)} className="crm-button text-xs py-1 px-2.5">+ {p.label}</button>
                      })}
                    </div>
                    {presetMatches.some(p => !['box-small','box-medium','box-large','box-xl','tv-box-55','mirror-box','fridge-standard','fridge-large','stove-freestanding','dishwasher','freezer-standalone','washer-freestanding','dryer-freestanding','tool-chest','lawn-mower-push','wheelbarrow','bicycle','garage-shelving','barbecue','patio-set','hot-tub','junk-item-large'].includes(p.id)) && (
                      <>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] pt-1">🛋️ Furniture</div>
                        <div className="flex flex-wrap gap-1.5">
                          {presetMatches.filter(p => !['box-small','box-medium','box-large','box-xl','tv-box-55','mirror-box','fridge-standard','fridge-large','stove-freestanding','dishwasher','freezer-standalone','washer-freestanding','dryer-freestanding','tool-chest','lawn-mower-push','wheelbarrow','bicycle','garage-shelving','barbecue','patio-set','hot-tub','junk-item-large'].includes(p.id)).map(preset => (
                            <button key={preset.id} onClick={() => onAddPreset(preset.id)} className="crm-button text-xs py-1 px-2.5">+ {preset.label}</button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  {/* Quick-add manual inventory — always visible */}
                  <div className="space-y-3">
                    <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Quick Add Item</div>
                        <div className="grid grid-cols-[1fr_auto] gap-2">
                          <select
                            value={quickRoom}
                            onChange={e => setQuickRoom(e.target.value)}
                            className="crm-input py-1 text-xs"
                          >
                            {DEFAULT_ROOM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={quickQty}
                            onChange={e => setQuickQty(Math.max(1, Number(e.target.value)))}
                            className="crm-input w-14 py-1 text-right text-xs"
                            placeholder="Qty"
                          />
                        </div>
                        <div className="grid grid-cols-[1fr_80px_auto] gap-2">
                          <input
                            value={quickItem}
                            onChange={e => setQuickItem(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addQuickItem()}
                            className="crm-input py-1 text-xs"
                            placeholder="Item name (e.g. Sofa)"
                          />
                          <input
                            type="number"
                            min={0}
                            value={quickCuFt}
                            onChange={e => setQuickCuFt(e.target.value)}
                            className="crm-input py-1 text-right text-xs"
                            placeholder="cu ft"
                          />
                          <button
                            type="button"
                            onClick={addQuickItem}
                            disabled={!quickItem.trim()}
                            className="crm-button-dark text-xs px-3 disabled:opacity-40"
                          >
                            Add
                          </button>
                        </div>
                        <p className="text-[10px] text-[var(--app-muted)]">Leave cu ft blank for common items — weight inferred at 7 lbs/cu ft.</p>
                      </div>
                    </div>
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label">Listing Photos</div>
                {listingPhotos.length > 0 ? (
                  <>
                    <div className="mt-3 overflow-hidden rounded-[8px] border border-[var(--app-line)]">
                      <img src={listingPhotos[activePhotoIndex]} alt="MLS reference" className="h-40 w-full object-cover" />
                    </div>
                    <div className="mt-3 grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                      {listingPhotos.map((photo, index) => (
                        <button key={`${photo}-${index}`} onClick={() => onSetActivePhotoIndex(index)} className={`overflow-hidden rounded-[6px] border ${activePhotoIndex === index ? 'border-[var(--app-ink)]' : 'border-[var(--app-line)]'}`}>
                          <img src={photo} alt={`MLS thumb ${index + 1}`} className="h-14 w-full object-cover" />
                        </button>
                      ))}
                    </div>
                    {listingPhotos.length > 8 && (
                      <div className="mt-1.5 text-[10px] text-[var(--app-muted)] text-right">{listingPhotos.length} photos total</div>
                    )}
                  </>
                ) : (
                  <div className="mt-3 rounded-[6px] border border-dashed border-[var(--app-line)] px-3 py-8 text-sm text-[var(--app-muted)]">
                    No MLS photos linked yet. Add the address to match a listing.
                  </div>
                )}
              </div>
            </div>

            {/* ── JOB FACTORS ── */}
            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <div className="crm-label">Job Factors</div>
                  <div className="mt-0.5 text-xs text-[var(--app-muted)]">Tier 2 details not visible in MLS photos — these directly affect the estimate.</div>
                </div>
                <button
                  onClick={() => onRecalculate({
                    quoteType,
                    distanceKm: distanceKm || route?.distanceKm || undefined,
                    routeContext,
                  })}
                  disabled={recalculateBusy}
                  className="crm-button-dark text-xs disabled:opacity-60"
                >
                  {recalculateBusy ? 'Recalculating...' : '↻ Recalculate'}
                </button>
              </div>

              {/* Intelligence banners */}

              {/* 2-truck vs 2-trip comparison — shows real dollar difference */}
              {(needsTwoTrucks || flags?.twoTripZone) && flags?.twoTripComparison && (
                <div className="mb-3 rounded-[8px] border border-sky-200 bg-sky-50 px-4 py-3">
                  <div className="text-sm font-semibold text-sky-800">
                    🚚 {needsTwoTrucks ? '2 trucks required — or 1 truck + 2 trips?' : '2-trip zone — compare your options'}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-[6px] border-2 border-sky-300 bg-white p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-sky-700">Option A — 2 Trucks</div>
                      <div className="mt-1 text-lg font-bold text-[var(--app-ink)]">{formatMoney(flags.multiTruckOption?.totalAmount ?? quoteModalTotals.subtotal)}</div>
                      <div className="mt-0.5 text-[10px] text-sky-700">
                        {pricingBreakdown?.crewSize} movers · {flags.multiTruckOption?.totalHours ?? pricingBreakdown?.totalHours}h · both trucks load in parallel — faster
                      </div>
                    </div>
                    <div className="rounded-[6px] border border-sky-200 bg-white p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Option B — 1 Truck, 2 Trips</div>
                      <div className="mt-1 text-lg font-bold text-[var(--app-ink)]">{formatMoney(flags.twoTripComparison.totalAmount)}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {flags.twoTripComparison.crewSize} movers · {flags.twoTripComparison.totalHours}h · adds ~{flags.twoTripComparison.extraHours}h return drive
                        {flags.twoTripComparison.savings > 0
                          ? ` · saves client ${formatMoney(flags.twoTripComparison.savings)}`
                          : ' · 2 trucks is more efficient'}
                      </div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-sky-700">
                    {needsTwoTrucks
                      ? 'Inventory exceeds 1 truck (1,400 cu ft safe-load limit). For local moves only — 2 trips is a real option. Long distance must use 2 trucks.'
                      : 'Local move: both options are viable. Discuss with client — time vs. savings.'}
                  </div>
                </div>
              )}

              {/* Full-day + 2-day option with actual hours */}
              {flags?.fullDayFlag && flags?.twoDayMoveEstimate && (
                <div className="mb-3 rounded-[8px] border border-purple-200 bg-purple-50 px-4 py-3">
                  <div className="text-sm font-semibold text-purple-800">📅 Full-day move ({pricingBreakdown?.totalHours}h) — consider 2-day split</div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="rounded-[6px] border border-purple-200 bg-white p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-purple-700">Day 1 — Load</div>
                      <div className="mt-1 text-base font-bold text-[var(--app-ink)]">~{flags.twoDayMoveEstimate.day1Hours}h</div>
                      <div className="mt-0.5 text-[10px] text-purple-700">Pack, wrap, load truck, drive to destination</div>
                    </div>
                    <div className="rounded-[6px] border border-purple-200 bg-white p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-purple-700">Day 2 — Unload</div>
                      <div className="mt-1 text-base font-bold text-[var(--app-ink)]">~{flags.twoDayMoveEstimate.day2Hours}h</div>
                      <div className="mt-0.5 text-[10px] text-purple-700">Unload, unwrap, place, assemble — fresh crew</div>
                    </div>
                  </div>
                  <div className="mt-1.5 text-[10px] text-purple-700">Same total price. Crew arrives fresh on Day 2 — less fatigue, lower damage risk, better customer experience.</div>
                </div>
              )}

              {flags?.threeHourMinApplied && (
                <div className="mb-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <div className="font-semibold">⏱ 3-hour minimum applied</div>
                  <div className="mt-0.5 text-xs">Natural estimate is under 3 hours — billing at the 3-hour floor. Normal for studio or 1BR local moves.</div>
                </div>
              )}

              {flags?.missingDestination && (
                <div className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="font-semibold">Destination still missing</div>
                  <div className="mt-0.5 text-xs">This draft only includes loading, handling, and known access factors. Travel and destination-side work will finalize once the destination is added.</div>
                </div>
              )}

              {flags?.threeTruckReview && (
                <div className="mb-3 rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <div className="font-semibold">3-truck move detected</div>
                  <div className="mt-0.5 text-xs">The load is beyond a standard 2-truck job. Keep the estimate moving, but dispatch or management should review the final truck plan before sending.</div>
                </div>
              )}

              {/* Packing add-on opportunity — with real dollar estimate */}
              {(jobFactors.packingStatus === 'not-started' || jobFactors.packingStatus === 'partial') && flags?.packingDayEstimate && (
                <div className="mb-3 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-sm font-semibold text-emerald-800">📦 Packing day add-on opportunity</div>
                  <div className="mt-1.5 flex items-start justify-between gap-4">
                    <div className="text-xs text-emerald-700">
                      Customer {jobFactors.packingStatus === 'not-started' ? "hasn't started packing" : 'is only partially packed'}.
                      Packing happens the day before the move — separate charge.
                      <br />
                      <span className="mt-0.5 block font-medium">
                        Estimated: {flags.packingDayEstimate.crewSize} packers · ~{flags.packingDayEstimate.hours}h ·{' '}
                        <span className="text-emerald-900">{formatMoney(flags.packingDayEstimate.amountBeforeHst)} + HST = {formatMoney(flags.packingDayEstimate.total)}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const packingItem = {
                          description: 'Professional Packing Service (Day Before Move)',
                          details: `${flags.packingDayEstimate!.crewSize} packers · ~${flags.packingDayEstimate!.hours}h · all packing materials included`,
                          amount: flags.packingDayEstimate!.amountBeforeHst,
                        }
                        onAddInventoryItems([])  // trigger re-render
                        onUpdateLineItem(-1, 'description', '')  // no-op placeholder
                        // Add as a real line item via the onSaveDraft path — use onRecalculate workaround
                        // Actually append via the quoteLineItems path through onAddLineItem then onUpdateLineItem
                        void (async () => {
                          onAddLineItem()
                          await new Promise(r => setTimeout(r, 50))
                          const last = quoteLineItems.length
                          onUpdateLineItem(last, 'description', packingItem.description)
                          onUpdateLineItem(last, 'details', packingItem.details)
                          onUpdateLineItem(last, 'amount', String(packingItem.amount))
                        })()
                      }}
                      className="shrink-0 rounded-[6px] bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800"
                    >
                      + Add to Quote
                    </button>
                  </div>
                </div>
              )}

              {hasWarnings && (
                <div className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  ⚠ Items flagged that Saturn Star does not move. Confirm with customer and arrange third-party movers.
                </div>
              )}

              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">

                {/* Origin Access */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Origin Access</div>
                  <FloorSelect label="Floors at origin" value={jobFactors.originFloors} onChange={v => setFactor('originFloors', v)} />
                  <Toggle label="Has elevator?" value={jobFactors.originHasElevator} onChange={v => setFactor('originHasElevator', v)} />
                  {jobFactors.originHasElevator && (
                    <Toggle label="Elevator reserved?" value={jobFactors.originElevatorReserved} onChange={v => setFactor('originElevatorReserved', v)} />
                  )}
                  <Toggle label="Direct truck access?" value={jobFactors.originParkingOk} onChange={v => setFactor('originParkingOk', v)} />
                </div>

                {/* Destination Access */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Destination Access</div>
                  <FloorSelect label="Floors at destination" value={jobFactors.destFloors} onChange={v => setFactor('destFloors', v)} />
                  <Toggle label="Has elevator?" value={jobFactors.destHasElevator} onChange={v => setFactor('destHasElevator', v)} />
                  {jobFactors.destHasElevator && (
                    <Toggle label="Elevator reserved?" value={jobFactors.destElevatorReserved} onChange={v => setFactor('destElevatorReserved', v)} />
                  )}
                  <Toggle label="Direct truck access?" value={jobFactors.destParkingOk} onChange={v => setFactor('destParkingOk', v)} />
                </div>

                {/* Packing Status */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Packing Status</div>
                  <div className="flex flex-col gap-1.5">
                    {(['packed', 'partial', 'not-started'] as const).map(status => (
                      <button
                        key={status}
                        type="button"
                        onClick={() => setFactor('packingStatus', status)}
                        className={`rounded-[6px] border px-3 py-2 text-left text-xs font-medium ${
                          jobFactors.packingStatus === status
                            ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                            : 'border-[var(--app-line)] bg-white text-[var(--app-muted)]'
                        }`}
                      >
                        {status === 'packed' ? 'Fully packed' : status === 'partial' ? 'Partially packed' : 'Not started'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Boxes — always ask */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Boxes</div>
                  <div className="text-xs text-[var(--app-muted)] leading-5">Always ask — boxes are the most commonly missed volume. Each standard box = ~1.5 cu ft.</div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-medium text-[var(--app-ink)]">Box count</span>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={jobFactors.estimatedBoxes ?? ''}
                      onChange={e => setFactor('estimatedBoxes', e.target.value ? Number(e.target.value) : undefined)}
                      className="crm-input w-24 py-1.5 text-right text-sm font-semibold"
                    />
                  </div>
                  {(jobFactors.estimatedBoxes || 0) > 0 && (
                    <div className="rounded-[6px] bg-[var(--app-bg)] border border-[var(--app-line)] px-3 py-2 text-xs text-[var(--app-muted)]">
                      +{Math.round((jobFactors.estimatedBoxes || 0) * 1.5)} cu ft added to estimate
                    </div>
                  )}
                </div>

                {/* Hidden Inventory */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Hidden Areas (cu ft)</div>
                  {[
                    { label: 'Garage', key: 'garageCubicFeet' as const },
                    { label: 'Basement', key: 'basementCubicFeet' as const },
                    { label: 'Shed', key: 'shedCubicFeet' as const },
                  ].map(({ label, key }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-xs text-[var(--app-muted)]">{label}</span>
                      <input
                        type="number"
                        min={0}
                        placeholder="0"
                        value={jobFactors[key] ?? ''}
                        onChange={e => setFactor(key, e.target.value ? Number(e.target.value) : undefined)}
                        className="crm-input w-20 py-1 text-right text-xs"
                      />
                    </div>
                  ))}
                </div>

                {/* Specialty Items */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Specialty Items</div>
                  {[
                    { label: 'Piano (we can move)', key: 'hasPiano' as const, warning: false },
                    { label: 'Heavy safe (we have dolly)', key: 'hasSafe' as const, warning: false },
                    { label: 'Hot tub — DO NOT MOVE', key: 'hasHotTub' as const, warning: true },
                    { label: 'Pool table — DO NOT MOVE', key: 'hasPoolTable' as const, warning: true },
                  ].map(({ label, key, warning }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!jobFactors[key]}
                        onChange={e => setFactor(key, e.target.checked || undefined)}
                        className="h-3.5 w-3.5 rounded"
                      />
                      <span className={`text-xs ${warning ? 'text-amber-700 font-medium' : 'text-[var(--app-muted)]'}`}>{label}</span>
                    </label>
                  ))}
                </div>

                {/* Crew Size */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Crew Size</div>
                  <div className="text-xs text-[var(--app-muted)] leading-5">
                    Auto-calculates from volume and weight. Override to lock in a specific crew for this job.
                  </div>
                  <div className="flex gap-2">
                    {[
                      { label: 'Auto', value: undefined },
                      { label: '2', value: 2 },
                      { label: '3', value: 3 },
                      { label: '4', value: 4 },
                      { label: '5', value: 5 },
                    ].map(opt => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => setFactor('crewSizeOverride', opt.value)}
                        className={`rounded-[6px] border px-3 py-2 text-xs font-medium flex-1 ${
                          jobFactors.crewSizeOverride === opt.value
                            ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                            : 'border-[var(--app-line)] bg-white text-[var(--app-muted)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trucks */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Trucks</div>
                  <div className="text-xs text-[var(--app-muted)] leading-5">
                    System auto-detects based on safe load and weight. Override only if dispatch already knows the right setup.
                  </div>
                  <div className="flex gap-2">
                    {[
                      { label: 'Auto', value: undefined },
                      { label: '1 Truck', value: 1 },
                      { label: '2 Trucks', value: 2 },
                      { label: '3 Trucks', value: 3 },
                    ].map(opt => (
                      <button
                        key={String(opt.value)}
                        type="button"
                        onClick={() => setFactor('truckCountOverride', opt.value)}
                        className={`rounded-[6px] border px-3 py-2 text-xs font-medium flex-1 ${
                          jobFactors.truckCountOverride === opt.value
                            ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                            : 'border-[var(--app-line)] bg-white text-[var(--app-muted)]'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Disassembly */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Disassembly / Reassembly</div>
                    <button
                      type="button"
                      onClick={() => setFactor('disassemblyItemCount', jobFactors.disassemblyItemCount === 0 ? undefined : 0)}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${jobFactors.disassemblyItemCount === 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700 hover:bg-rose-50 hover:text-rose-600'}`}
                    >
                      {jobFactors.disassemblyItemCount === 0 ? 'Excluded' : 'Included'}
                    </button>
                  </div>
                  {jobFactors.disassemblyItemCount === 0 ? (
                    <div className="rounded-[6px] bg-rose-50 px-3 py-2 text-xs text-rose-700">Customer will self-disassemble — no crew time added.</div>
                  ) : (
                    <>
                      <div className="text-xs text-[var(--app-muted)] leading-5">Count only freestanding assemblies that truly come apart: beds, dining tables, hutches, trampolines. Built-ins and wall-mounted pieces stay with the house.</div>
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs text-[var(--app-muted)]">Number of items</span>
                        <input
                          type="number"
                          min={0}
                          placeholder="auto"
                          value={jobFactors.disassemblyItemCount ?? ''}
                          onChange={e => setFactor('disassemblyItemCount', e.target.value ? Number(e.target.value) : undefined)}
                          className="crm-input w-20 py-1 text-right text-xs"
                        />
                      </div>
                    </>
                  )}
                  <textarea
                    rows={2}
                    placeholder="Any other specialty notes..."
                    value={jobFactors.specialtyNotes ?? ''}
                    onChange={e => setFactor('specialtyNotes', e.target.value || undefined)}
                    className="crm-input w-full resize-none text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="mb-4 crm-label">Estimate Line Items</div>
              <div className="space-y-3">
                {quoteLineItems.map((item, index) => (
                  <div key={`${item.description}-${index}`} className="grid gap-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_140px_44px]">
                    <input value={item.description} onChange={e => onUpdateLineItem(index, 'description', e.target.value)} className="crm-input" placeholder="Line item" />
                    <input value={item.details || ''} onChange={e => onUpdateLineItem(index, 'details', e.target.value)} className="crm-input" placeholder="Details" />
                    <input type="number" value={item.amount} onChange={e => onUpdateLineItem(index, 'amount', e.target.value)} className="crm-input text-right" placeholder="Amount" />
                    <button onClick={() => onRemoveLineItem(index)} className="crm-button justify-center text-rose-700 hover:bg-rose-50">×</button>
                  </div>
                ))}
                {quoteLineItems.length === 0 ? (
                  <div className="rounded-[8px] border border-dashed border-[var(--app-line)] px-4 py-12 text-center text-sm text-[var(--app-muted)]">
                    No draft line items yet. Set job factors and click Recalculate, or create the draft first.
                  </div>
                ) : null}
              </div>
            </div>

            {/* Customer Notes / Extras */}
            <div>
              <div className="mb-2 crm-label">Notes &amp; Extras for Customer</div>
              <textarea
                rows={3}
                placeholder="e.g. Junk removal included, TV boxes provided, piano wrap included — shown on the customer's quote"
                value={customerNotes}
                onChange={e => onCustomerNotesChange(e.target.value)}
                className="crm-input w-full resize-none text-sm"
              />
              <div className="mt-1 text-[10px] text-[var(--app-muted)]">Shown on the customer-facing quote below the pricing summary.</div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="border-t border-[var(--app-line)] bg-[var(--app-bg)] p-4 md:p-6 xl:border-l xl:border-t-0 space-y-6">

            {/* ── MOVE BREAKDOWN ── */}
            {pricingBreakdown ? (
              <div>
                <div className="crm-label mb-3">Move Breakdown</div>
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white divide-y divide-[var(--app-line)] text-xs overflow-hidden">

                  {/* Foundation */}
                  <div className="px-3 py-2.5 bg-slate-50">
                    <div className="font-semibold text-[var(--app-ink)]">{inventoryMetrics.totalCubicFeet} cu ft · {inventoryMetrics.totalWeightLbs.toLocaleString()} lbs</div>
                    <div className="text-[var(--app-muted)] mt-0.5">{inventoryMetrics.totalItems} items across all rooms</div>
                  </div>

                  {/* BASE LABOR */}
                  <div className="px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--app-ink)] uppercase tracking-wide text-[10px]">Base Labor</span>
                      <span className="font-semibold text-[var(--app-ink)]">{pricingBreakdown.loadHours + pricingBreakdown.unloadHours}h</span>
                    </div>
                    <div className="flex justify-between text-[var(--app-muted)]">
                      <span>Load (wrap + carry + load)</span>
                      <span>~{pricingBreakdown.loadHours}h</span>
                    </div>
                    <div className="flex justify-between text-[var(--app-muted)]">
                      <span>Unload (carry + unwrap + place)</span>
                      <span>~{pricingBreakdown.unloadHours}h</span>
                    </div>
                  </div>

                  {/* OUTER — TRAVEL */}
                  <div className="px-3 py-2.5 space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sky-700 uppercase tracking-wide text-[10px]">Outer — Travel & Access</span>
                      <span className="font-semibold text-sky-700">{pricingBreakdown.driveHours > 0 ? `+${pricingBreakdown.driveHours}h` : '—'}</span>
                    </div>
                    {route?.yardToOrigin && (
                      <div className="flex justify-between text-[var(--app-muted)]">
                        <span>Yard → Origin ({route.yardToOrigin.distanceKm} km)</span>
                        <span>{route.yardToOrigin.driveHours}h</span>
                      </div>
                    )}
                    {route?.originToDestination && (
                      <div className="flex justify-between text-[var(--app-muted)]">
                        <span>Origin → Dest ({route.originToDestination.distanceKm} km)</span>
                        <span>{route.originToDestination.driveHours}h</span>
                      </div>
                    )}
                    {route?.returnToOrigin && (
                      <div className="flex justify-between text-[var(--app-muted)]">
                        <span>Return to yard ({route.returnToOrigin.distanceKm} km)</span>
                        <span>{route.returnToOrigin.driveHours}h</span>
                      </div>
                    )}
                    {!route && pricingBreakdown.driveHours === 0 && (
                      <div className="text-amber-600">Add destination to calculate travel</div>
                    )}
                    {/* Floor / elevator access penalties */}
                    {pricingBreakdown.adjustmentBreakdown.filter(a => a.category === 'access').map((a, i) => (
                      <div key={i} className="flex justify-between text-sky-600">
                        <span>{a.label}</span>
                        <span>{a.hours > 0 ? `+${a.hours}h` : 'flagged'}</span>
                      </div>
                    ))}
                  </div>

                  {/* INNER — ON-SITE SCOPE */}
                  {(pricingBreakdown.disassemblyItems.length > 0 || pricingBreakdown.specialtyItemFlags.length > 0 || pricingBreakdown.adjustmentBreakdown.some(a => a.category === 'disassembly' || a.category === 'specialty' || a.category === 'packing')) && (
                    <div className="px-3 py-2.5 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-amber-700 uppercase tracking-wide text-[10px]">Inner — On-site Scope</span>
                        <span className="font-semibold text-amber-700">
                          +{pricingBreakdown.adjustmentBreakdown.filter(a => a.category === 'disassembly' || a.category === 'specialty' || a.category === 'packing').reduce((s, a) => s + a.hours, 0)}h
                        </span>
                      </div>
                      {pricingBreakdown.disassemblyItems.length > 0 && (
                        <>
                          <div className="flex justify-between text-amber-600">
                            <span>Disassembly ({pricingBreakdown.disassemblyItems.length} items)</span>
                            <span>+{pricingBreakdown.adjustmentBreakdown.find(a => a.category === 'disassembly')?.hours ?? 0}h</span>
                          </div>
                          <div className="text-[10px] text-[var(--app-muted)] leading-4 pl-2">
                            {pricingBreakdown.disassemblyItems.join(' · ')}
                          </div>
                        </>
                      )}
                      {pricingBreakdown.specialtyItemFlags.map((item, i) => (
                        <div key={i} className="flex justify-between text-amber-600">
                          <span>{item}</span>
                          <span className="text-[var(--app-muted)]">specialty</span>
                        </div>
                      ))}
                      {pricingBreakdown.adjustmentBreakdown.filter(a => a.category === 'packing').map((a, i) => (
                        <div key={i} className="flex justify-between text-amber-600">
                          <span>{a.label}</span>
                          <span>+{a.hours}h</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* BUFFERS */}
                  <div className="px-3 py-2.5 space-y-1">
                    <div className="flex justify-between text-[var(--app-muted)]">
                      <span className="uppercase tracking-wide text-[10px]">Buffers</span>
                      <span>+{pricingBreakdown.bufferHours}h</span>
                    </div>
                  </div>

                  {/* TOTAL */}
                  <div className="px-3 py-3 bg-[#1a2744] text-white space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span>{pricingBreakdown.crewSize} movers · {pricingBreakdown.truckCount} truck{pricingBreakdown.truckCount > 1 ? 's' : ''} · ${pricingBreakdown.crewRatePerHour}/hr</span>
                      <span>{pricingBreakdown.totalHours}h</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-[#f5a623]">
                      <span>Estimate</span>
                      <span>{formatMoney(pricingBreakdown.totalHours * pricingBreakdown.crewRatePerHour)}</span>
                    </div>
                  </div>
                </div>

                {/* Plain English — Why This Price */}
                {(() => {
                  const baseH = pricingBreakdown.loadHours + pricingBreakdown.unloadHours
                  const driveH = pricingBreakdown.driveHours
                  const innerH = pricingBreakdown.adjustmentBreakdown.filter(a => a.category === 'disassembly' || a.category === 'specialty').reduce((s,a) => s + a.hours, 0)
                  const disItems = pricingBreakdown.disassemblyItems.slice(0, 3).join(', ')
                  const twoTruck = pricingBreakdown.truckCount >= 2
                  return (
                    <div className="mt-3 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 leading-5">
                      <div className="font-semibold text-slate-800 mb-1">Why this price</div>
                      Loading and unloading {inventoryMetrics.totalCubicFeet} cu ft takes ~{baseH}h base.
                      {innerH > 0 && disItems && ` Disassembly of ${pricingBreakdown.disassemblyItems.length} items (${disItems}) adds ${innerH}h.`}
                      {driveH > 0 && ` Travel adds ${driveH}h (${pricingBreakdown.billableDistanceKm ?? '?'} km).`}
                      {twoTruck && ` Two trucks load in parallel — same crew, faster for the customer.`}
                    </div>
                  )
                })()}
              </div>
            ) : null}

            {/* ── SCOPE OF WORK ── */}
            {pricingBreakdown ? (
              <div>
                <div className="crm-label mb-3">Scope of Work</div>
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-1.5 text-xs text-emerald-800">
                  <div>✓ Moving {inventoryMetrics.totalItems} items ({inventoryMetrics.totalCubicFeet} cu ft)</div>
                  <div>✓ Wrapping + padding all furniture</div>
                  {pricingBreakdown.disassemblyItems.length > 0 && (
                    <div>✓ Disassembly + reassembly: {pricingBreakdown.disassemblyItems.join(', ')}</div>
                  )}
                  {pricingBreakdown.specialtyItemFlags.map((item, i) => (
                    <div key={i}>✓ Specialty handling: {item}</div>
                  ))}
                  {/* Boxes from inventory */}
                  {(() => {
                    const inventory = lead.inventory || []
                    const boxSummary: string[] = []
                    const smallBoxes = inventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('small box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const medBoxes = inventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('medium box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const largeBoxes = inventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('large box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const xlBoxes = inventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('xl box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const tvBoxes = inventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('tv box')).reduce((s, i) => s + (i.qty || 1), 0)
                    if (smallBoxes > 0) boxSummary.push(`${smallBoxes} small`)
                    if (medBoxes > 0) boxSummary.push(`${medBoxes} medium`)
                    if (largeBoxes > 0) boxSummary.push(`${largeBoxes} large`)
                    if (xlBoxes > 0) boxSummary.push(`${xlBoxes} XL`)
                    if (tvBoxes > 0) boxSummary.push(`${tvBoxes} TV box${tvBoxes > 1 ? 'es' : ''}`)
                    if (boxSummary.length === 0) return null
                    return <div>✓ Boxes included: {boxSummary.join(', ')}</div>
                  })()}
                  {pricingBreakdown.pricingStatus === 'provisional' && (
                    <div className="text-amber-700 mt-1">⚠ Travel time provisional — add destination address</div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Pricing Intelligence */}
            {pricingBreakdown ? (
              <div>
                <div className="crm-label mb-3">Pricing Intelligence</div>
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-4 space-y-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-muted)]">Inventory</span>
                    <span className="font-medium text-[var(--app-ink)]">{pricingBreakdown.baseCubicFeet} cu ft</span>
                  </div>
                  {pricingBreakdown.extraCubicFeet > 0 && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">+ Hidden areas / boxes</span>
                      <span className="font-medium text-amber-700">+{pricingBreakdown.extraCubicFeet} cu ft</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs border-t border-[var(--app-line)] pt-2">
                    <span className="text-[var(--app-muted)]">Total volume</span>
                    <span className="font-semibold text-[var(--app-ink)]">{pricingBreakdown.totalCubicFeet} cu ft</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-muted)]">Crew</span>
                    <span className="font-medium text-[var(--app-ink)]">{pricingBreakdown.crewSize} movers @ ${pricingBreakdown.crewRatePerHour}/hr</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-muted)]">Trucks</span>
                    <span className="font-medium text-[var(--app-ink)]">{pricingBreakdown.truckCount} × {pricingBreakdown.totalCubicFeet >= 800 ? '26ft' : '20ft'}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-muted)]">Trip strategy</span>
                    <span className="font-medium text-[var(--app-ink)]">
                      {pricingBreakdown.tripStrategy === 'single_truck'
                        ? '1 truck · 1 trip'
                        : pricingBreakdown.tripStrategy === 'single_truck_two_trips'
                          ? '1 truck · 2 trips'
                          : pricingBreakdown.tripStrategy === 'three_trucks'
                            ? '3 trucks'
                            : '2 trucks'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-[var(--app-muted)]">Pricing status</span>
                    <span className={`font-medium ${pricingBreakdown.pricingStatus === 'ready' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {pricingBreakdown.pricingStatus === 'ready' ? 'Ready to send' : 'Provisional'}
                    </span>
                  </div>
                  {route && (
                    <>
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--app-muted)]">Billable distance</span>
                        <span className={`font-medium ${route.category === 'local' ? 'text-emerald-700' : route.category === 'medium' ? 'text-amber-700' : 'text-rose-700'}`}>
                          {pricingBreakdown.billableDistanceKm ?? 0} km · {pricingBreakdown.driveHours}h
                        </span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--app-muted)]">Operational distance</span>
                        <span className="font-medium text-[var(--app-ink)]">
                          {pricingBreakdown.operationalDistanceKm ?? 0} km · {pricingBreakdown.operationalDriveHours}h
                        </span>
                      </div>
                    </>
                  )}

                  {pricingBreakdown.adjustmentBreakdown.length > 0 && (
                    <div className="border-t border-[var(--app-line)] pt-3 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Adjustments Applied</div>
                      {pricingBreakdown.adjustmentBreakdown.map((p, i) => (
                        <div key={i} className="flex justify-between gap-2 text-xs">
                          <span className="text-[var(--app-muted)] leading-4">{p.label}</span>
                          <span className="text-amber-700 font-medium whitespace-nowrap">{p.hours > 0 ? `+${p.hours}h` : 'scope'}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {pricingBreakdown.penalties.filter(p => p.hours === 0 && !p.isFlagOnly).length > 0 && (
                    <div className="border-t border-[var(--app-line)] pt-3 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Volume Added</div>
                      {pricingBreakdown.penalties.filter(p => p.hours === 0 && !p.isFlagOnly).map((p, i) => (
                        <div key={i} className="text-xs text-[var(--app-muted)] leading-4">{p.label}</div>
                      ))}
                    </div>
                  )}

                  {pricingBreakdown.penalties.filter(p => p.isFlagOnly).length > 0 && (
                    <div className="border-t border-amber-200 pt-3 space-y-1.5">
                      {pricingBreakdown.penalties.filter(p => p.isFlagOnly).map((p, i) => (
                        <div key={i} className="text-xs text-amber-700 leading-4">{p.label}</div>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-[var(--app-line)] pt-3 space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Loading (wrap + load)</span>
                      <span className="text-[var(--app-ink)]">~{pricingBreakdown.loadHours}h</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Drive (billable)</span>
                      <span className={pricingBreakdown.driveHours === 0 && !destFull ? 'text-amber-600' : 'text-[var(--app-ink)]'}>
                        {pricingBreakdown.driveHours === 0 && !destFull ? '— add destination' : `${pricingBreakdown.driveHours}h`}
                      </span>
                    </div>
                    {pricingBreakdown.operationalDriveHours !== pricingBreakdown.driveHours && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--app-muted)]">Drive (operational)</span>
                        <span className="text-[var(--app-ink)]">{pricingBreakdown.operationalDriveHours}h</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Unloading (unwrap + assemble)</span>
                      <span className="text-[var(--app-ink)]">~{pricingBreakdown.unloadHours}h</span>
                    </div>
                    {pricingBreakdown.penaltyHours > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--app-muted)]">Job factor adjustments</span>
                        <span className="text-amber-700">+{pricingBreakdown.penaltyHours}h</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Load/unload buffer</span>
                      <span className="text-[var(--app-muted)]">+{pricingBreakdown.loadUnloadBufferHours}h</span>
                    </div>
                    {pricingBreakdown.driveBufferHours > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--app-muted)]">Drive buffer</span>
                        <span className="text-[var(--app-muted)]">+{pricingBreakdown.driveBufferHours}h</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Operational hours</span>
                      <span className="text-[var(--app-muted)]">{pricingBreakdown.operationalHours}h</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold border-t border-[var(--app-line)] pt-1.5">
                      <span className="text-[var(--app-ink)]">Total estimate</span>
                      <span className="text-[var(--app-ink)]">{pricingBreakdown.totalHours}h (min. 3h)</span>
                    </div>
                  </div>

                  {route?.yardToOrigin || route?.originToDestination || route?.returnToOrigin ? (
                    <div className="border-t border-[var(--app-line)] pt-3 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Operational Legs</div>
                      {route?.yardToOrigin ? (
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Yard → Origin</span>
                          <span className="text-[var(--app-ink)]">{route.yardToOrigin.distanceKm} km · {route.yardToOrigin.driveHours}h</span>
                        </div>
                      ) : null}
                      {route?.originToDestination ? (
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Origin → Destination</span>
                          <span className="text-[var(--app-ink)]">{route.originToDestination.distanceKm} km · {route.originToDestination.driveHours}h</span>
                        </div>
                      ) : null}
                      {route?.returnToOrigin && pricingBreakdown.routeCategory === 'long-distance' ? (
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Destination → Origin</span>
                          <span className="text-[var(--app-ink)]">{route.returnToOrigin.distanceKm} km · {route.returnToOrigin.driveHours}h</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Live Margin — uses actual quoted revenue, not computed */}
                  {(() => {
                    const ic = pricingBreakdown.internalCostEstimate
                    // Cost of complimentary deals added as $0 line items
                    const DEAL_COSTS: Record<string, number> = {
                      '20 Complimentary Moving Boxes': 30,
                      '40 Complimentary Moving Boxes': 60,
                      '5 Wardrobe Boxes (Complimentary)': 40,
                      'TV Box (Complimentary)': 15,
                      'Mattress Covers (Complimentary)': 10,
                    }
                    const dealCost = quoteLineItems
                      .filter(li => li.amount === 0 || Number(li.amount) === 0)
                      .reduce((s, li) => s + (DEAL_COSTS[li.description] || 0), 0)
                    const actualRevenue = quoteModalTotals.subtotal
                    const rc = (n: number) => Math.round(n * 100) / 100
                    const totalCost = rc(ic.laborCost + ic.truckOpsCost + dealCost)
                    const liveProfit = rc(actualRevenue - totalCost)
                    const liveMargin = actualRevenue > 0 ? Math.round((liveProfit / actualRevenue) * 1000) / 10 : 0
                    const marginColor = liveMargin >= 65 ? 'text-emerald-700' : liveMargin >= 55 ? 'text-amber-700' : 'text-rose-700'
                    const marginBg = liveMargin >= 65 ? 'bg-emerald-500' : liveMargin >= 55 ? 'bg-amber-500' : 'bg-rose-500'
                    return (
                      <div className="border-t border-[var(--app-line)] pt-3 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Live Margin View</div>
                          <div className={`text-[10px] font-bold ${marginColor}`}>{liveMargin.toFixed(1)}%</div>
                        </div>
                        {/* Margin gauge */}
                        <div className="relative h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div className={`absolute inset-y-0 left-0 rounded-full ${marginBg} transition-all`} style={{ width: `${Math.min(100, liveMargin)}%` }} />
                          {/* Target band 65–68% */}
                          <div className="absolute inset-y-0 bg-emerald-200/60 rounded-sm" style={{ left: '65%', width: '3%' }} />
                        </div>
                        <div className="flex justify-between text-[10px] text-[var(--app-muted)]">
                          <span>0%</span>
                          <span className="text-emerald-700 font-semibold">Target 65–68%</span>
                          <span>100%</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Quoted revenue</span>
                          <span className="text-[var(--app-ink)] font-medium">{formatMoney(actualRevenue)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Labor ({pricingBreakdown.crewSize} × $20/hr × {pricingBreakdown.operationalHours}h)</span>
                          <span className="text-[var(--app-ink)]">{formatMoney(ic.laborCost)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Truck daily ({pricingBreakdown.truckCount} × $50)</span>
                          <span className="text-[var(--app-ink)]">{formatMoney(ic.truckDailyCost)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Fuel + mileage ({pricingBreakdown.operationalDistanceKm ?? 0} km)</span>
                          <span className="text-[var(--app-ink)]">{formatMoney(ic.truckFuelMileageCost)}</span>
                        </div>
                        {dealCost > 0 && (
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Complimentary items cost</span>
                            <span className="text-amber-700">{formatMoney(dealCost)}</span>
                          </div>
                        )}
                        <div className="flex justify-between text-xs border-t border-[var(--app-line)] pt-1">
                          <span className="text-[var(--app-muted)]">Total direct cost</span>
                          <span className="text-[var(--app-ink)]">{formatMoney(totalCost)}</span>
                        </div>
                        <div className="flex justify-between text-xs font-semibold">
                          <span className="text-[var(--app-ink)]">Gross profit</span>
                          <span className={liveProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatMoney(liveProfit)}</span>
                        </div>
                        {liveMargin < 65 && actualRevenue > 0 && (
                          <div className="rounded-[6px] bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] text-amber-800">
                            ⚠ Below 65% target — need {formatMoney(Math.max(0, totalCost / 0.35 - actualRevenue))} more or cut costs
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              </div>
            ) : null}

            {/* Draft Summary */}
            <div>
              <div className="crm-label mb-3">Draft Summary</div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-[var(--app-muted)]">Subtotal</div>
                  <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{formatMoney(quoteModalTotals.subtotal)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--app-muted)]">Total (incl. HST)</div>
                  <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{formatMoney(quoteModalTotals.total)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--app-muted)]">Deposit (20%)</div>
                  <div className="mt-1 text-lg font-medium text-[var(--app-ink)]">{formatMoney(quoteModalTotals.deposit)}</div>
                </div>
              </div>
              {/* Discounts & Deals */}
              <div className="mt-4 space-y-2">

                {/* Price Override */}
                {overrideApplied && (
                  <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center justify-between gap-2">
                    <span>⚠ Override active — customer pays {formatMoney(Number(overrideInput) || 0)} total incl. HST</span>
                    <button
                      type="button"
                      onClick={() => {
                        setOverrideApplied(false)
                        setOverrideInput('')
                      }}
                      className="text-[10px] underline"
                    >
                      Clear
                    </button>
                  </div>
                )}

                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="text-xs font-semibold text-[var(--app-ink)]">Price Override</div>
                  <div className="text-[10px] text-[var(--app-muted)] leading-4">Enter the <span className="font-semibold text-[var(--app-ink)]">total the customer pays</span> (incl. HST). Type $6,000 → customer sees $6,000.</div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--app-muted)]">$</span>
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={overrideInput}
                        onChange={e => { setOverrideInput(e.target.value); setOverrideApplied(false) }}
                        placeholder="e.g. 6000"
                        className="crm-input pl-5 w-full text-sm font-semibold"
                      />
                    </div>
                    <select
                      value={overrideReason}
                      onChange={e => setOverrideReason(e.target.value)}
                      className="crm-input text-xs w-36"
                    >
                      <option value="relationship">Relationship</option>
                      <option value="competitor">Match competitor</option>
                      <option value="spot_booking">Spot booking</option>
                      <option value="volume">Volume deal</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  {overrideInput && Number(overrideInput) > 0 && (
                    <div className="text-[10px] text-[var(--app-muted)]">
                      Subtotal: {formatMoney(Math.round(Number(overrideInput) / 1.13 * 100) / 100)} + HST = <span className="font-semibold text-[var(--app-ink)]">{formatMoney(Number(overrideInput))}</span>
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!overrideInput || Number(overrideInput) <= 0}
                    onClick={() => {
                      const total = Math.round(Number(overrideInput) * 100) / 100
                      if (total <= 0) return
                      // Back-calculate subtotal so that subtotal * 1.13 = total
                      const amount = Math.round(total / 1.13 * 100) / 100
                      const reasonLabels: Record<string, string> = {
                        relationship: 'Relationship pricing',
                        competitor: 'Matched competitor quote',
                        spot_booking: 'Spot booking rate',
                        volume: 'Volume discount',
                        other: 'Rep-agreed rate',
                      }
                      onSetLineItems([{
                        description: 'Moving Services — Agreed Rate',
                        details: reasonLabels[overrideReason] || 'Rep-agreed rate',
                        amount,
                      }])
                      setOverrideApplied(true)
                      setBookTodayActive(false)
                      setTenPctActive(false)
                    }}
                    className="w-full rounded-[6px] bg-rose-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-800 disabled:opacity-40 transition"
                  >
                    Apply Override
                  </button>
                </div>

                {/* Book Today Discount */}
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">Book Today — $150 off</div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !bookTodayActive
                        setBookTodayActive(next)
                        if (next) {
                          void (async () => {
                            onAddLineItem()
                            await new Promise(r => setTimeout(r, 50))
                            const last = quoteLineItems.length
                            onUpdateLineItem(last, 'description', 'Early Booking Discount')
                            onUpdateLineItem(last, 'details', 'Book today — price guaranteed until your move date')
                            onUpdateLineItem(last, 'amount', '-150')
                          })()
                        } else {
                          const idx = quoteLineItems.findIndex(li => li.description === 'Early Booking Discount')
                          if (idx >= 0) onRemoveLineItem(idx)
                        }
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${bookTodayActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {bookTodayActive ? 'Active' : 'Off'}
                    </button>
                  </div>
                  {bookTodayActive && (
                    <div className="text-[10px] text-emerald-700">$150 early-booking discount added — holds until move date.</div>
                  )}
                </div>

                {/* 10% Spot Discount */}
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">10% Spot Discount</div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = !tenPctActive
                        setTenPctActive(next)
                        if (next) {
                          const base = quoteLineItems
                            .filter(li => li.description !== '10% Spot Discount' && li.description !== 'Early Booking Discount')
                            .reduce((s, li) => s + Number(li.amount || 0), 0)
                          const discAmt = -(Math.round(Math.max(0, base) * 0.10 * 100) / 100)
                          void (async () => {
                            onAddLineItem()
                            await new Promise(r => setTimeout(r, 50))
                            const last = quoteLineItems.length
                            onUpdateLineItem(last, 'description', '10% Spot Discount')
                            onUpdateLineItem(last, 'details', 'Applied today only')
                            onUpdateLineItem(last, 'amount', String(discAmt))
                          })()
                        } else {
                          const idx = quoteLineItems.findIndex(li => li.description === '10% Spot Discount')
                          if (idx >= 0) onRemoveLineItem(idx)
                        }
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${tenPctActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {tenPctActive ? 'Active' : 'Off'}
                    </button>
                  </div>
                  {tenPctActive && (
                    <div className="text-[10px] text-emerald-700">
                      10% off base price — {formatMoney(Math.abs(quoteLineItems.find(li => li.description === '10% Spot Discount')?.amount ?? 0))} saved.
                    </div>
                  )}
                </div>

                {/* Complimentary Deals */}
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="text-xs font-semibold text-[var(--app-ink)]">Free Add-ons (Deals)</div>
                  <div className="text-[10px] text-[var(--app-muted)] leading-4">Show the customer what they&apos;re getting free. Appears on the quote at $0.</div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { label: '20 Boxes free', desc: '20 Complimentary Moving Boxes', details: 'Small & medium boxes — keep or recycle after your move' },
                      { label: '40 Boxes free', desc: '40 Complimentary Moving Boxes', details: 'Full box kit — small, medium & large' },
                      { label: '5 Wardrobe boxes', desc: '5 Wardrobe Boxes (Complimentary)', details: 'Hanging clothes stay on hangers — no folding needed' },
                      { label: 'TV box', desc: 'TV Box (Complimentary)', details: 'Custom TV box for safe transport' },
                      { label: 'Mattress covers', desc: 'Mattress Covers (Complimentary)', details: 'All mattresses wrapped and protected at no charge' },
                      { label: 'Shrink wrap', desc: 'Shrink Wrap & Moving Blankets (Included)', details: 'All furniture wrapped — no extra charge' },
                    ].map(deal => {
                      const alreadyAdded = quoteLineItems.some(li => li.description === deal.desc)
                      return (
                        <button
                          key={deal.desc}
                          type="button"
                          disabled={alreadyAdded}
                          onClick={() => {
                            void (async () => {
                              onAddLineItem()
                              await new Promise(r => setTimeout(r, 50))
                              const last = quoteLineItems.length
                              onUpdateLineItem(last, 'description', deal.desc)
                              onUpdateLineItem(last, 'details', deal.details)
                              onUpdateLineItem(last, 'amount', '0')
                            })()
                          }}
                          className={`rounded-[6px] px-2.5 py-1 text-[10px] font-semibold transition-colors ${alreadyAdded ? 'bg-emerald-50 text-emerald-600 border border-emerald-200' : 'bg-[var(--app-bg)] text-[var(--app-ink)] border border-[var(--app-line)] hover:border-[var(--app-ink)]'}`}
                        >
                          {alreadyAdded ? '✓ ' : '+ '}{deal.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <button onClick={onSaveAndPreview} disabled={quoteModalBusy || !quote} className="w-full justify-center rounded-[8px] bg-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity">
                  {quoteModalBusy ? 'Saving...' : 'Preview & Send →'}
                </button>
                <button onClick={onSaveDraft} disabled={quoteModalBusy || !quote} className="crm-button-dark w-full justify-center disabled:opacity-60">
                  Save Draft
                </button>
                <button onClick={onClose} disabled={quoteModalBusy} className="crm-button w-full justify-center">
                  Close
                </button>
              </div>
              <p className="mt-4 text-xs leading-6 text-[var(--app-muted)]">
                Job factors and line items are saved with the draft. The pricing intelligence breakdown explains every adjustment made to the base estimate, and the margin panel stays internal only.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
