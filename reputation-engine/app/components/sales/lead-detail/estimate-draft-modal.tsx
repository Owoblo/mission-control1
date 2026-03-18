'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { estimateLeadQuote, formatMoney } from '@/lib/sales'
import { DEFAULT_ROOM_OPTIONS } from './helpers'
import type { JobFactors, CRMLead, CRMQuote, InventoryItem, QuoteLineItem } from '@/lib/types'

type RouteResult = {
  distanceKm: number
  distanceMiles: number
  driveHours: number
  category: 'local' | 'medium' | 'long-distance'
  originResolved: string
  destResolved: string
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
  onRecalculate: (driveHours?: number, quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage', distanceKm?: number) => void
  onAddLineItem: () => void
  onSetActivePhotoIndex: (index: number) => void
  onAddPreset: (presetId: string) => void
  onUpdateLineItem: (index: number, field: keyof QuoteLineItem, value: string) => void
  onRemoveLineItem: (index: number) => void
  onSaveDraft: () => void
  onSaveAndPreview: () => void
  onJobFactorsChange: (factors: JobFactors) => void
  onAddInventoryItems: (items: InventoryItem[]) => void
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
  onSaveDraft,
  onSaveAndPreview,
  onJobFactorsChange,
  onAddInventoryItems,
}: Props) {
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [quoteType, setQuoteType] = useState<'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'>(
    lead.quoteType || 'standard'
  )
  const [distanceKm, setDistanceKm] = useState<number>(0)

  // Manual inventory quick-add state
  const [quickRoom, setQuickRoom] = useState('Living Room')
  const [quickItem, setQuickItem] = useState('')
  const [quickQty, setQuickQty] = useState(1)
  const [quickCuFt, setQuickCuFt] = useState('')

  // Auto-calculate route when both origin and destination are present
  const originFull = [originAddress || lead.originAddress, originCity || lead.originCity].filter(Boolean).join(', ')
  const destFull = [destAddress || lead.destAddress, destCity || lead.destCity].filter(Boolean).join(', ')

  useEffect(() => {
    if (!open || !originFull || !destFull) return
    let cancelled = false
    setRouteBusy(true)
    setRouteError(null)
    fetch('/api/sales/route-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ origin: originFull, destination: destFull }),
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

  const pricingBreakdown = useMemo(() => {
    if (!open) return null
    const snapshot = {
      ...lead,
      totalCubicFeet: inventoryMetrics.totalCubicFeet,
      totalWeightLbs: inventoryMetrics.totalWeightLbs,
      moveType: route?.category === 'long-distance' ? ('long-distance' as const) : lead.moveType,
    }
    // Only apply drive time when we have a real route — no phantom defaults
    const driveHours = route?.driveHours ?? (destFull ? undefined : 0)
    return estimateLeadQuote(snapshot, { driveHours }, jobFactors).pricingBreakdown
  }, [open, lead, inventoryMetrics.totalCubicFeet, inventoryMetrics.totalWeightLbs, jobFactors, route])

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
                  {route.distanceKm} km · {route.driveHours}h drive · {route.category === 'local' ? 'Local' : route.category === 'medium' ? 'Medium Distance' : 'Long Distance'}
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
                      onRecalculate(route?.driveHours, opt.id, distanceKm || undefined)
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
            </div>

            {/* Addresses */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="crm-kpi">
                <div className="crm-label">Origin Address</div>
                <input value={originAddress} onChange={e => onOriginAddressChange(e.target.value)} className="mt-3 crm-input" placeholder="Search or enter origin address" />
                <input value={originCity} onChange={e => onOriginCityChange(e.target.value)} className="mt-2 crm-input" placeholder="Origin city" />
                <button onClick={onLookupListing} disabled={listingLookupBusy} className="mt-3 crm-button disabled:opacity-60">
                  {listingLookupBusy ? 'Matching...' : 'Match Listing'}
                </button>
              </div>
              <div className="crm-kpi">
                <div className="crm-label">Destination + Scope</div>
                <input value={destAddress} onChange={e => onDestAddressChange(e.target.value)} className="mt-3 crm-input" placeholder="Destination address" />
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
                            <div key={el.index} className="flex items-center justify-between gap-2 text-xs text-[var(--app-muted)]">
                              <span className="text-[var(--app-ink)]">{el.item.name || el.item.item}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span>×{el.item.qty || 1}</span>
                                {el.item.cubicFeet ? <span>{((el.item.cubicFeet || 0) * (el.item.qty || 1)).toFixed(0)} cu ft</span> : null}
                              </div>
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
                  onClick={() => onRecalculate(route?.driveHours, quoteType, distanceKm || undefined)}
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
                      <div className="mt-1 text-lg font-bold text-[var(--app-ink)]">{formatMoney(quoteModalTotals.subtotal)}</div>
                      <div className="mt-0.5 text-[10px] text-sky-700">
                        {pricingBreakdown?.crewSize} movers · {pricingBreakdown?.totalHours}h · both trucks load in parallel — faster
                      </div>
                    </div>
                    <div className="rounded-[6px] border border-sky-200 bg-white p-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Option B — 1 Truck, 2 Trips</div>
                      <div className="mt-1 text-lg font-bold text-[var(--app-ink)]">{formatMoney(flags.twoTripComparison.totalAmount)}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {flags.twoTripComparison.crewSize} movers · {flags.twoTripComparison.totalHours}h · adds ~{flags.twoTripComparison.extraHours}h return drive
                        {flags.twoTripComparison.savings > 0
                          ? ` · saves client $${flags.twoTripComparison.savings}`
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

                {/* Trucks */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Trucks</div>
                  <div className="text-xs text-[var(--app-muted)] leading-5">
                    System auto-detects based on total volume (1 truck = up to 1,400 cu ft). Override if you already know.
                  </div>
                  <div className="flex gap-2">
                    {[
                      { label: 'Auto', value: undefined },
                      { label: '1 Truck', value: 1 },
                      { label: '2 Trucks', value: 2 },
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
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Disassembly / Reassembly</div>
                  <div className="text-xs text-[var(--app-muted)] leading-5">How many major items need to be taken apart and reassembled? (beds, IKEA wardrobes, wall units, etc.)</div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-[var(--app-muted)]">Number of items</span>
                    <input
                      type="number"
                      min={0}
                      placeholder="0"
                      value={jobFactors.disassemblyItemCount ?? ''}
                      onChange={e => setFactor('disassemblyItemCount', e.target.value ? Number(e.target.value) : undefined)}
                      className="crm-input w-20 py-1 text-right text-xs"
                    />
                  </div>
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
          </div>

          {/* Sidebar */}
          <aside className="border-t border-[var(--app-line)] bg-[var(--app-bg)] p-4 md:p-6 xl:border-l xl:border-t-0 space-y-6">

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
                  {route && (
                    <div className="flex justify-between text-xs">
                      <span className="text-[var(--app-muted)]">Distance</span>
                      <span className={`font-medium ${route.category === 'local' ? 'text-emerald-700' : route.category === 'medium' ? 'text-amber-700' : 'text-rose-700'}`}>
                        {route.distanceKm} km · {route.driveHours}h · {route.category === 'local' ? 'Local' : route.category === 'medium' ? 'Medium' : 'Long Dist.'}
                      </span>
                    </div>
                  )}

                  {pricingBreakdown.penalties.filter(p => !p.isFlagOnly && p.hours > 0).length > 0 && (
                    <div className="border-t border-[var(--app-line)] pt-3 space-y-1.5">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Adjustments Applied</div>
                      {pricingBreakdown.penalties.filter(p => !p.isFlagOnly && p.hours > 0).map((p, i) => (
                        <div key={i} className="flex justify-between gap-2 text-xs">
                          <span className="text-[var(--app-muted)] leading-4">{p.label}</span>
                          <span className="text-amber-700 font-medium whitespace-nowrap">+{p.hours}h</span>
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
                      <span className="text-[var(--app-muted)]">Drive (portal-to-portal)</span>
                      <span className={pricingBreakdown.driveHours === 0 && !destFull ? 'text-amber-600' : 'text-[var(--app-ink)]'}>
                        {pricingBreakdown.driveHours === 0 && !destFull ? '— add destination' : `${pricingBreakdown.driveHours}h`}
                      </span>
                    </div>
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
                      <span className="text-[var(--app-muted)]">10% buffer</span>
                      <span className="text-[var(--app-muted)]">+{pricingBreakdown.bufferHours}h</span>
                    </div>
                    <div className="flex justify-between text-xs font-semibold border-t border-[var(--app-line)] pt-1.5">
                      <span className="text-[var(--app-ink)]">Total estimate</span>
                      <span className="text-[var(--app-ink)]">{pricingBreakdown.totalHours}h (min. 3h)</span>
                    </div>
                  </div>
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
              <div className="mt-6 space-y-3">
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
                Job factors and line items are saved with the draft. The pricing intelligence breakdown explains every adjustment made to the base estimate.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}
