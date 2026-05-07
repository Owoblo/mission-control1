'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { formatListingPropertySummary } from '@/lib/listing'
import { getQuotedTruckCount } from '@/lib/operations'
import { fetchSalesOverview } from '@/lib/sales-api'
import { estimateLeadQuote, deriveInventoryMetrics, formatMoney, getSalesBranchLabel, isBookedLikeStage, suggestTruckCount } from '@/lib/sales'
import { INVENTORY_PRESETS } from '@/lib/item-presets'
import { getDisassemblyServiceLabel, getIncludedDisassemblyItems } from '@/lib/move-scope'
import { formatMovePolicyCategoryLabel, getMovePolicyFinding, summarizeMovePolicy } from '@/lib/move-policy'
import { getTvBoxMaterialPresetForSize } from '@/lib/packing-materials'
import { DEFAULT_ROOM_OPTIONS } from './helpers'
import type { EstimateRouteContext, JobFactors, CRMLead, CRMQuote, InventoryItem, PricingBreakdown, QuoteLineItem } from '@/lib/types'

// Inline address autocomplete — shares the same API as lead-basics-panel
function AddressAutocompleteInput({ value, placeholder, onSelect }: {
  value: string
  placeholder: string
  onSelect: (address: string, city?: string) => void
}) {
  const [raw, setRaw] = useState(value)
  const [suggestions, setSuggestions] = useState<Array<{ label: string; city?: string; placeType?: string }>>([])
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => { setRaw(value) }, [value])
  useEffect(() => {
    function h(e: MouseEvent) { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  function handleChange(val: string) {
    setRaw(val)
    onSelect(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 4) { setSuggestions([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setFetching(true)
      try {
        const res = await fetch(`/api/sales/address-suggest?q=${encodeURIComponent(val)}`, { credentials: 'include' })
        const data = (await res.json()) as { suggestions?: Array<{ label: string; city?: string; placeType?: string }> }
        const list = data.suggestions || []
        setSuggestions(list)
        if (list.length > 0) setOpen(true)
      } catch { /* ignore */ } finally { setFetching(false) }
    }, 350)
  }
  function select(s: { label: string; city?: string }) {
    setRaw(s.label); setSuggestions([]); setOpen(false); onSelect(s.label, s.city)
  }
  return (
    <div ref={containerRef} className="relative">
      <input value={raw} onChange={e => handleChange(e.target.value)} onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => { if (!open) onSelect(raw) }}
        className="w-full rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)]"
        placeholder={placeholder} autoComplete="off" />
      {fetching && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 block h-3 w-3 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-52 overflow-y-auto rounded-[8px] border border-[var(--app-line)] bg-white shadow-xl">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onMouseDown={() => select(s)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--app-bg)]">
              <span className="text-[10px]">{s.placeType === 'apartment' ? '🏢' : '🏠'}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-[var(--app-ink)]">{s.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
type PackingMaterialsFlag = NonNullable<PricingBreakdown['intelligenceFlags']['packingMaterialsEstimate']>

type QuoteWorkspaceSaveOptions = {
  moveDescription?: string
  internalNotes?: string
}

type QuoteWorkspaceSendOptions = QuoteWorkspaceSaveOptions & {
  provisional?: boolean
  missingItems?: string[]
}

type QuoteReadinessItem = {
  label: string
  ready: boolean
  critical?: boolean
  detail: string
}

type BranchCapacitySnapshot = {
  status: 'ready' | 'unavailable'
  jobsBooked: number
  crewUsed: number
  crewCapacity: number
  crewPct: number
  trucksUsed: number
  truckCapacity: number
  trucksRemaining: number
  risk: 'low' | 'medium' | 'high' | 'unknown'
  note?: string
}

const BRANCH_CAPACITY_ESTIMATES: Record<NonNullable<CRMLead['branch']>, { crew: number; trucks: number }> = {
  windsor: { crew: 16, trucks: 5 },
  waterloo: { crew: 12, trucks: 4 },
  london: { crew: 10, trucks: 3 },
  ottawa: { crew: 10, trucks: 3 },
}

function daysUntilDate(value?: string) {
  if (!value) return null
  const target = new Date(`${value}T12:00:00`).getTime()
  if (!Number.isFinite(target)) return null
  return Math.ceil((target - new Date().setHours(12, 0, 0, 0)) / 86_400_000)
}

function prependUniqueLine(existing: string, nextLine: string) {
  const trimmedLine = nextLine.trim()
  if (!trimmedLine) return existing
  const normalizedExisting = existing.trim()
  if (!normalizedExisting) return trimmedLine
  if (normalizedExisting.includes(trimmedLine)) return normalizedExisting
  return `${trimmedLine}\n${normalizedExisting}`
}

function buildInventorySnapshotCopyText(groupedInventory: GroupedInventory) {
  return groupedInventory
    .map(([room, items]) => {
      const lines = items.map(({ item }) => {
        const qty = Math.max(1, Number(item.qty || 1))
        const label = item.name || item.item || 'Unnamed item'
        const policyFinding = getMovePolicyFinding(item)
        const parts = [`- ${qty} x ${label}`]
        if (item.size?.trim()) parts.push(`(${item.size.trim()})`)
        if (item.notes?.trim()) parts.push(`- ${item.notes.trim()}`)
        if (item.included === false) parts.push('[stays behind]')
        if (item.included !== false && policyFinding) {
          parts.push(`[${formatMovePolicyCategoryLabel(policyFinding.category)}: ${policyFinding.itemLabel}]`)
        }
        return parts.join(' ')
      })
      return [room, ...lines].join('\n')
    })
    .join('\n\n')
}

function uniquePolicyLabels(findings: ReturnType<typeof summarizeMovePolicy>['findings']) {
  return Array.from(new Set(findings.map(finding => finding.itemLabel || finding.label)))
}

function getPackingMaterialsSourceLabel(source: PackingMaterialsFlag['source']) {
  if (source === 'customer_estimate') return 'based on customer / rep box count'
  if (source === 'inventory_boxes') return 'based on boxes already counted in inventory'
  return 'inferred from current inventory volume'
}

function buildPackingMaterialsLineItemDetails(estimate: PackingMaterialsFlag) {
  const highlights = estimate.lines
    .slice(0, 4)
    .map(line => `${line.quantity} ${line.label.toLowerCase()}`)
    .join(', ')
  const remainder = estimate.lines.length > 4 ? ` + ${estimate.lines.length - 4} more items` : ''
  return `~${estimate.plannedBoxes} planned boxes · ${highlights}${remainder} · charge actual used materials, unopened extras credited back`
}

type Props = {
  open: boolean
  quote: CRMQuote | null
  lead: CRMLead
  inventory: InventoryItem[]
  branch?: CRMLead['branch']
  originAddress: string
  originCity: string
  destCity: string
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
  quoteDiscountAmount: number
  quoteDiscountLabel: string
  quoteModalTotals: {
    subtotal: number
    total: number
    deposit: number
  }
  quoteModalBusy: boolean
  jobFactors: JobFactors
  destAddress: string
  onOriginAddressChange?: (v: string) => void
  onOriginCityChange?: (v: string) => void
  onDestAddressChange?: (v: string) => void
  onDestCityChange?: (v: string) => void
  onClose: () => void
  onRecalculate: (options?: {
    quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
    distanceKm?: number
    routeContext?: EstimateRouteContext
  }) => void
  onAddLineItem: () => void
  onSetActivePhotoIndex: (index: number) => void
  onAddPreset: (presetId: string) => void
  onQuoteDiscountAmountChange: (amount: number) => void
  onQuoteDiscountLabelChange: (label: string) => void
  onUpdateLineItem: (index: number, field: keyof QuoteLineItem, value: string) => void
  onRemoveLineItem: (index: number) => void
  onSetLineItems: (items: QuoteLineItem[]) => void
  moveDescription: string
  internalNotes: string
  onMoveDescriptionChange: (v: string) => void
  onInternalNotesChange: (v: string) => void
  onSaveDraft: (options?: QuoteWorkspaceSaveOptions) => Promise<void> | void
  onSaveAndPreview: (options?: QuoteWorkspaceSendOptions) => Promise<void> | void
  onBranchChange?: (value: NonNullable<CRMLead['branch']>) => void
  onJobFactorsChange: (factors: JobFactors) => void
  onAddInventoryItems: (items: InventoryItem[]) => void
  onUpdateInventoryItem: (index: number, field: keyof InventoryItem, value: string) => void
  onToggleInventoryItem: (index: number) => void
  onRemoveInventoryItem: (index: number) => void
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
  inventory,
  branch,
  originAddress,
  originCity,
  destCity,
  destAddress,
  recalculateBusy,
  listingPhotos,
  activePhotoIndex,
  inventoryMetrics,
  groupedInventory,
  presetMatches,
  quoteLineItems,
  quoteDiscountAmount,
  quoteDiscountLabel,
  quoteModalTotals,
  quoteModalBusy,
  jobFactors,
  moveDescription,
  internalNotes,
  onMoveDescriptionChange,
  onInternalNotesChange,
  onClose,
  onRecalculate,
  onAddLineItem,
  onSetActivePhotoIndex,
  onAddPreset,
  onQuoteDiscountAmountChange,
  onQuoteDiscountLabelChange,
  onUpdateLineItem,
  onRemoveLineItem,
  onSetLineItems,
  onSaveDraft,
  onSaveAndPreview,
  onBranchChange,
  onJobFactorsChange,
  onAddInventoryItems,
  onUpdateInventoryItem,
  onToggleInventoryItem,
  onRemoveInventoryItem,
  onOriginAddressChange,
  onOriginCityChange,
  onDestAddressChange,
  onDestCityChange,
}: Props) {
  const currentUser = useCurrentUser()
  const routeSectionRef = useRef<HTMLDivElement | null>(null)
  const manualKmInputRef = useRef<HTMLInputElement | null>(null)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [quoteType, setQuoteType] = useState<'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'>(
    lead.quoteType || 'standard'
  )
  const [localBranch, setLocalBranch] = useState<'windsor' | 'waterloo' | 'london' | 'ottawa'>(lead.branch || 'windsor')
  const [distanceKm, setDistanceKm] = useState<number>(0)
  const [bookTodayActive, setBookTodayActive] = useState(false)
  const [tenPctActive, setTenPctActive] = useState(false)
  const [excludedDisassemblyItems, setExcludedDisassemblyItems] = useState<Set<string>>(new Set())
  const [overrideInput, setOverrideInput] = useState('')
  const [overrideReason, setOverrideReason] = useState('relationship')
  const [overrideApplied, setOverrideApplied] = useState(false)

  // Manual inventory quick-add state
  const [quickRoom, setQuickRoom] = useState('Living Room')
  const [quickItem, setQuickItem] = useState('')
  const [quickQty, setQuickQty] = useState(1)
  const [quickCuFt, setQuickCuFt] = useState('')
  // Preset search
  const [presetSearch, setPresetSearch] = useState('')
  const [inventoryCopyNotice, setInventoryCopyNotice] = useState<string | null>(null)
  const [priceExplanationNotice, setPriceExplanationNotice] = useState<string | null>(null)
  const [sendGuardOpen, setSendGuardOpen] = useState(false)
  const [capacityBusy, setCapacityBusy] = useState(false)
  const [capacitySnapshot, setCapacitySnapshot] = useState<BranchCapacitySnapshot | null>(null)
  const presetSearchResults = useMemo(() => {
    const q = presetSearch.trim().toLowerCase()
    if (!q) return []
    return INVENTORY_PRESETS.filter(p =>
      p.label.toLowerCase().includes(q) ||
      (p.item.name || '').toLowerCase().includes(q) ||
      (p.room || '').toLowerCase().includes(q)
    ).slice(0, 12)
  }, [presetSearch])

  // Auto-calculate route when both origin and destination are present
  // Don't double-append city if it's already in the address (Google Places includes city in the label)
  const originFull = (() => {
    const addr = originAddress || lead.originAddress || ''
    const city = originCity || lead.originCity || ''
    if (!addr && !city) return ''
    if (addr && city && addr.toLowerCase().includes(city.toLowerCase())) return addr
    return [addr, city].filter(Boolean).join(', ')
  })()
  const destFull = (() => {
    const addr = destAddress || lead.destAddress || ''
    const city = destCity || lead.destCity || ''
    if (!addr && !city) return ''
    if (addr && city && addr.toLowerCase().includes(city.toLowerCase())) return addr
    return [addr, city].filter(Boolean).join(', ')
  })()
  const selectedBranch = (branch || localBranch || lead.branch || 'windsor') as 'windsor' | 'waterloo' | 'london' | 'ottawa'
  const baseQuoteSubtotal = useMemo(
    () => quoteLineItems.reduce((sum, item) => {
      const amount = Number(item.amount || 0)
      if (item.description === 'Early Booking Discount' || amount <= 0) return sum
      return sum + amount
    }, 0),
    [quoteLineItems]
  )
  const lineItemDiscountTotal = useMemo(
    () => Math.abs(
      quoteLineItems.reduce((sum, item) => {
        const amount = Number(item.amount || 0)
        return amount < 0 ? sum + amount : sum
      }, 0)
    ),
    [quoteLineItems]
  )
  const tenPctDiscountAmount = useMemo(
    () => Math.round(Math.max(0, baseQuoteSubtotal) * 0.1 * 100) / 100,
    [baseQuoteSubtotal]
  )

  useEffect(() => {
    if (!open) return
    setLocalBranch((branch || lead.branch || 'windsor') as 'windsor' | 'waterloo' | 'london' | 'ottawa')
  }, [branch, lead.branch, open])

  useEffect(() => {
    const hasBookTodayDiscount = quoteLineItems.some(item => item.description === 'Early Booking Discount')
    setBookTodayActive(current => current === hasBookTodayDiscount ? current : hasBookTodayDiscount)
  }, [quoteLineItems])

  useEffect(() => {
    const hasSpotDiscount = quoteDiscountAmount > 0 && (quoteDiscountLabel || '').toLowerCase() === '10% spot discount'.toLowerCase()
    setTenPctActive(current => current === hasSpotDiscount ? current : hasSpotDiscount)
  }, [quoteDiscountAmount, quoteDiscountLabel])

  useEffect(() => {
    if (!tenPctActive) return
    const nextLabel = tenPctDiscountAmount > 0 ? '10% Spot Discount' : ''
    if (quoteDiscountAmount === tenPctDiscountAmount && quoteDiscountLabel === nextLabel) return
    onQuoteDiscountAmountChange(tenPctDiscountAmount)
    onQuoteDiscountLabelChange(nextLabel)
  }, [tenPctActive, tenPctDiscountAmount, quoteDiscountAmount, quoteDiscountLabel, onQuoteDiscountAmountChange, onQuoteDiscountLabelChange])

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
      body: JSON.stringify({ origin: originFull, destination: destFull || undefined, branch: selectedBranch }),
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
  }, [open, originFull, destFull, selectedBranch])

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
    const inventoryMetricsSnapshot = deriveInventoryMetrics(inventory)
    const snapshot = {
      ...lead,
      inventory,  // use live prop so removed/excluded items are reflected immediately
      totalCubicFeet: inventoryMetricsSnapshot.totalCubicFeet,
      totalWeightLbs: inventoryMetricsSnapshot.totalWeightLbs,
      moveType: route?.category === 'long-distance' ? ('long-distance' as const) : lead.moveType,
    }
    return estimateLeadQuote(snapshot, {
      quoteType,
      distanceKm: distanceKm || route?.distanceKm || undefined,
      routeContext,
    }, jobFactors).pricingBreakdown
  }, [open, lead, inventory, jobFactors, quoteType, distanceKm, route, routeContext])

  function setFactor<K extends keyof JobFactors>(key: K, value: JobFactors[K]) {
    onJobFactorsChange({ ...jobFactors, [key]: value })
  }

  function toggleDisassemblyItem(itemName: string) {
    const next = new Set(excludedDisassemblyItems)
    if (next.has(itemName)) {
      next.delete(itemName)
    } else {
      next.add(itemName)
    }
    setExcludedDisassemblyItems(next)
    const totalItems = pricingBreakdown?.disassemblyItems.length ?? 0
    const newCount = Math.max(0, totalItems - next.size)
    onJobFactorsChange({ ...jobFactors, disassemblyItemCount: newCount === 0 && next.size > 0 ? 0 : newCount })
  }

  const effectiveInventoryMetrics = useMemo(() => deriveInventoryMetrics(inventory), [inventory])
  const inventoryPolicySummary = useMemo(() => summarizeMovePolicy(inventory, { moveType: lead.moveType }), [inventory, lead.moveType])
  const blockedPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.blocked), [inventoryPolicySummary.blocked])
  const hazardousPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.hazardous), [inventoryPolicySummary.hazardous])
  const manualReviewPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.manualReview), [inventoryPolicySummary.manualReview])
  const specialtyPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.specialtyFee), [inventoryPolicySummary.specialtyFee])
  const defaultExcludePolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.defaultExclude), [inventoryPolicySummary.defaultExclude])
  const flags = pricingBreakdown?.intelligenceFlags
  const packingMaterialsEstimate = flags?.packingMaterialsEstimate || null
  const packingLaborLineDescription = 'Professional Packing Service (Day Before Move)'
  const packingMaterialsLineDescription = 'Packing Materials Allowance'
  const packingLaborAdded = quoteLineItems.some(item => item.description === packingLaborLineDescription)
  const packingMaterialsAdded = quoteLineItems.some(item => item.description === packingMaterialsLineDescription)
  const needsTwoTrucks = flags?.twoTruckRequired ?? false
  const includedDisassemblyItems = pricingBreakdown
    ? getIncludedDisassemblyItems(pricingBreakdown.disassemblyItems, excludedDisassemblyItems)
    : []
  const disassemblyScopeLabel = getDisassemblyServiceLabel(jobFactors.disassemblyMode)
  const tvRecommendations = useMemo(() => {
    return effectiveInventoryMetrics.inventory
      .filter(item => item.included !== false)
      .filter(item => {
        const lower = (item.name || item.item || '').toLowerCase()
        return lower.includes('tv') && !lower.includes('tv box')
      })
      .map((item, index) => ({
        key: item.id || `${item.name || item.item || 'tv'}-${index}`,
        itemLabel: item.name || item.item || `TV ${index + 1}`,
        sizeLabel: item.size?.trim() || 'Avg 55"',
        recommendedMaterial: getTvBoxMaterialPresetForSize(item.size || item.name || item.notes),
      }))
  }, [effectiveInventoryMetrics.inventory])

  if (!open) return null

  function handleBranchChange(nextBranch: 'windsor' | 'waterloo' | 'london' | 'ottawa') {
    setLocalBranch(nextBranch)
    onBranchChange?.(nextBranch)
  }

  function appendQuoteLineItem(item: QuoteLineItem) {
    onSetLineItems([...quoteLineItems, item])
  }

  function addPackingLaborLineItem() {
    if (!flags?.packingDayEstimate || packingLaborAdded) return
    appendQuoteLineItem({
      description: packingLaborLineDescription,
      details: `${flags.packingDayEstimate.crewSize} packers · ~${flags.packingDayEstimate.hours}h · scheduled separately the day before move`,
      amount: flags.packingDayEstimate.amountBeforeHst,
    })
  }

  function addPackingMaterialsLineItem() {
    if (!packingMaterialsEstimate || packingMaterialsAdded) return
    appendQuoteLineItem({
      description: packingMaterialsLineDescription,
      details: buildPackingMaterialsLineItemDetails(packingMaterialsEstimate),
      amount: packingMaterialsEstimate.subtotal,
    })
  }

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

  async function copyInventorySnapshot() {
    const text = buildInventorySnapshotCopyText(groupedInventory)
    if (!text.trim()) {
      setInventoryCopyNotice('Nothing to copy yet')
      window.setTimeout(() => setInventoryCopyNotice(null), 1800)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setInventoryCopyNotice('Copied')
    } catch {
      setInventoryCopyNotice('Copy failed')
    }
    window.setTimeout(() => setInventoryCopyNotice(null), 1800)
  }

  const listingPropertySummary = formatListingPropertySummary(lead.supabaseListing)
  const selectedMoveDate = quote?.moveDate || lead.moveDate
  const moveDateDaysAway = daysUntilDate(selectedMoveDate)
  const canApproveMarginException = currentUser?.role === 'owner' || currentUser?.role === 'manager'
  const liveMarginSummary = useMemo(() => {
    if (!pricingBreakdown) return null
    const dealCosts: Record<string, number> = {
      '20 Complimentary Moving Boxes': 30,
      '40 Complimentary Moving Boxes': 60,
      '5 Wardrobe Boxes (Complimentary)': 40,
      'TV Box (Complimentary)': 15,
      'Mattress Covers (Complimentary)': 10,
    }
    const dealCost = quoteLineItems
      .filter(item => item.amount === 0 || Number(item.amount) === 0)
      .reduce((sum, item) => sum + (dealCosts[item.description] || 0), 0)
    const actualRevenue = quoteModalTotals.subtotal
    const totalCost = Math.round((pricingBreakdown.internalCostEstimate.laborCost + pricingBreakdown.internalCostEstimate.truckOpsCost + dealCost) * 100) / 100
    const liveProfit = Math.round((actualRevenue - totalCost) * 100) / 100
    const liveMargin = actualRevenue > 0 ? Math.round((liveProfit / actualRevenue) * 1000) / 10 : 0
    return {
      actualRevenue,
      totalCost,
      liveProfit,
      liveMargin,
      marginColor: liveMargin >= 65 ? 'text-emerald-700' : liveMargin >= 55 ? 'text-amber-700' : 'text-rose-700',
      marginBg: liveMargin >= 65 ? 'bg-emerald-500' : liveMargin >= 55 ? 'bg-amber-500' : 'bg-rose-500',
    }
  }, [pricingBreakdown, quoteLineItems, quoteModalTotals.subtotal])
  const bookTodayProjectedMargin = useMemo(() => {
    if (!liveMarginSummary) return null
    const projectedRevenue = Math.max(0, quoteModalTotals.subtotal - (bookTodayActive ? 0 : 150))
    if (projectedRevenue <= 0) return 0
    return Math.round(((projectedRevenue - liveMarginSummary.totalCost) / projectedRevenue) * 1000) / 10
  }, [bookTodayActive, liveMarginSummary, quoteModalTotals.subtotal])
  const tenPctProjectedMargin = useMemo(() => {
    if (!liveMarginSummary) return null
    const projectedRevenue = Math.max(0, quoteModalTotals.subtotal - (tenPctActive ? 0 : tenPctDiscountAmount))
    if (projectedRevenue <= 0) return 0
    return Math.round(((projectedRevenue - liveMarginSummary.totalCost) / projectedRevenue) * 1000) / 10
  }, [liveMarginSummary, quoteModalTotals.subtotal, tenPctActive, tenPctDiscountAmount])
  const overrideProjectedMargin = useMemo(() => {
    if (!liveMarginSummary) return null
    const overrideTotal = Math.round(Number(overrideInput || 0) * 100) / 100
    if (overrideTotal <= 0) return null
    const projectedRevenue = Math.round((overrideTotal / 1.13) * 100) / 100
    if (projectedRevenue <= 0) return 0
    return Math.round(((projectedRevenue - liveMarginSummary.totalCost) / projectedRevenue) * 1000) / 10
  }, [liveMarginSummary, overrideInput])
  const accessConfirmed = Boolean(
    lead.originAccess ||
    lead.destAccess ||
    lead.parkingNotes ||
    jobFactors.originParkingOk !== undefined ||
    jobFactors.destParkingOk !== undefined ||
    jobFactors.originHasElevator !== undefined ||
    jobFactors.destHasElevator !== undefined
  )
  const boxesAsked = Boolean(
    Number(jobFactors.estimatedBoxes || 0) > 0 ||
    packingMaterialsEstimate?.plannedBoxes ||
    effectiveInventoryMetrics.inventory.some(item => (item.name || item.item || '').toLowerCase().includes('box'))
  )
  const quoteExplanation = useMemo(() => {
    if (!pricingBreakdown || quoteModalTotals.total <= 0) {
      return { summary: '', short: '', detailed: '' }
    }
    const inventoryText = `${effectiveInventoryMetrics.totalCubicFeet.toLocaleString('en-CA')} cu ft and ${effectiveInventoryMetrics.totalItems} item${effectiveInventoryMetrics.totalItems === 1 ? '' : 's'}`
    const crewText = `${pricingBreakdown.crewSize} mover${pricingBreakdown.crewSize === 1 ? '' : 's'}`
    const truckText = `${pricingBreakdown.truckCount} truck${pricingBreakdown.truckCount === 1 ? '' : 's'}`
    const hourText = `about ${pricingBreakdown.totalHours} hour${pricingBreakdown.totalHours === 1 ? '' : 's'}`
    const routeText = route?.originToDestination?.distanceKm
      ? `${route.originToDestination.distanceKm} km of route travel`
      : route?.billableDistanceKm
        ? `${route.billableDistanceKm} km of travel`
        : null
    const detailBits = [
      inventoryText,
      crewText,
      truckText,
      hourText,
      'loading/unloading',
      'furniture protection',
      includedDisassemblyItems.length > 0 ? `disassembly/reassembly for ${includedDisassemblyItems.slice(0, 3).join(', ')}` : null,
      routeText,
    ].filter(Boolean) as string[]
    const summary = `Your estimate is ${formatMoney(quoteModalTotals.total)} including HST. This is based on ${inventoryText}, ${crewText}, ${truckText}, and ${hourText}. Deposit to reserve the crew is ${formatMoney(quoteModalTotals.deposit)}.`
    const detailed = `Your estimate is ${formatMoney(quoteModalTotals.total)} including HST. This is based on ${detailBits.join(', ')}. Deposit to reserve the crew is ${formatMoney(quoteModalTotals.deposit)}.`
    return {
      summary,
      short: summary,
      detailed,
    }
  }, [effectiveInventoryMetrics.inventory, effectiveInventoryMetrics.totalCubicFeet, effectiveInventoryMetrics.totalItems, includedDisassemblyItems, pricingBreakdown, quoteModalTotals.deposit, quoteModalTotals.total, route?.billableDistanceKm, route?.originToDestination?.distanceKm])
  const readinessItems = useMemo<QuoteReadinessItem[]>(() => {
    const items: QuoteReadinessItem[] = [
      { label: 'Customer name', ready: Boolean(lead.name.trim()), critical: true, detail: 'Customer name is missing.' },
      { label: 'Phone', ready: Boolean((lead.phone || '').trim()), critical: true, detail: 'Phone number is missing.' },
      { label: 'Email or SMS available', ready: Boolean((lead.email || '').trim() || (lead.phone || '').trim()), critical: true, detail: 'No email or SMS delivery path is available.' },
      { label: 'Origin address', ready: Boolean(originFull.trim()), critical: true, detail: 'Origin address is missing.' },
      { label: 'Destination address', ready: Boolean(destFull.trim()), critical: true, detail: 'Destination address is missing.' },
      { label: 'Origin geocoded', ready: Boolean(originFull.trim() && !routeError && route?.originResolved), critical: true, detail: originFull.trim() ? 'Origin address could not be located.' : 'Origin address is missing.' },
      { label: 'Destination geocoded', ready: Boolean(destFull.trim() && !routeError && route?.destResolved), critical: true, detail: destFull.trim() ? 'Destination address could not be located.' : 'Destination address is missing.' },
      { label: 'Move date', ready: Boolean(selectedMoveDate), critical: true, detail: 'Move date is missing.' },
      { label: 'Inventory', ready: effectiveInventoryMetrics.totalItems > 0, critical: true, detail: 'Inventory is still empty.' },
      { label: 'Access / parking', ready: accessConfirmed, detail: 'Access or parking is still unknown.' },
      { label: 'Packing status', ready: Boolean(jobFactors.packingStatus), detail: 'Packing status is not confirmed.' },
      { label: 'Boxes asked', ready: boxesAsked, detail: 'Boxes were not confirmed.' },
      { label: 'Crew / truck recommendation', ready: Boolean(pricingBreakdown?.crewSize && pricingBreakdown?.truckCount), critical: true, detail: 'Crew or truck recommendation is missing.' },
      { label: 'Price generated', ready: Boolean(pricingBreakdown && quoteModalTotals.total > 0), critical: true, detail: 'Price has not been generated yet.' },
      { label: 'Deposit amount', ready: quoteModalTotals.deposit > 0, critical: true, detail: 'Deposit amount is missing.' },
      { label: 'Quote explanation available', ready: Boolean(quoteExplanation.detailed.trim()), detail: 'Customer-facing price explanation is not ready.' },
    ]
    return items
  }, [accessConfirmed, boxesAsked, destFull, effectiveInventoryMetrics.totalItems, jobFactors.packingStatus, lead.email, lead.name, lead.phone, originFull, pricingBreakdown, quoteExplanation.detailed, quoteModalTotals.deposit, quoteModalTotals.total, route?.destResolved, route?.originResolved, routeError, selectedMoveDate])
  const blockingReadiness = useMemo(
    () => readinessItems.filter(item => !item.ready && item.critical),
    [readinessItems]
  )
  const warningReadiness = useMemo(
    () => readinessItems.filter(item => !item.ready && !item.critical),
    [readinessItems]
  )
  const sendIssueDetails = useMemo(
    () => [...blockingReadiness, ...warningReadiness].map(item => item.detail),
    [blockingReadiness, warningReadiness]
  )
  const bookTodayGate = useMemo(() => {
    const reasons: string[] = []
    if (!quote?.sentAt) reasons.push('available after the quote is sent')
    if (!quote?.viewedAt) reasons.push('customer must have viewed the quote or be on a live close call')
    if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote?.depositPaidAt) reasons.push('deposit is already paid')
    if (moveDateDaysAway !== null && moveDateDaysAway > 30) reasons.push('move date is outside the close-now discount window')
    const approvalRequired = bookTodayProjectedMargin !== null && bookTodayProjectedMargin < 55
    return {
      eligible: reasons.length === 0,
      reasons,
      approvalRequired,
    }
  }, [bookTodayProjectedMargin, lead.paymentStatus, moveDateDaysAway, quote?.depositPaidAt, quote?.sentAt, quote?.viewedAt])
  const tenPctGate = useMemo(() => {
    const reasons: string[] = []
    if (!quote?.sentAt) reasons.push('available after the quote is sent')
    if (!quote?.viewedAt) reasons.push('customer must be actively reviewing the quote')
    if (lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote?.depositPaidAt) reasons.push('deposit is already paid')
    return {
      eligible: reasons.length === 0,
      reasons,
      approvalRequired: tenPctProjectedMargin !== null && tenPctProjectedMargin < 55,
    }
  }, [lead.paymentStatus, quote?.depositPaidAt, quote?.sentAt, quote?.viewedAt, tenPctProjectedMargin])

  useEffect(() => {
    if (!open) return
    if (!selectedMoveDate) {
      setCapacitySnapshot(null)
      return
    }
    let cancelled = false
    setCapacityBusy(true)
    void fetchSalesOverview()
      .then(data => {
        if (cancelled) return
        const quoteMap = new Map(data.quotes.map(item => [item.id, item]))
        const jobs = data.leads.filter(item => {
          if (!isBookedLikeStage(item.stage)) return false
          const itemQuote = item.quoteId ? quoteMap.get(item.quoteId) : null
          const itemDate = itemQuote?.moveDate || item.moveDate
          return itemDate === selectedMoveDate && (item.branch || 'windsor') === selectedBranch
        })
        const capacity = BRANCH_CAPACITY_ESTIMATES[selectedBranch]
        const crewUsed = jobs.reduce((sum, item) => {
          const itemQuote = item.quoteId ? quoteMap.get(item.quoteId) : null
          return sum + Number(itemQuote?.crewSize || item.assignedCrew?.length || 0)
        }, 0)
        const trucksUsed = jobs.reduce((sum, item) => {
          const itemQuote = item.quoteId ? quoteMap.get(item.quoteId) : null
          return sum + Number(getQuotedTruckCount(item, itemQuote || null) || 0)
        }, 0)
        const crewPct = capacity.crew > 0 ? Math.round((crewUsed / capacity.crew) * 100) : 0
        const trucksRemaining = Math.max(0, capacity.trucks - trucksUsed)
        const risk =
          crewPct >= 85 || trucksRemaining <= 1
            ? 'high'
            : crewPct >= 70 || trucksRemaining <= 2
              ? 'medium'
              : 'low'
        const note =
          jobs.some(item => {
            const itemQuote = item.quoteId ? quoteMap.get(item.quoteId) : null
            return !itemQuote?.crewSize || !getQuotedTruckCount(item, itemQuote || null)
          })
            ? 'Estimate based on booked jobs with partial crew or truck data.'
            : 'Estimate based on currently booked jobs in this branch.'
        setCapacitySnapshot({
          status: 'ready',
          jobsBooked: jobs.length,
          crewUsed,
          crewCapacity: capacity.crew,
          crewPct,
          trucksUsed,
          truckCapacity: capacity.trucks,
          trucksRemaining,
          risk,
          note,
        })
      })
      .catch(() => {
        if (!cancelled) {
          setCapacitySnapshot({
            status: 'unavailable',
            jobsBooked: 0,
            crewUsed: 0,
            crewCapacity: 0,
            crewPct: 0,
            trucksUsed: 0,
            truckCapacity: 0,
            trucksRemaining: 0,
            risk: 'unknown',
            note: 'Capacity estimate unavailable. Confirm manually before booking.',
          })
        }
      })
      .finally(() => {
        if (!cancelled) setCapacityBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, selectedBranch, selectedMoveDate])

  async function copyPriceExplanation(mode: 'short' | 'detailed') {
    const text = mode === 'short' ? quoteExplanation.short : quoteExplanation.detailed
    if (!text.trim()) {
      setPriceExplanationNotice('Nothing to copy yet')
      window.setTimeout(() => setPriceExplanationNotice(null), 1800)
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setPriceExplanationNotice(mode === 'short' ? 'Short copied' : 'Detailed copied')
    } catch {
      setPriceExplanationNotice('Copy failed')
    }
    window.setTimeout(() => setPriceExplanationNotice(null), 1800)
  }

  function openRouteFixArea() {
    routeSectionRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  function focusManualKmOverride() {
    manualKmInputRef.current?.focus()
    manualKmInputRef.current?.select()
  }

  function saveAsRouteUnresolved() {
    onInternalNotesChange(prependUniqueLine(internalNotes, `Route unresolved: ${routeError || routeContext?.missingRequirements?.[0] || 'manual review required'}`))
  }

  async function handlePreviewSend() {
    if (blockingReadiness.length > 0 || warningReadiness.length > 0) {
      setSendGuardOpen(true)
      return
    }
    await onSaveAndPreview()
  }

  async function handleProvisionalSend() {
    const missingItems = sendIssueDetails.length > 0 ? sendIssueDetails : ['Missing quote details still need confirmation.']
    const moveNote = `Provisional estimate. Final pricing will be confirmed once we verify: ${missingItems.join(' ')}`
    const internalNote = `PROVISIONAL QUOTE — collect before final confirmation: ${missingItems.join(' ')}`
    await onSaveAndPreview({
      provisional: true,
      missingItems,
      moveDescription: prependUniqueLine(moveDescription, moveNote),
      internalNotes: prependUniqueLine(internalNotes, internalNote),
    })
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
              <span>{originFull || 'Origin TBD'} → {destFull || 'Destination TBD'}</span>
              <span>· {effectiveInventoryMetrics.totalCubicFeet} cu ft · {effectiveInventoryMetrics.totalWeightLbs} lbs</span>
              {listingPropertySummary ? <span>· MLS {listingPropertySummary}</span> : null}
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

            {/* Origin → Destination quick edit */}
            {(onOriginAddressChange || onDestAddressChange) && (
              <div ref={routeSectionRef} className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label mb-3">Move Route</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Origin</div>
                    <AddressAutocompleteInput
                      value={originAddress || lead.originAddress || ''}
                      placeholder="Origin address"
                      onSelect={(address, city) => {
                        onOriginAddressChange?.(address)
                        if (city) onOriginCityChange?.(city)
                      }}
                    />
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Destination</div>
                    <AddressAutocompleteInput
                      value={destAddress || lead.destAddress || destCity || lead.destCity || ''}
                      placeholder="Destination address or city"
                      onSelect={(address, city) => {
                        onDestAddressChange?.(address)
                        if (city) onDestCityChange?.(city)
                      }}
                    />
                  </div>
                </div>
                {routeError && <div className="mt-2 text-xs text-rose-500">{routeError}</div>}
                {routeBusy && <div className="mt-2 text-xs text-[var(--app-muted)]">Calculating route…</div>}
                <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Route Context</div>
                    <div className="text-[10px] font-medium text-[var(--app-muted)]">{getSalesBranchLabel(selectedBranch)} branch</div>
                  </div>
                  {route ? (
                    <div className="mt-2 space-y-2">
                      <div className="text-sm font-medium text-[var(--app-ink)]">
                        {originFull || 'Origin TBD'} → {destFull || 'Destination TBD'}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--app-muted)]">
                        <span>{route.originToDestination?.driveHours || route.driveHours || 0}h drive</span>
                        <span>{route.originToDestination?.distanceKm || route.distanceKm || 0} km</span>
                        <span>Travel included: {route.billableDriveHours || route.driveHours || 0}h</span>
                      </div>
                      <div className="grid gap-2 text-xs text-[var(--app-muted)] sm:grid-cols-2">
                        <div className="rounded-[6px] bg-[var(--app-bg)] px-2.5 py-2">
                          <div className="font-semibold text-[var(--app-ink)]">Geocode status</div>
                          <div className="mt-1">Origin: {route.originResolved ? 'Resolved' : 'Needs review'}</div>
                          <div>Destination: {destFull ? (route.destResolved ? 'Resolved' : 'Needs review') : 'Pending destination'}</div>
                        </div>
                        <div className="rounded-[6px] bg-[var(--app-bg)] px-2.5 py-2">
                          <div className="font-semibold text-[var(--app-ink)]">Travel billing</div>
                          <div className="mt-1">Billable: {route.billableDistanceKm || route.distanceKm || 0} km</div>
                          <div>Yard to origin: {route.yardToOrigin?.distanceKm || 0} km · {route.yardToOrigin?.driveHours || 0}h</div>
                        </div>
                      </div>
                      {route.missingRequirements?.length ? (
                        <div className="rounded-[6px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                          {route.missingRequirements.join(' · ')}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-xs text-[var(--app-muted)]">
                      {routeError || 'Enter both addresses to confirm drive time, branch-to-yard distance, and travel billing.'}
                    </div>
                  )}
                  {(routeError || route?.missingRequirements?.length) && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={openRouteFixArea} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                        Edit address
                      </button>
                      <button type="button" onClick={openRouteFixArea} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                        Search address
                      </button>
                      <button type="button" onClick={focusManualKmOverride} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                        Use manual km override
                      </button>
                      <button type="button" onClick={saveAsRouteUnresolved} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                        Save as unresolved
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

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
            </div>

            {/* Branch Selector */}
            <div>
              <div className="crm-label mb-2">Branch / Yard Origin</div>
              <div className="flex flex-wrap gap-2">
                {([
                  { id: 'windsor', label: 'Windsor' },
                  { id: 'waterloo', label: 'Waterloo / KW' },
                  { id: 'london', label: 'London' },
                  { id: 'ottawa', label: 'Ottawa' },
                ] as const).map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleBranchChange(opt.id)}
                    className={selectedBranch === opt.id
                      ? 'rounded-full px-4 py-1.5 text-sm font-semibold bg-[#1a2744] text-white'
                      : 'rounded-full border border-slate-200 bg-white text-slate-500 px-4 py-1.5 text-sm hover:border-[#1a2744] transition'}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="mt-1.5 text-xs text-[var(--app-muted)]">
                Sets which Saturn Star yard is used as the drive origin. Drive time and billable distance update automatically.
              </div>
              <div className="mt-3">
                <label className="crm-label">Manual Billable KM Override <span className="font-normal normal-case text-[var(--app-muted)]">— optional correction</span></label>
                <input
                  ref={manualKmInputRef}
                  type="number"
                  value={distanceKm || ''}
                  onChange={e => setDistanceKm(Number(e.target.value))}
                  className="crm-input mt-1 w-full"
                  placeholder={route?.billableDistanceKm ? `Auto: ${route.billableDistanceKm} km` : quoteType === 'long_distance' ? 'e.g. 450' : 'Use only if route needs a manual fix'}
                />
                <div className="mt-1.5 text-xs text-[var(--app-muted)]">
                  Override only when routing needs a manual correction. Leave blank to keep the live branch-to-yard calculation.
                </div>
              </div>
            </div>

            {/* Move Description + Internal Notes */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <div className="crm-label mb-1.5">Move Description <span className="font-normal normal-case text-[var(--app-muted)]">— shown on quote</span></div>
                <textarea
                  rows={2}
                  value={moveDescription}
                  onChange={e => onMoveDescriptionChange(e.target.value)}
                  className="crm-input w-full resize-none text-sm"
                  placeholder={`e.g. 3-bedroom house move from ${originCity || lead.originCity || 'Windsor'} to ${destCity || lead.destCity || 'destination'}`}
                />
              </div>
              <div>
                <div className="crm-label mb-1.5">Internal Notes <span className="font-normal normal-case text-[var(--app-muted)]">— crew only, not on quote</span></div>
                <textarea
                  rows={2}
                  value={internalNotes}
                  onChange={e => onInternalNotesChange(e.target.value)}
                  className="crm-input w-full resize-none text-sm"
                  placeholder="e.g. Customer confirmed piano needs 4 people, tight staircase at origin"
                />
              </div>
            </div>

            {/* Inventory + Photos */}
            <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="crm-label">Inventory Snapshot</div>
                  <button
                    type="button"
                    onClick={() => void copyInventorySnapshot()}
                    className="rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]"
                  >
                    {inventoryCopyNotice || 'Copy list'}
                  </button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="crm-kpi">
                    <div className="crm-label">Items</div>
                    <div className="crm-value">{effectiveInventoryMetrics.totalItems}</div>
                  </div>
                  <div className="crm-kpi">
                    <div className="crm-label">Cubic Feet</div>
                    <div className="crm-value">{effectiveInventoryMetrics.totalCubicFeet}</div>
                  </div>
                  <div className="crm-kpi">
                    <div className="crm-label">Weight</div>
                    <div className="crm-value">{effectiveInventoryMetrics.totalWeightLbs}</div>
                  </div>
                </div>
                {listingPropertySummary ? (
                  <div className="mt-3 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                    MLS property context: {listingPropertySummary}
                  </div>
                ) : null}
                <div className="mt-4 space-y-2">
                  {groupedInventory.length === 0 && (
                    <div className="rounded-[6px] border border-dashed border-[var(--app-line)] px-3 py-3 text-xs text-[var(--app-muted)]">
                      No inventory yet. Add items below or match a listing above.
                    </div>
                  )}
                  {groupedInventory.map(([room, items]) => {
                    const roomCuFt = items.reduce((sum, el) => {
                      const policyFinding = getMovePolicyFinding(el.item)
                      if (el.item.included === false || policyFinding?.forceExclude) return sum
                      return sum + (el.item.cubicFeet || 0) * (el.item.qty || 1)
                    }, 0).toFixed(0)
                    return (
                      <details key={room} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-panel)]">
                        <summary className="flex cursor-pointer items-center justify-between px-3 py-2" style={{ listStyle: 'none' }}>
                          <div className="text-sm font-medium text-[var(--app-ink)]">{room}</div>
                          <div className="text-xs text-[var(--app-muted)]">{items.length} items · {roomCuFt} cu ft</div>
                        </summary>
                        <div className="border-t border-[var(--app-line)] px-3 py-2 space-y-1">
                          {items.map(el => {
                            const policyFinding = getMovePolicyFinding(el.item)
                            const forceExcluded =
                              el.item.included === false ||
                              (!!policyFinding?.forceExclude && el.item.policyOverride !== 'include')
                            return (
                            <div key={el.index} className={`rounded-[6px] border px-2 py-2 text-xs ${forceExcluded ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-transparent bg-white text-[var(--app-muted)]'}`}>
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <span className={`font-medium ${forceExcluded ? 'text-slate-500 line-through' : 'text-[var(--app-ink)]'}`}>{el.item.name || el.item.item}</span>
                                  {policyFinding ? (
                                    <div className="mt-1">
                                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                        policyFinding.category === 'default_exclude'
                                          ? 'bg-slate-100 text-slate-700'
                                          : policyFinding.category === 'blocked'
                                          ? 'bg-rose-100 text-rose-700'
                                          : policyFinding.category === 'hazardous'
                                            ? 'bg-amber-100 text-amber-800'
                                            : policyFinding.category === 'manual_review'
                                              ? 'bg-slate-200 text-slate-700'
                                              : 'bg-sky-100 text-sky-700'
                                      }`}>
                                        {formatMovePolicyCategoryLabel(policyFinding.category)}
                                      </span>
                                    </div>
                                  ) : null}
                                </div>
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
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                <input
                                  value={el.item.size || ''}
                                  onChange={event => onUpdateInventoryItem(el.index, 'size', event.target.value)}
                                  className="crm-input h-8 py-1 text-xs"
                                  placeholder="Size / dimensions"
                                />
                                <input
                                  value={el.item.notes || ''}
                                  onChange={event => onUpdateInventoryItem(el.index, 'notes', event.target.value)}
                                  className="crm-input h-8 py-1 text-xs"
                                  placeholder="Notes / scope details"
                                />
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={policyFinding?.category === 'blocked' || policyFinding?.category === 'hazardous' || policyFinding?.category === 'manual_review'}
                                  onClick={() => onToggleInventoryItem(el.index)}
                                  className={`rounded-[6px] px-2.5 py-1 text-[10px] font-semibold disabled:cursor-not-allowed disabled:opacity-60 ${forceExcluded ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700'}`}
                                >
                                  {policyFinding?.category === 'blocked' || policyFinding?.category === 'hazardous' || policyFinding?.category === 'manual_review'
                                    ? 'Policy flagged'
                                    : forceExcluded
                                      ? 'Include Back'
                                      : 'Stays Behind'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRemoveInventoryItem(el.index)}
                                  className="rounded-[6px] bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700"
                                >
                                  Remove
                                </button>
                              </div>
                              {(el.item.exclusionReason || policyFinding?.customerNote) ? (
                                <div className="mt-1 text-[10px] text-slate-500">{el.item.exclusionReason || policyFinding?.customerNote}</div>
                              ) : null}
                            </div>
                          )})}
                        </div>
                      </details>
                    )
                  })}
                  {/* Preset search */}
                  <div className="pt-2">
                    <div className="relative">
                      <input
                        type="text"
                        value={presetSearch}
                        onChange={e => setPresetSearch(e.target.value)}
                        className="crm-input w-full py-1.5 pl-8 text-sm"
                        placeholder="Search items — sofa, dresser, bike, fridge…"
                      />
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-muted)] text-sm pointer-events-none">🔍</span>
                      {presetSearch && (
                        <button
                          type="button"
                          onClick={() => setPresetSearch('')}
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--app-muted)] hover:text-[var(--app-ink)] text-xs"
                        >✕</button>
                      )}
                    </div>
                    {presetSearchResults.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {presetSearchResults.map(p => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => { onAddPreset(p.id); setPresetSearch('') }}
                            className="crm-button text-xs py-1 px-2.5 bg-[#f0f7ff] border-[#c5d9f5] text-[#1a4a8a]"
                          >
                            + {p.label}
                            <span className="ml-1 opacity-50">{p.item.cubicFeet} cu ft</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {presetSearch.trim() && presetSearchResults.length === 0 && (
                      <div className="mt-1.5 text-xs text-[var(--app-muted)]">No presets match — use Quick Add below to enter manually.</div>
                    )}
                  </div>
                  {/* Quick-add preset buttons — boxes first, then matched presets */}
                  <div className="space-y-2 pt-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">📦 Boxes — ask every customer</div>
                    <div className="flex flex-wrap gap-1.5">
                      {['box-small','box-medium','box-large','box-xl','tv-box-32','tv-box-55','tv-box-70','mirror-box'].map(id => {
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
                    {tvRecommendations.length > 0 && (
                      <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">TV Protection</div>
                        <div className="mt-2 space-y-2">
                          {tvRecommendations.map(rec => (
                            <div key={rec.key} className="flex items-center justify-between gap-3 rounded-[6px] border border-[var(--app-line)] px-2.5 py-2">
                              <div className="min-w-0">
                                <div className="text-xs font-medium text-[var(--app-ink)]">{rec.itemLabel}</div>
                                <div className="text-[10px] text-[var(--app-muted)]">
                                  {rec.sizeLabel} · Recommended {rec.recommendedMaterial?.label || 'TV box'}{rec.recommendedMaterial ? ` · ${formatMoney(rec.recommendedMaterial.unitPrice)}` : ''}
                                </div>
                              </div>
                              {rec.recommendedMaterial ? (
                                <button
                                  type="button"
                                  onClick={() => onAddPreset(rec.recommendedMaterial!.id)}
                                  className="crm-button text-[10px] px-2.5 py-1"
                                >
                                  + Box
                                </button>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {presetMatches.some(p => !['box-small','box-medium','box-large','box-xl','tv-box-32','tv-box-55','tv-box-70','mirror-box','fridge-standard','fridge-large','stove-freestanding','dishwasher','freezer-standalone','washer-freestanding','dryer-freestanding','tool-chest','lawn-mower-push','wheelbarrow','bicycle','garage-shelving','barbecue','patio-set','hot-tub','junk-item-large'].includes(p.id)) && (
                      <>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] pt-1">🛋️ Furniture</div>
                        <div className="flex flex-wrap gap-1.5">
                          {presetMatches.filter(p => !['box-small','box-medium','box-large','box-xl','tv-box-32','tv-box-55','tv-box-70','mirror-box','fridge-standard','fridge-large','stove-freestanding','dishwasher','freezer-standalone','washer-freestanding','dryer-freestanding','tool-chest','lawn-mower-push','wheelbarrow','bicycle','garage-shelving','barbecue','patio-set','hot-tub','junk-item-large'].includes(p.id)).map(preset => (
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

              {/* Packing add-on recommendation — labor + materials separated */}
              {(jobFactors.packingStatus === 'not-started' || jobFactors.packingStatus === 'partial') && flags?.packingDayEstimate && (
                <div className="mb-3 rounded-[8px] border border-emerald-200 bg-emerald-50 px-4 py-3">
                  <div className="text-sm font-semibold text-emerald-800">📦 Packing add-on recommendation</div>
                  <div className="mt-1 text-xs text-emerald-700">
                    Customer {jobFactors.packingStatus === 'not-started' ? "hasn't started packing" : 'is only partially packed'}.
                    Recommended workflow: keep packing on the same quote, but as separate line items for labor and materials.
                  </div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-[8px] border border-emerald-200 bg-white px-3 py-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Packing Labor</div>
                      <div className="mt-1 text-base font-bold text-[var(--app-ink)]">{formatMoney(flags.packingDayEstimate.amountBeforeHst)}</div>
                      <div className="text-[11px] text-emerald-700">
                        {flags.packingDayEstimate.crewSize} packers · ~{flags.packingDayEstimate.hours}h · {formatMoney(flags.packingDayEstimate.total)} incl. HST
                      </div>
                    </div>
                    {packingMaterialsEstimate ? (
                      <div className="rounded-[8px] border border-emerald-200 bg-white px-3 py-2.5">
                        <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Packing Materials</div>
                        <div className="mt-1 text-base font-bold text-[var(--app-ink)]">{formatMoney(packingMaterialsEstimate.subtotal)}</div>
                        <div className="text-[11px] text-emerald-700">
                          ~{packingMaterialsEstimate.plannedBoxes} planned boxes · deliver ~{packingMaterialsEstimate.recommendedDeliveryBoxes} total · {formatMoney(packingMaterialsEstimate.total)} incl. HST
                        </div>
                      </div>
                    ) : null}
                  </div>
                  {packingMaterialsEstimate ? (
                    <div className="mt-2 rounded-[8px] border border-emerald-200 bg-white px-3 py-2.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-700">Materials Mix</div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {packingMaterialsEstimate.lines.slice(0, 6).map(line => (
                          <span
                            key={line.presetId}
                            className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800"
                          >
                            {line.quantity} {line.label}
                          </span>
                        ))}
                        {packingMaterialsEstimate.lines.length > 6 ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800">
                            +{packingMaterialsEstimate.lines.length - 6} more
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 text-[10px] text-emerald-700">
                        {getPackingMaterialsSourceLabel(packingMaterialsEstimate.source)}. {packingMaterialsEstimate.note}
                      </div>
                      <div className="mt-1 text-[10px] text-emerald-800">{packingMaterialsEstimate.billingNote}</div>
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={addPackingLaborLineItem}
                      disabled={packingLaborAdded}
                      className="rounded-[6px] bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                    >
                      {packingLaborAdded ? 'Labor added' : '+ Add labor'}
                    </button>
                    {packingMaterialsEstimate ? (
                      <button
                        type="button"
                        onClick={addPackingMaterialsLineItem}
                        disabled={packingMaterialsAdded}
                        className="rounded-[6px] border border-emerald-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:text-emerald-400"
                      >
                        {packingMaterialsAdded ? 'Materials added' : '+ Add materials'}
                      </button>
                    ) : null}
                    {packingMaterialsEstimate ? (
                      <button
                        type="button"
                        onClick={() => {
                          addPackingLaborLineItem()
                          addPackingMaterialsLineItem()
                        }}
                        disabled={packingLaborAdded && packingMaterialsAdded}
                        className="rounded-[6px] border border-emerald-300 bg-emerald-100 px-3 py-1.5 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200 disabled:cursor-not-allowed disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-400"
                      >
                        + Add both
                      </button>
                    ) : null}
                  </div>
                </div>
              )}

              {blockedPolicyLabels.length > 0 && (
                <div className="mb-3 rounded-[8px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <div className="font-semibold">Do not move</div>
                  <div className="mt-0.5 text-xs">
                    Remove these from the quoted scope and refer out if needed: {blockedPolicyLabels.join(', ')}.
                  </div>
                </div>
              )}

              {hazardousPolicyLabels.length > 0 && (
                <div className="mb-3 rounded-[8px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  <div className="font-semibold">Hazardous / non-transport items detected</div>
                  <div className="mt-0.5 text-xs">
                    Customer must remove these before move day: {hazardousPolicyLabels.join(', ')}.
                  </div>
                </div>
              )}

              {manualReviewPolicyLabels.length > 0 && (
                <div className="mb-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <div className="font-semibold">Manager review required</div>
                  <div className="mt-0.5 text-xs">
                    Do not treat these like normal residential scope until approved: {manualReviewPolicyLabels.join(', ')}.
                  </div>
                </div>
              )}

              {specialtyPolicyLabels.length > 0 && (
                <div className="mb-3 rounded-[8px] border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
                  <div className="font-semibold">Specialty handling confirmation</div>
                  <div className="mt-0.5 text-xs">
                    Confirm photo, weight, route, and fee before finalizing: {specialtyPolicyLabels.join(', ')}.
                  </div>
                </div>
              )}

              {defaultExcludePolicyLabels.length > 0 && (
                <div className="mb-3 rounded-[8px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <div className="font-semibold">Excluded by default</div>
                  <div className="mt-0.5 text-xs">
                    These stay out of the move unless the customer clearly confirms they are taking them: {defaultExcludePolicyLabels.join(', ')}.
                  </div>
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

                {/* Specialty Items — only items that need human confirmation; AI handles hot tub/pool table */}
                <div className="space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Specialty Items</div>
                  {[
                    { label: 'Piano (we can move)', key: 'hasPiano' as const },
                    { label: 'Heavy safe (we have dolly)', key: 'hasSafe' as const },
                  ].map(({ label, key }) => (
                    <label key={key} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!jobFactors[key]}
                        onChange={e => setFactor(key, e.target.checked || undefined)}
                        className="h-3.5 w-3.5 rounded"
                      />
                      <span className="text-xs text-[var(--app-muted)]">{label}</span>
                    </label>
                  ))}
                  {/* Show AI-detected restricted items as read-only notices */}
                  {(jobFactors.hasHotTub || jobFactors.hasPoolTable || blockedPolicyLabels.length > 0 || hazardousPolicyLabels.length > 0) && (
                    <div className="rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      ⚠️ AI detected: {[
                        jobFactors.hasHotTub && 'Hot tub',
                        jobFactors.hasPoolTable && 'Pool table',
                        ...blockedPolicyLabels,
                        ...hazardousPolicyLabels,
                      ].filter(Boolean).join(', ')} — confirm this with the customer before the quote goes out.
                    </div>
                  )}
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
                  {/* Truck size suggestion */}
                  {effectiveInventoryMetrics.totalCubicFeet > 0 && (() => {
                    const cf = effectiveInventoryMetrics.totalCubicFeet
                    const count = suggestTruckCount(cf, effectiveInventoryMetrics.totalWeightLbs, lead.moveType)
                    const size = cf < 250 ? '15 ft' : cf < 700 ? '20 ft' : '26 ft'
                    return (
                      <div className="rounded-[6px] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-muted)]">
                        🚚 Suggested: <span className="font-semibold text-[var(--app-ink)]">{count > 1 ? `${count} × 26 ft trucks` : `${size} truck`}</span>
                        <span className="ml-1">— {cf} cu ft total</span>
                      </div>
                    )
                  })()}
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
                      {/* Disassembly mode */}
                      <div className="flex flex-col gap-1">
                        <div className="text-xs text-[var(--app-muted)]">Service scope</div>
                        {([
                          { id: 'both', label: 'Dis + Reassembly', sub: 'Crew does both — at origin and destination' },
                          { id: 'disassemble_only', label: 'Disassemble only', sub: 'Customer will reassemble at destination' },
                          { id: 'reassemble_only', label: 'Reassemble only', sub: 'Customer disassembles — crew reassembles at destination' },
                        ] as const).map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setFactor('disassemblyMode', opt.id)}
                            className={`rounded-[6px] border px-2.5 py-1.5 text-left text-[10px] leading-4 ${
                              (jobFactors.disassemblyMode || 'both') === opt.id
                                ? 'border-[var(--app-ink)] bg-[var(--app-ink)] text-white'
                                : 'border-[var(--app-line)] bg-white text-[var(--app-muted)]'
                            }`}
                          >
                            <div className="font-semibold">{opt.label}</div>
                            <div className="opacity-75">{opt.sub}</div>
                          </button>
                        ))}
                      </div>
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
                    <div className="font-semibold text-[var(--app-ink)]">{effectiveInventoryMetrics.totalCubicFeet} cu ft · {effectiveInventoryMetrics.totalWeightLbs.toLocaleString()} lbs</div>
                    <div className="text-[var(--app-muted)] mt-0.5">{effectiveInventoryMetrics.totalItems} items across all rooms</div>
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
                            <span>{disassemblyScopeLabel} ({includedDisassemblyItems.length} of {pricingBreakdown.disassemblyItems.length} items)</span>
                            <span>{pricingBreakdown.adjustmentBreakdown.find(a => a.category === 'disassembly')?.hours ?? 0 > 0 ? `+${pricingBreakdown.adjustmentBreakdown.find(a => a.category === 'disassembly')?.hours}h` : '—'}</span>
                          </div>
                          <div className="pl-2 space-y-0.5">
                            {pricingBreakdown.disassemblyItems.map((item, i) => {
                              const excluded = excludedDisassemblyItems.has(item)
                              return (
                                <div key={i} className="flex items-center justify-between gap-1">
                                  <span className={`text-[10px] leading-4 ${excluded ? 'line-through text-slate-400' : 'text-[var(--app-muted)]'}`}>{item}</span>
                                  <button
                                    type="button"
                                    onClick={() => toggleDisassemblyItem(item)}
                                    title={excluded ? 'Add back' : 'Remove from estimate'}
                                    className={`shrink-0 rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold leading-none transition-colors ${excluded ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-rose-100 hover:text-rose-600'}`}
                                  >
                                    {excluded ? '+' : '−'}
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                          {excludedDisassemblyItems.size > 0 && (
                            <div className="mt-1 rounded-[4px] bg-slate-50 border border-slate-200 px-2 py-1 text-[10px] text-slate-500">
                              {excludedDisassemblyItems.size} item{excludedDisassemblyItems.size > 1 ? 's' : ''} excluded — customer handles that part of the assembly scope
                            </div>
                          )}
                        </>
                      )}
                      {jobFactors.specialtyNotes?.trim() ? (
                        <div className="rounded-[4px] border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-700">
                          Scope note: {jobFactors.specialtyNotes.trim()}
                        </div>
                      ) : null}
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
                  const disItems = includedDisassemblyItems.slice(0, 3).join(', ')
                  const twoTruck = pricingBreakdown.truckCount >= 2
                  return (
                    <div className="mt-3 rounded-[8px] border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-600 leading-5">
                      <div className="font-semibold text-slate-800 mb-1">Why this price</div>
                      Loading and unloading {effectiveInventoryMetrics.totalCubicFeet} cu ft takes ~{baseH}h base.
                      {innerH > 0 && disItems && ` ${disassemblyScopeLabel} of ${includedDisassemblyItems.length} items (${disItems}) adds ${innerH}h.`}
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
                  <div>✓ Moving {effectiveInventoryMetrics.totalItems} items ({effectiveInventoryMetrics.totalCubicFeet} cu ft)</div>
                  <div>✓ Wrapping + padding all furniture</div>
                  {includedDisassemblyItems.length > 0 && (
                    <div>✓ {disassemblyScopeLabel}: {includedDisassemblyItems.join(', ')}</div>
                  )}
                  {pricingBreakdown.specialtyItemFlags.map((item, i) => (
                    <div key={i}>✓ Specialty handling: {item}</div>
                  ))}
                  {jobFactors.specialtyNotes?.trim() ? (
                    <div>✓ Additional scope notes: {jobFactors.specialtyNotes.trim()}</div>
                  ) : null}
                  {/* Boxes from inventory */}
                  {(() => {
                    const effectiveInventory = effectiveInventoryMetrics.inventory
                    const smallBoxes = effectiveInventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('small box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const medBoxes = effectiveInventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('medium box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const largeBoxes = effectiveInventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('large box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const xlBoxes = effectiveInventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('xl box')).reduce((s, i) => s + (i.qty || 1), 0)
                    const tvBoxes = effectiveInventory.filter(i => i.included !== false && (i.name || '').toLowerCase().includes('tv box'))
                    const boxSummary: string[] = []
                    const tvBoxCount = tvBoxes.reduce((s, i) => s + (i.qty || 1), 0)
                    const tvBoxSizes = Array.from(new Set(tvBoxes.map(i => i.size || i.name).filter(Boolean))).join(', ')
                    if (smallBoxes > 0) boxSummary.push(`${smallBoxes} small`)
                    if (medBoxes > 0) boxSummary.push(`${medBoxes} medium`)
                    if (largeBoxes > 0) boxSummary.push(`${largeBoxes} large`)
                    if (xlBoxes > 0) boxSummary.push(`${xlBoxes} XL`)
                    if (tvBoxCount > 0) {
                      boxSummary.push(`${tvBoxCount} TV box${tvBoxCount > 1 ? 'es' : ''}${tvBoxSizes ? ` (${tvBoxSizes})` : ''}`)
                    }
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
                      {pricingBreakdown.routeCategory === 'long-distance' && pricingBreakdown.uhaulChargeEstimate ? (
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Auto U-Haul estimate</span>
                          <span className="font-medium text-[var(--app-ink)]">
                            {formatMoney(pricingBreakdown.uhaulChargeEstimate)} ({pricingBreakdown.operationalDistanceKm ?? 0} km x {pricingBreakdown.truckCount} truck{pricingBreakdown.truckCount === 1 ? '' : 's'} x ${pricingBreakdown.uhaulRatePerKm?.toFixed(2) || '1.00'}/km)
                          </span>
                        </div>
                      ) : null}
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

                  {liveMarginSummary && (
                    <div className="border-t border-[var(--app-line)] pt-3 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Live Margin View</div>
                        <div className={`text-[10px] font-bold ${liveMarginSummary.marginColor}`}>{liveMarginSummary.liveMargin.toFixed(1)}%</div>
                      </div>
                      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
                        <div className={`absolute inset-y-0 left-0 rounded-full ${liveMarginSummary.marginBg} transition-all`} style={{ width: `${Math.min(100, liveMarginSummary.liveMargin)}%` }} />
                        <div className="absolute inset-y-0 rounded-sm bg-emerald-200/60" style={{ left: '65%', width: '3%' }} />
                      </div>
                      <div className="flex justify-between text-[10px] text-[var(--app-muted)]">
                        <span>0%</span>
                        <span className="font-semibold text-emerald-700">Target 65–68%</span>
                        <span>100%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-[var(--app-muted)]">Quoted revenue</span>
                        <span className="font-medium text-[var(--app-ink)]">{formatMoney(liveMarginSummary.actualRevenue)}</span>
                      </div>
                      <div className="flex justify-between text-xs border-t border-[var(--app-line)] pt-1">
                        <span className="text-[var(--app-muted)]">Total direct cost</span>
                        <span className="text-[var(--app-ink)]">{formatMoney(liveMarginSummary.totalCost)}</span>
                      </div>
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-[var(--app-ink)]">Gross profit</span>
                        <span className={liveMarginSummary.liveProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}>{formatMoney(liveMarginSummary.liveProfit)}</span>
                      </div>
                      {liveMarginSummary.liveMargin < 65 && liveMarginSummary.actualRevenue > 0 && (
                        <div className="rounded-[6px] border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] text-amber-800">
                          Below the 65% target. Discounting past this line should be intentional.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {/* Draft Summary */}
            <div>
              <div className="crm-label mb-3">Draft Summary</div>
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-[var(--app-muted)]">Original estimate</div>
                  <div className="mt-1 text-lg font-medium text-[var(--app-ink)]">{formatMoney(baseQuoteSubtotal)}</div>
                </div>
                {lineItemDiscountTotal > 0 ? (
                  <div>
                    <div className="text-xs text-[var(--app-muted)]">Line-item promos</div>
                    <div className="mt-1 text-base font-medium text-emerald-700">−{formatMoney(lineItemDiscountTotal)}</div>
                  </div>
                ) : null}
                {quoteDiscountAmount > 0 ? (
                  <div>
                    <div className="text-xs text-[var(--app-muted)]">{quoteDiscountLabel || 'Quote discount'}</div>
                    <div className="mt-1 text-base font-medium text-emerald-700">−{formatMoney(quoteDiscountAmount)}</div>
                  </div>
                ) : null}
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
              <div className="mt-4 space-y-3">
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">Quote Readiness</div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                      {readinessItems.filter(item => item.ready).length}/{readinessItems.length} ready
                    </div>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {readinessItems.map(item => (
                      <div key={item.label} className="flex items-start justify-between gap-2 text-xs">
                        <span className={item.ready ? 'text-[var(--app-ink)]' : item.critical ? 'text-rose-700' : 'text-amber-700'}>{item.label}</span>
                        <span className={`font-semibold ${item.ready ? 'text-emerald-700' : item.critical ? 'text-rose-700' : 'text-amber-700'}`}>
                          {item.ready ? 'Ready' : item.critical ? 'Missing' : 'Confirm'}
                        </span>
                      </div>
                    ))}
                  </div>
                  {blockingReadiness.length > 0 && (
                    <div className="mt-3 rounded-[6px] border border-rose-200 bg-rose-50 px-2.5 py-2 text-[10px] text-rose-800">
                      Quote not ready: {blockingReadiness.map(item => item.detail).join(' · ')}
                    </div>
                  )}
                  {warningReadiness.length > 0 && (
                    <div className="mt-2 rounded-[6px] border border-amber-200 bg-amber-50 px-2.5 py-2 text-[10px] text-amber-800">
                      Confirm before sending: {warningReadiness.map(item => item.detail).join(' · ')}
                    </div>
                  )}
                </div>

                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">Capacity Awareness</div>
                    <div className="text-[10px] font-medium text-[var(--app-muted)]">{selectedMoveDate || 'Move date TBD'}</div>
                  </div>
                  {!selectedMoveDate ? (
                    <div className="mt-2 text-[10px] text-[var(--app-muted)]">Capacity estimate unavailable. Confirm manually before booking.</div>
                  ) : capacityBusy ? (
                    <div className="mt-2 text-[10px] text-[var(--app-muted)]">Checking branch load…</div>
                  ) : capacitySnapshot?.status === 'ready' ? (
                    <div className="mt-3 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-[var(--app-muted)]">Jobs booked</span>
                        <span className="text-[var(--app-ink)]">{capacitySnapshot.jobsBooked}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--app-muted)]">Estimated crew capacity used</span>
                        <span className={capacitySnapshot.risk === 'high' ? 'text-rose-700' : capacitySnapshot.risk === 'medium' ? 'text-amber-700' : 'text-emerald-700'}>
                          {capacitySnapshot.crewPct}% ({capacitySnapshot.crewUsed}/{capacitySnapshot.crewCapacity})
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--app-muted)]">Truck availability</span>
                        <span className={capacitySnapshot.trucksRemaining <= 1 ? 'text-rose-700' : capacitySnapshot.trucksRemaining <= 2 ? 'text-amber-700' : 'text-[var(--app-ink)]'}>
                          {capacitySnapshot.trucksRemaining} remaining
                        </span>
                      </div>
                      <div
                        className={`rounded-[6px] border px-2.5 py-2 text-[10px] leading-4 ${
                          capacitySnapshot.risk === 'high'
                            ? 'border-rose-200 bg-rose-50 text-rose-800'
                            : capacitySnapshot.risk === 'medium'
                              ? 'border-amber-200 bg-amber-50 text-amber-800'
                              : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        }`}
                      >
                        {capacitySnapshot.risk === 'high'
                          ? 'Limited availability. Collect deposit before promising this slot.'
                          : capacitySnapshot.risk === 'medium'
                            ? 'Availability is tightening. Confirm crew and truck plan before locking this date.'
                            : 'Capacity looks workable based on current booked jobs.'}
                      </div>
                      {capacitySnapshot.note ? <div className="text-[10px] text-[var(--app-muted)]">{capacitySnapshot.note}</div> : null}
                    </div>
                  ) : (
                    <div className="mt-2 text-[10px] text-[var(--app-muted)]">{capacitySnapshot?.note || 'Capacity estimate unavailable. Confirm manually before booking.'}</div>
                  )}
                </div>

                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">Why This Price</div>
                    <div className="text-[10px] font-medium text-[var(--app-muted)]">{priceExplanationNotice || 'Customer-safe copy'}</div>
                  </div>
                  <div className="mt-2 text-[11px] leading-5 text-[var(--app-muted)]">
                    {quoteExplanation.detailed || 'Generate pricing first to build a customer-facing explanation.'}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copyPriceExplanation('detailed')} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                      Copy Price Explanation
                    </button>
                    <button type="button" onClick={() => void copyPriceExplanation('short')} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                      Copy Short Version
                    </button>
                    <button type="button" onClick={() => void copyPriceExplanation('detailed')} className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)]">
                      Copy Detailed Version
                    </button>
                  </div>
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
                  <div className="text-[10px] leading-4 text-[var(--app-muted)]">
                    Enter the <span className="font-semibold text-[var(--app-ink)]">total the customer pays</span> (incl. HST). Type $6,000 → customer sees $6,000. Override reason, user, timestamp, and price change will land in the audit trail.
                  </div>
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
                      <option value="price_match">Price match</option>
                      <option value="relationship">Relationship</option>
                      <option value="courtesy_discount">Courtesy discount</option>
                      <option value="manager_approved">Manager approved</option>
                      <option value="customer_objection">Customer objection</option>
                      <option value="date_flexibility">Date flexibility</option>
                      <option value="bundle_opportunity">Bundle / two-move opportunity</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  {overrideInput && Number(overrideInput) > 0 && (
                    <div className="text-[10px] text-[var(--app-muted)]">
                      Subtotal: {formatMoney(Math.round(Number(overrideInput) / 1.13 * 100) / 100)} + HST = <span className="font-semibold text-[var(--app-ink)]">{formatMoney(Number(overrideInput))}</span>
                    </div>
                  )}
                  {overrideProjectedMargin !== null && (
                    <div className={`text-[10px] ${overrideProjectedMargin < 55 ? 'text-rose-700' : 'text-[var(--app-muted)]'}`}>
                      Projected margin after override: {overrideProjectedMargin.toFixed(1)}%
                      {overrideProjectedMargin < 55 ? canApproveMarginException ? ' · manager approval should be documented.' : ' · manager approval required below threshold.' : ''}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={!overrideInput || Number(overrideInput) <= 0 || (overrideProjectedMargin !== null && overrideProjectedMargin < 55 && !canApproveMarginException)}
                    onClick={() => {
                      const total = Math.round(Number(overrideInput) * 100) / 100
                      if (total <= 0) return
                      const amount = Math.round(total / 1.13 * 100) / 100
                      const reasonLabels: Record<string, string> = {
                        price_match: 'Price match',
                        relationship: 'Relationship pricing',
                        courtesy_discount: 'Courtesy discount',
                        manager_approved: 'Manager approved rate',
                        customer_objection: 'Customer objection adjustment',
                        date_flexibility: 'Date flexibility adjustment',
                        bundle_opportunity: 'Bundle / two-move opportunity',
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
                      disabled={!bookTodayGate.eligible || (bookTodayGate.approvalRequired && !canApproveMarginException)}
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
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 ${bookTodayActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {bookTodayActive ? 'Active' : 'Off'}
                    </button>
                  </div>
                  <div className="text-[10px] text-[var(--app-muted)]">Script: “I can take $150 off if we lock in the crew today with the deposit.”</div>
                  {bookTodayActive && (
                    <div className="text-[10px] text-emerald-700">$150 early-booking discount added — holds until move date.</div>
                  )}
                  {!bookTodayGate.eligible && (
                    <div className="text-[10px] text-amber-700">Available only when {bookTodayGate.reasons.join(', ')}.</div>
                  )}
                  {bookTodayGate.approvalRequired && (
                    <div className="text-[10px] text-rose-700">
                      {canApproveMarginException
                        ? `Projected margin after discount: ${bookTodayProjectedMargin?.toFixed(1) || '0.0'}%`
                        : `Projected margin drops to ${bookTodayProjectedMargin?.toFixed(1) || '0.0'}% — manager approval required.`}
                    </div>
                  )}
                </div>

                {/* 10% Spot Discount */}
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">10% Spot Discount</div>
                    <button
                      type="button"
                      disabled={!tenPctGate.eligible || (tenPctGate.approvalRequired && !canApproveMarginException)}
                      onClick={() => {
                        const next = !tenPctActive
                        setTenPctActive(next)
                        if (next) {
                          onQuoteDiscountAmountChange(tenPctDiscountAmount)
                          onQuoteDiscountLabelChange(tenPctDiscountAmount > 0 ? '10% Spot Discount' : '')
                        } else {
                          onQuoteDiscountAmountChange(0)
                          if ((quoteDiscountLabel || '').toLowerCase() === '10% spot discount'.toLowerCase()) {
                            onQuoteDiscountLabelChange('')
                          }
                        }
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors disabled:opacity-40 ${tenPctActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}
                    >
                      {tenPctActive ? 'Active' : 'Off'}
                    </button>
                  </div>
                  {tenPctActive && (
                    <div className="text-[10px] text-emerald-700">
                      10% off the current base estimate — {formatMoney(tenPctDiscountAmount)} saved. It will recalculate automatically if the estimate changes.
                    </div>
                  )}
                  {!tenPctGate.eligible && (
                    <div className="text-[10px] text-amber-700">Available only when {tenPctGate.reasons.join(', ')}.</div>
                  )}
                  {tenPctGate.approvalRequired && (
                    <div className="text-[10px] text-rose-700">
                      {canApproveMarginException
                        ? `Projected margin after discount: ${tenPctProjectedMargin?.toFixed(1) || '0.0'}%`
                        : `Projected margin drops to ${tenPctProjectedMargin?.toFixed(1) || '0.0'}% — manager approval required.`}
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
                {sendGuardOpen && (
                  <div className="rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
                    <div className="font-semibold text-[var(--app-ink)]">
                      {blockingReadiness.length > 0 ? 'Quote not ready' : 'Send with caution'}
                    </div>
                    <div className="mt-2 leading-5">
                      {[...blockingReadiness, ...warningReadiness].map(item => item.detail).join(' · ')}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSendGuardOpen(false)
                          openRouteFixArea()
                        }}
                        className="rounded-[6px] border border-amber-300 bg-white px-2.5 py-1 text-[10px] font-semibold text-amber-900 hover:border-amber-500"
                      >
                        Fix now
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleProvisionalSend()}
                        disabled={quoteModalBusy || !quote}
                        className="rounded-[6px] bg-[var(--app-ink)] px-2.5 py-1 text-[10px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                      >
                        Send provisional quote
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSaveDraft()}
                        disabled={quoteModalBusy || !quote}
                        className="rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)] disabled:opacity-50"
                      >
                        Save draft
                      </button>
                    </div>
                  </div>
                )}
                <button onClick={() => void handlePreviewSend()} disabled={quoteModalBusy || !quote} className="w-full justify-center rounded-[8px] bg-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity">
                  {quoteModalBusy ? 'Saving...' : 'Preview & Send →'}
                </button>
                <button onClick={() => void onSaveDraft()} disabled={quoteModalBusy || !quote} className="crm-button-dark w-full justify-center disabled:opacity-60">
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
