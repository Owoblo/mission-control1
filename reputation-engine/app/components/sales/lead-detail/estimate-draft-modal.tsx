'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { formatListingContextSummary, getListingDescription, getListingOperationalHighlights } from '@/lib/listing'
import { getQuotedTruckCount } from '@/lib/operations'
import { fetchSalesOverview, requestPriceOverrideApproval, verifyPriceOverrideApproval } from '@/lib/sales-api'
import { estimateLeadQuote, deriveInventoryMetrics, formatMoney, getSalesBranchLabel, isBookedLikeStage, suggestTruckCount, detectSalesBranchFromLocation } from '@/lib/sales'
import { INVENTORY_PRESETS } from '@/lib/item-presets'
import { getDisassemblyServiceLabel, getIncludedDisassemblyItems } from '@/lib/move-scope'
import { formatMovePolicyCategoryLabel, getMovePolicyFinding, summarizeMovePolicy } from '@/lib/move-policy'
import { getTvBoxMaterialPresetForSize } from '@/lib/packing-materials'
import { buildStarterInventoryPlan } from '@/lib/starter-inventory'
import { DEFAULT_ROOM_OPTIONS } from './helpers'
import type { EstimateRouteContext, JobFactors, CRMLead, CRMQuote, InventoryItem, PricingBreakdown, QuoteLineItem, QuoteLeg, QuoteLegType } from '@/lib/types'
import {
  calcUHaulCost, compareStrategies, truckSizeFromCubicFeet, calcStrategyTiming,
  DEFAULT_BLANKET_BAGS, DEFAULT_GAS_PRICE_PER_L, DEFAULT_MISC_BUFFER,
  UHAUL_DAILY_RATES, UHAUL_PER_KM_RATE, UHAUL_FUEL_L_PER_100KM, type TripStrategy,
} from '@/lib/uhaul-calculator'

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

function getInventoryDisplayLabel(item: InventoryItem) {
  const explicit = [item.name, item.item]
    .map(value => (value || '').trim())
    .find(Boolean)
  if (explicit) return explicit

  const sizeFallback = (item.size || '').trim()
  if (sizeFallback) return sizeFallback

  const noteFallback = (item.notes || '').trim()
  if (noteFallback) {
    const firstSentence = noteFallback.split(/[\n.;]/).map(part => part.trim()).find(Boolean)
    if (firstSentence) return firstSentence
  }

  return 'Item'
}

function buildInventorySnapshotCopyText(groupedInventory: GroupedInventory) {
  return groupedInventory
    .map(([room, items]) => {
      const roomItemCount = items.reduce((sum, { item }) => sum + Math.max(1, Number(item.qty || 1)), 0)
      const roomCuFt = Math.round(items.reduce((sum, { item }) => {
        const policyFinding = getMovePolicyFinding(item)
        if (item.included === false || policyFinding?.forceExclude) return sum
        return sum + (item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1))
      }, 0))
      const lines = items.map(({ item }) => {
        const qty = Math.max(1, Number(item.qty || 1))
        const label = getInventoryDisplayLabel(item)
        const policyFinding = getMovePolicyFinding(item)
        const hasExplicitLabel = [item.name, item.item].some(value => (value || '').trim().length > 0)
        const sizeText = (item.size || '').trim()
        const notesText = (item.notes || '').trim()
        const parts = [`• ${qty} x ${label}`]
        if (sizeText && (hasExplicitLabel || sizeText !== label)) parts.push(`— ${sizeText}`)
        if (notesText && notesText !== label) parts.push(`— ${notesText}`)
        if (item.included === false) parts.push('[stays behind]')
        if (item.included !== false && policyFinding) {
          parts.push(`[${formatMovePolicyCategoryLabel(policyFinding.category)}: ${policyFinding.itemLabel}]`)
        }
        return parts.join(' ')
      })
      return [
        room,
        `${roomItemCount} item${roomItemCount === 1 ? '' : 's'} · ${roomCuFt} cu ft`,
        ...lines,
      ].join('\n')
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
  propertyBedrooms?: CRMLead['propertyBedrooms']
  propertyType?: CRMLead['propertyType']
  originAddress: string
  originCity: string
  originAccess: string
  destCity: string
  destAccess: string
  parkingNotes: string
  recalculateBusy: boolean
  listingPhotos: string[]
  customerPhotos?: string[]
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
  onQuoteApprovalUpdated?: (quote: CRMQuote) => void
  moveDescription: string
  internalNotes: string
  moveTime?: string
  onMoveTimeChange?: (v: string) => void
  onMoveDescriptionChange: (v: string) => void
  onInternalNotesChange: (v: string) => void
  onSaveDraft: (options?: QuoteWorkspaceSaveOptions) => Promise<void> | void
  onSaveAndPreview: (options?: QuoteWorkspaceSendOptions) => Promise<void> | void
  legs?: QuoteLeg[]
  onLegsChange?: (legs: QuoteLeg[]) => void
  onBranchChange?: (value: NonNullable<CRMLead['branch']>) => void
  onJobFactorsChange: (factors: JobFactors) => void
  onAddInventoryItems: (items: InventoryItem[]) => void
  onApplyStarterInventory?: () => number
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
  propertyBedrooms,
  propertyType,
  originAddress,
  originCity,
  originAccess,
  destCity,
  destAddress,
  destAccess,
  parkingNotes,
  recalculateBusy,
  listingPhotos,
  customerPhotos,
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
  moveTime,
  onMoveTimeChange,
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
  onQuoteApprovalUpdated,
  legs: legsProp,
  onLegsChange,
  onBranchChange,
  onJobFactorsChange,
  onAddInventoryItems,
  onApplyStarterInventory,
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
  const [overrideNote, setOverrideNote] = useState('')
  const [overrideApprovalCode, setOverrideApprovalCode] = useState('')
  const [overrideApprovalBusy, setOverrideApprovalBusy] = useState(false)
  const [overrideApprovalNotice, setOverrideApprovalNotice] = useState<string | null>(null)
  const [approvedOverrideAmount, setApprovedOverrideAmount] = useState<number | null>(null)
  const [uhaulInputPerTruck, setUhaulInputPerTruck] = useState('')
  const [, startTransition] = useTransition()
  const [marginGateAck, setMarginGateAck] = useState(false)
  const [overrideApplied, setOverrideApplied] = useState(false)
  // U-Haul cost panel
  const [uhaulOpen, setUhaulOpen] = useState(false)
  const [uhaulGasPrice, setUhaulGasPrice] = useState(DEFAULT_GAS_PRICE_PER_L)
  const [uhaulMisc, setUhaulMisc] = useState(DEFAULT_MISC_BUFFER)
  const [uhaulStraightDrop, setUhaulStraightDrop] = useState(false)
  const [uhaulBlankets, setUhaulBlankets] = useState<number | null>(null)  // null = auto
  const [uhaulDepotName, setUhaulDepotName] = useState<string | null>(null)
  const [uhaulPickupKm, setUhaulPickupKm] = useState<number | null>(null)
  const [uhaulDepotLookupDone, setUhaulDepotLookupDone] = useState(false)
  const [uhaulSelectedStrategy, setUhaulSelectedStrategy] = useState<TripStrategy | null>(null)
  const [junkAmount, setJunkAmount] = useState('299')
  const [junkAddress, setJunkAddress] = useState('')
  const [junkVolumeTier, setJunkVolumeTier] = useState<'unknown' | 'mini' | 'small' | 'medium' | 'large' | 'xl'>('unknown')
  const [junkPhotoLinkBusy, setJunkPhotoLinkBusy] = useState(false)
  const [junkPhotoLink, setJunkPhotoLink] = useState<string | null>(null)
  const [junkSmsDialogOpen, setJunkSmsDialogOpen] = useState(false)
  const [junkSmsDraft, setJunkSmsDraft] = useState('')
  const [junkSmsSending, setJunkSmsSending] = useState(false)
  const [valuationAmount, setValuationAmount] = useState('149')
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeText, setIntakeText] = useState('')
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [intakeResult, setIntakeResult] = useState<import('@/app/api/sales/smart-intake/route').SmartIntakeResult | null>(null)
  const [intakeApplied, setIntakeApplied] = useState(false)
  const [legsEnabled, setLegsEnabled] = useState(() => (legsProp?.length ?? 0) > 0)
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null)
  const [dragOverRoom, setDragOverRoom] = useState<string | null>(null)
  const [touchMoveItemIndex, setTouchMoveItemIndex] = useState<number | null>(null)
  const [legs, setLegs] = useState<QuoteLeg[]>(() => legsProp?.length ? legsProp : [])
  const [legRoutes, setLegRoutes] = useState<Record<string, { distanceKm: number; driveHours: number } | null>>({})
  const legRouteFetchRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const LEG_TYPE_LABELS: Record<QuoteLegType, string> = {
    move: '🚚 House → House',
    storage: '🏢 House → Storage',
    storage_delivery: '📦 Storage → House',
    junk: '🗑 Junk Removal',
    delivery: '🏠 Delivery Drop',
  }

  function getLegDefaultLabel(type: QuoteLegType, idx: number): string {
    const num = `Leg ${idx + 1}`
    if (type === 'move') return `${num} — Moving`
    if (type === 'storage') return `${num} — House to Storage`
    if (type === 'storage_delivery') return `${num} — Storage to New Home`
    if (type === 'junk') return `${num} — Junk Removal`
    if (type === 'delivery') return `${num} — Delivery`
    return num
  }

  async function runSmartIntake() {
    if (!intakeText.trim()) return
    setIntakeBusy(true)
    setIntakeResult(null)
    try {
      const res = await fetch('/api/sales/smart-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          text: intakeText,
          leadContext: {
            name: lead.name,
            originAddress: lead.originAddress,
            originCity: lead.originCity,
            destAddress: lead.destAddress,
            destCity: lead.destCity,
            moveDate: lead.moveDate,
          },
        }),
      })
      const data = await res.json() as { ok?: boolean; result?: import('@/app/api/sales/smart-intake/route').SmartIntakeResult; error?: string }
      if (data.ok && data.result) {
        setIntakeResult(data.result)
      }
    } catch { /* non-fatal */ }
    finally { setIntakeBusy(false) }
  }

  function applyIntakeResult(r: import('@/app/api/sales/smart-intake/route').SmartIntakeResult) {
    if (r.quoteType) setQuoteType(r.quoteType)
    if (r.branch) { setLocalBranch(r.branch); onBranchChange?.(r.branch) }
    if (r.moveTime) onMoveTimeChange?.(r.moveTime)
    if (r.originAddress) onOriginAddressChange?.(r.originAddress)
    if (r.originCity) onOriginCityChange?.(r.originCity)
    if (r.destAddress) onDestAddressChange?.(r.destAddress)
    if (r.destCity) onDestCityChange?.(r.destCity)
    if (r.moveDescription) onMoveDescriptionChange(r.moveDescription)
    if (r.internalNotes) onInternalNotesChange(r.internalNotes)

    // Apply job factors (map AI field names to actual JobFactors type)
    if (r.jobFactors) {
      const jf = r.jobFactors
      const next: typeof jobFactors = { ...jobFactors }
      if (jf.packingStatus) next.packingStatus = jf.packingStatus === 'fully-packed' ? 'packed' : jf.packingStatus
      if (jf.floorsAtOrigin) next.originFloors = jf.floorsAtOrigin
      if (jf.hasElevatorOrigin !== undefined) next.originHasElevator = jf.hasElevatorOrigin
      if (jf.directTruckAccessOrigin !== undefined) next.originParkingOk = jf.directTruckAccessOrigin
      if (jf.floorsAtDest) next.destFloors = jf.floorsAtDest
      if (jf.hasElevatorDest !== undefined) next.destHasElevator = jf.hasElevatorDest
      if (jf.directTruckAccessDest !== undefined) next.destParkingOk = jf.directTruckAccessDest
      if (jf.disassemblyItemCount !== undefined) next.disassemblyItemCount = jf.disassemblyItemCount
      if (jf.boxCount !== undefined) next.estimatedBoxes = jf.boxCount
      if (jf.specialtyItems?.piano) next.hasPiano = true
      if (jf.specialtyItems?.heavySafe) next.hasSafe = true
      if (jf.crewSizeOverride) next.crewSizeOverride = jf.crewSizeOverride
      if (jf.specialtyNotes) next.specialtyNotes = jf.specialtyNotes
      onJobFactorsChange(next)
    }

    // Apply legs
    if (r.legsEnabled && r.legs?.length) {
      const newLegs = r.legs.map((l, i) => ({
        id: `leg-${Date.now()}-${i}`,
        label: l.label || getLegDefaultLabel(l.type, i),
        type: l.type,
        originAddress: l.originAddress || '',
        originCity: l.originCity || '',
        destAddress: l.destAddress || '',
        destCity: l.destCity || '',
        scheduledDate: l.scheduledDate || '',
        notes: l.notes || '',
      }))
      setLegsEnabled(true)
      setLegs(newLegs)
      onLegsChange?.(newLegs)
    }

    // Apply add-ons
    if (r.addOns?.packing && !packingLaborAdded) {
      const additions: QuoteLineItem[] = []
      if (flags?.packingDayEstimate) {
        additions.push({ description: packingLaborLineDescription, details: `${flags.packingDayEstimate.crewSize} packers · ~${flags.packingDayEstimate.hours}h`, amount: flags.packingDayEstimate.amountBeforeHst })
      } else {
        additions.push({ description: packingLaborLineDescription, details: 'Professional packing service', amount: 0 })
      }
      if (packingMaterialsEstimate) {
        additions.push({ description: packingMaterialsLineDescription, details: buildPackingMaterialsLineItemDetails(packingMaterialsEstimate), amount: packingMaterialsEstimate.subtotal })
      }
      onSetLineItems([...quoteLineItems, ...additions])
    }
    if (r.addOns?.junk && !junkAdded) toggleJunk()
    if (r.addOns?.valuation && !valuationAdded) toggleValuation()

    setIntakeApplied(true)
    setTimeout(() => onRecalculate({ quoteType: r.quoteType || quoteType, distanceKm: distanceKm || route?.distanceKm || undefined, routeContext }), 100)
  }

  function addLeg() {
    const n = legs.length + 1
    const prevLeg = legs[legs.length - 1]
    const defaultType: QuoteLegType =
      legs.length === 0 ? 'move' :
      prevLeg?.type === 'storage' ? 'storage_delivery' :
      prevLeg?.type === 'storage_delivery' ? 'move' :
      'move'
    const newLeg: QuoteLeg = {
      id: `leg-${Date.now()}`,
      label: getLegDefaultLabel(defaultType, n - 1),
      type: defaultType,
      originAddress: n === 1 ? (originAddress || lead.originAddress || '') : (legs[n - 2]?.destAddress || ''),
      originCity: n === 1 ? (originCity || lead.originCity || '') : (legs[n - 2]?.destCity || ''),
      destAddress: n === 1 ? (destAddress || lead.destAddress || '') : '',
      destCity: n === 1 ? (destCity || lead.destCity || '') : '',
    }
    const next = [...legs, newLeg]
    setLegs(next)
    onLegsChange?.(next)
  }

  function removeLeg(id: string) {
    const next = legs.filter(l => l.id !== id).map((l, i) => ({ ...l, label: `Leg ${i + 1}` }))
    setLegs(next)
    onLegsChange?.(next)
    // Remove auto-generated line items for this leg
    const removed = legs.find(l => l.id === id)
    if (removed) {
      const prefix = `[${removed.label}]`
      onSetLineItems(quoteLineItems.filter(li => !li.description.startsWith(prefix)))
    }
  }

  function updateLeg(id: string, updates: Partial<QuoteLeg>) {
    const next = legs.map(l => l.id === id ? { ...l, ...updates } : l)
    setLegs(next)
    onLegsChange?.(next)
    // Debounce route calculation
    if (updates.originAddress !== undefined || updates.destAddress !== undefined || updates.originCity !== undefined || updates.destCity !== undefined) {
      if (legRouteFetchRef.current[id]) clearTimeout(legRouteFetchRef.current[id])
      legRouteFetchRef.current[id] = setTimeout(() => void fetchLegRoute(id, next), 800)
    }
  }

  async function fetchLegRoute(id: string, currentLegs: QuoteLeg[]) {
    const leg = currentLegs.find(l => l.id === id)
    if (!leg) return
    // Build the most complete address string available
    const originParts = [leg.originAddress, leg.originCity].filter(Boolean)
    const destParts   = [leg.destAddress,   leg.destCity  ].filter(Boolean)
    if (originParts.length === 0 || destParts.length === 0) return
    const origin = originParts.join(', ')
    const dest   = destParts.join(', ')
    try {
      const res = await fetch('/api/sales/route-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ origin, destination: dest, branch: selectedBranch }),
        credentials: 'include',
      })
      if (!res.ok) return
      const data = (await res.json()) as RouteResult & { error?: string }
      if (data.error) return
      const km  = data.originToDestination?.distanceKm  ?? data.distanceKm  ?? 0
      const hrs = data.originToDestination?.driveHours  ?? data.driveHours  ?? 0
      if (!km && !hrs) return  // API returned zeros — don't overwrite with bad data
      setLegRoutes(prev => ({ ...prev, [id]: { distanceKm: km, driveHours: hrs } }))
      const withRoute = currentLegs.map(l => l.id === id ? {
        ...l,
        distanceKm: km,
        driveHours: hrs,
        routeCategory: data.category,
        pricingStatus: data.pricingStatus,
        billableDistanceKm: data.billableDistanceKm,
        operationalDistanceKm: data.operationalDistanceKm,
        billableDriveHours: data.billableDriveHours,
        operationalDriveHours: data.operationalDriveHours,
        yardToOriginHours: data.yardToOrigin?.driveHours,
        returnTripHours: data.returnToOrigin?.driveHours,
      } : l)
      setLegs(withRoute)
      onLegsChange?.(withRoute)
    } catch { /* non-fatal */ }
  }

  // Auto-fetch routes for legs that already have addresses (on open or when legs change)
  useEffect(() => {
    if (!open || !legsEnabled || legs.length === 0) return
    legs.forEach(leg => {
      const hasAddresses = (leg.originAddress || leg.originCity) && (leg.destAddress || leg.destCity)
      const alreadyCached = !!legRoutes[leg.id]
      const alreadySaved = !!(leg.distanceKm && leg.driveHours)
      if (hasAddresses && !alreadyCached) {
        // Restore from saved leg data immediately, then re-fetch in background for freshness
        if (alreadySaved) {
          setLegRoutes(prev => ({ ...prev, [leg.id]: { distanceKm: leg.distanceKm!, driveHours: leg.driveHours! } }))
        }
        // Always re-fetch to confirm accuracy
        void fetchLegRoute(leg.id, legs)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, legsEnabled, legs.length])

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
      getInventoryDisplayLabel(p.item).toLowerCase().includes(q) ||
        (p.room || '').toLowerCase().includes(q)
    ).slice(0, 12)
  }, [presetSearch])
  const starterPlan = useMemo(
    () => buildStarterInventoryPlan({ bedrooms: propertyBedrooms, propertyType }),
    [propertyBedrooms, propertyType]
  )

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

  // When modal opens, detect if an override was previously applied (e.g. from a saved quote)
  // and restore the override state so the rep sees it as active — not the default calculated price
  useEffect(() => {
    if (!open) return
    const overrideItem = quoteLineItems.find(li => li.description === 'Moving Services — Agreed Rate')
    if (overrideItem && overrideItem.amount > 0) {
      setOverrideApplied(true)
      setOverrideInput(String(overrideItem.amount))
    } else if (!overrideItem) {
      // No override present — reset so a fresh override can be applied
      setOverrideApplied(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (
      quote?.priceOverrideApprovalStatus === 'approved' &&
      quote.priceOverrideApprovalAmount &&
      quote.priceOverrideApprovalAmount > 0
    ) {
      setApprovedOverrideAmount(Number(quote.priceOverrideApprovalAmount))
      setOverrideApprovalNotice(`Approval verified for ${formatMoney(Number(quote.priceOverrideApprovalAmount))}.`)
    }
  }, [quote?.priceOverrideApprovalAmount, quote?.priceOverrideApprovalStatus])

  useEffect(() => {
    if (!open) return
    // Auto-detect branch from origin address — don't override if already explicitly set
    const detected = detectSalesBranchFromLocation(
      originAddress || lead.originAddress,
      originCity || lead.originCity
    )
    const resolved = (branch || lead.branch || detected || 'windsor') as 'windsor' | 'waterloo' | 'london' | 'ottawa'
    setLocalBranch(resolved)
    if (detected && detected !== (branch || lead.branch) && !branch) {
      onBranchChange?.(detected as 'windsor' | 'waterloo' | 'london' | 'ottawa')
    }
  }, [branch, lead.branch, open, originAddress, originCity, lead.originAddress, lead.originCity, onBranchChange])

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

  // Auto-find nearest U-Haul to origin when origin address is known
  useEffect(() => {
    const addr = originFull || lead.originAddress
    if (!addr || uhaulDepotLookupDone) return
    setUhaulDepotLookupDone(true)
    void fetch(`/api/sales/uhaul-nearest?address=${encodeURIComponent(addr)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { name?: string; distanceKm?: number | null } | null) => {
        if (data?.distanceKm != null) {
          setUhaulPickupKm(data.distanceKm)
          setUhaulDepotName(data.name ?? null)
        }
      })
      .catch(() => {})
  }, [originFull, lead.originAddress, uhaulDepotLookupDone])

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
    legsEnabled,
    legs,
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
      legs: legsEnabled ? legs : undefined,
    }, jobFactors).pricingBreakdown
  }, [open, lead, inventory, jobFactors, quoteType, distanceKm, route, routeContext, legs, legsEnabled])

  function setFactor<K extends keyof JobFactors>(key: K, value: JobFactors[K]) {
    const next = { ...jobFactors, [key]: value }
    onJobFactorsChange(next)
    // Crew/truck overrides must immediately recalculate so quote reflects the new count
    if (key === 'crewSizeOverride' || key === 'truckCountOverride') {
      onRecalculate({ quoteType, distanceKm: distanceKm || route?.distanceKm || undefined, routeContext })
    }
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
        const lower = getInventoryDisplayLabel(item).toLowerCase()
        return lower.includes('tv') && !lower.includes('tv box')
      })
      .map((item, index) => ({
        key: item.id || `${getInventoryDisplayLabel(item) || 'tv'}-${index}`,
        itemLabel: getInventoryDisplayLabel(item) || `TV ${index + 1}`,
        sizeLabel: item.size?.trim() || 'Avg 55"',
        recommendedMaterial: getTvBoxMaterialPresetForSize(item.size || getInventoryDisplayLabel(item) || item.notes),
      }))
  }, [effectiveInventoryMetrics.inventory])

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

  const junkLineDescription = 'Junk Removal Service'
  const valuationLineDescription = 'Declared Value Protection'
  const junkAdded = quoteLineItems.some(li => li.description === junkLineDescription)
  const valuationAdded = quoteLineItems.some(li => li.description === valuationLineDescription)

  // Junk removal pricing tiers (2 movers + cube truck, Windsor/KW area)
  const JUNK_TIERS: Record<string, { label: string; cubicFeet: string; price: number; detail: string }> = {
    unknown: { label: 'Not sure (request photos)', cubicFeet: '?', price: 299, detail: 'Estimated after photo review' },
    mini:    { label: 'Mini load (~50 cu ft)',      cubicFeet: '~50',  price: 249, detail: 'Fits in a pickup truck — about 5-8 bags' },
    small:   { label: 'Small load (~100 cu ft)',    cubicFeet: '~100', price: 349, detail: '¼ cube truck — a few furniture pieces + bags' },
    medium:  { label: 'Medium load (~200 cu ft)',   cubicFeet: '~200', price: 499, detail: '½ cube truck — most of a room worth of junk' },
    large:   { label: 'Large load (~350 cu ft)',    cubicFeet: '~350', price: 699, detail: '¾ cube truck — big cleanout' },
    xl:      { label: 'Full truck+ (400+ cu ft)',   cubicFeet: '400+', price: 899, detail: 'Full cube truck or more — whole-home cleanout' },
  }

  function applyJunkTier(tier: typeof junkVolumeTier) {
    setJunkVolumeTier(tier)
    const price = JUNK_TIERS[tier]?.price ?? 299
    setJunkAmount(String(price))
    const idx = quoteLineItems.findIndex(li => li.description === junkLineDescription)
    const tierLabel = JUNK_TIERS[tier]?.label || ''
    const detail = `${JUNK_TIERS[tier]?.detail || 'Labour + disposal'}${junkAddress ? ` · ${junkAddress}` : ''}`
    if (idx >= 0) {
      onUpdateLineItem(idx, 'amount', String(price))
      onUpdateLineItem(idx, 'details', detail)
    } else {
      onSetLineItems([...quoteLineItems, { description: junkLineDescription, details: detail, amount: price }])
    }
  }

  async function requestJunkPhotos() {
    if (!lead.id || !lead.phone) return
    try {
      setJunkPhotoLinkBusy(true)
      const res = await fetch(`/api/sales/leads/${lead.id}/survey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ purpose: 'junk_removal', junkAddress }),
      })
      const data = await res.json() as { surveyUrl?: string; defaultSmsTemplate?: string }
      if (data.surveyUrl) {
        setJunkPhotoLink(data.surveyUrl)
        const firstName = lead.name?.split(' ')[0] || 'there'
        const locationLine = junkAddress ? ` at ${junkAddress}` : ''
        const draft = `Hi ${firstName}! Saturn Star Moving here. Before we lock in your junk removal price${locationLine}, could you send us a few quick photos of the items?\n\nIt takes 2 minutes — just tap the link and upload:\n${data.surveyUrl}\n\nOnce we see them we'll confirm the price right away.\n\n— Saturn Star Movers`
        setJunkSmsDraft(draft)
        setJunkSmsDialogOpen(true)
      }
    } catch { /* non-fatal */ } finally {
      setJunkPhotoLinkBusy(false)
    }
  }

  async function sendJunkPhotoSms() {
    if (!lead.phone || !junkSmsDraft.trim()) return
    try {
      setJunkSmsSending(true)
      await fetch('/api/sales/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ channel: 'sms', to: lead.phone, body: junkSmsDraft, leadId: lead.id, notes: 'Junk removal photo request' }),
      })
      setJunkSmsDialogOpen(false)
    } catch { /* non-fatal */ } finally {
      setJunkSmsSending(false)
    }
  }

  function toggleJunk() {
    if (junkAdded) {
      const idx = quoteLineItems.findIndex(li => li.description === junkLineDescription)
      if (idx >= 0) onRemoveLineItem(idx)
    } else {
      onSetLineItems([...quoteLineItems, {
        description: junkLineDescription,
        details: 'Labour + disposal fees · items removed from property before or after move',
        amount: Number(junkAmount) || 299,
      }])
    }
  }

  function toggleValuation() {
    if (valuationAdded) {
      const idx = quoteLineItems.findIndex(li => li.description === valuationLineDescription)
      if (idx >= 0) onRemoveLineItem(idx)
    } else {
      onSetLineItems([...quoteLineItems, {
        description: valuationLineDescription,
        details: 'Up to $50,000 declared value coverage · full replacement liability · optional add-on',
        amount: Number(valuationAmount) || 149,
      }])
    }
  }

  function syncJunkAmount(val: string) {
    setJunkAmount(val)
    const idx = quoteLineItems.findIndex(li => li.description === junkLineDescription)
    if (idx >= 0) onUpdateLineItem(idx, 'amount', val)
  }

  function syncValuationAmount(val: string) {
    setValuationAmount(val)
    const idx = quoteLineItems.findIndex(li => li.description === valuationLineDescription)
    if (idx >= 0) onUpdateLineItem(idx, 'amount', val)
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

  const listingContextSummary = formatListingContextSummary(lead.supabaseListing)
  const listingHighlights = getListingOperationalHighlights(lead.supabaseListing).slice(0, 4)
  const listingDescription = getListingDescription(lead.supabaseListing)
  const scanDuplicateRisks = lead.listingScanSnapshot?.duplicateRisks || []
  const scanConfirmationQuestions = lead.listingScanSnapshot?.confirmationQuestions || []
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
    const totalCost = Math.round((
      pricingBreakdown.internalCostEstimate.laborCost +
      pricingBreakdown.internalCostEstimate.truckOpsCost +
      (pricingBreakdown.internalCostEstimate.commissionCost || 0) +
      (pricingBreakdown.internalCostEstimate.suppliesCost || 0) +
      dealCost
    ) * 100) / 100
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
    const overrideAmount = Math.round(Number(overrideInput || 0) * 100) / 100
    if (overrideAmount <= 0) return null
    return Math.round(((overrideAmount - liveMarginSummary.totalCost) / overrideAmount) * 1000) / 10
  }, [liveMarginSummary, overrideInput])
  const overrideAmount = useMemo(() => Math.round(Number(overrideInput || 0) * 100) / 100, [overrideInput])
  const overrideNeedsApproval = currentUser?.role === 'sales_rep' && (overrideProjectedMargin === null || overrideProjectedMargin < 55)
  const overrideApprovalMatches = useMemo(() => {
    if (!overrideNeedsApproval) return true
    if (overrideAmount <= 0) return false
    const quoteApprovedAmount =
      quote?.priceOverrideApprovalStatus === 'approved'
        ? Math.round(Number(quote.priceOverrideApprovalAmount || 0) * 100) / 100
        : 0
    const localApprovedAmount = approvedOverrideAmount ? Math.round(Number(approvedOverrideAmount) * 100) / 100 : 0
    return quoteApprovedAmount === overrideAmount || localApprovedAmount === overrideAmount
  }, [approvedOverrideAmount, overrideAmount, overrideNeedsApproval, quote?.priceOverrideApprovalAmount, quote?.priceOverrideApprovalStatus])

  // Reset margin gate acknowledgement whenever the quote pricing changes
  useEffect(() => {
    setMarginGateAck(false)
  }, [quoteLineItems, pricingBreakdown])

  const accessConfirmed = Boolean(
    originAccess ||
    destAccess ||
    parkingNotes ||
    jobFactors.originParkingOk !== undefined ||
    jobFactors.destParkingOk !== undefined ||
    jobFactors.originHasElevator !== undefined ||
    jobFactors.destHasElevator !== undefined
  )
  const boxesAsked = Boolean(
    Number(jobFactors.estimatedBoxes || 0) > 0 ||
    packingMaterialsEstimate?.plannedBoxes ||
    effectiveInventoryMetrics.inventory.some(item => getInventoryDisplayLabel(item).toLowerCase().includes('box'))
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
  // Discounts available any time — rep decides when to apply them
  const bookTodayGate = useMemo(() => {
    const approvalRequired = bookTodayProjectedMargin !== null && bookTodayProjectedMargin < 55
    return { eligible: true, reasons: [] as string[], approvalRequired }
  }, [bookTodayProjectedMargin])
  const tenPctGate = useMemo(() => {
    return {
      eligible: true,
      reasons: [] as string[],
      approvalRequired: tenPctProjectedMargin !== null && tenPctProjectedMargin < 55,
    }
  }, [tenPctProjectedMargin])

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

  function getOverrideReasonLabel(reason: string) {
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
    return reasonLabels[reason] || 'Rep-agreed rate'
  }

  async function requestOverrideApproval() {
    if (!quote || overrideAmount <= 0) return
    setOverrideApprovalBusy(true)
    setOverrideApprovalNotice(null)
    try {
      const result = await requestPriceOverrideApproval({
        quoteId: quote.id,
        requestedAmount: overrideAmount,
        originalSubtotal: quoteModalTotals.subtotal,
        projectedMargin: overrideProjectedMargin,
        totalCost: liveMarginSummary?.totalCost,
        reason: `${getOverrideReasonLabel(overrideReason)} — ${overrideNote.trim()}`,
      })
      onQuoteApprovalUpdated?.(result.quote)
      setOverrideApprovalNotice(`Approval requested. Owner/manager code expires ${result.expiresAt ? new Date(result.expiresAt).toLocaleString() : 'soon'}.`)
    } catch (err) {
      setOverrideApprovalNotice((err as Error).message)
    } finally {
      setOverrideApprovalBusy(false)
    }
  }

  async function verifyOverrideApproval() {
    if (!quote || !overrideApprovalCode.trim()) return
    setOverrideApprovalBusy(true)
    setOverrideApprovalNotice(null)
    try {
      const result = await verifyPriceOverrideApproval({
        quoteId: quote.id,
        code: overrideApprovalCode,
      })
      onQuoteApprovalUpdated?.(result.quote)
      setApprovedOverrideAmount(Number(result.quote.priceOverrideApprovalAmount || overrideAmount))
      setOverrideApprovalNotice(`Approval verified. Code ${overrideApprovalCode.trim().toUpperCase()} is now attached to this quote.`)
    } catch (err) {
      setOverrideApprovalNotice((err as Error).message)
    } finally {
      setOverrideApprovalBusy(false)
    }
  }

  function applyOverrideLineItem() {
    const amount = overrideAmount
    if (amount <= 0) return
    const note = overrideNote.trim()
    if (note.length < 6) {
      setOverrideApprovalNotice('Add a quick note explaining why this override is being used.')
      return
    }
    const marginText = overrideProjectedMargin === null ? 'Projected margin: unknown' : `Projected margin: ${overrideProjectedMargin.toFixed(1)}%`
    const approvalText = overrideNeedsApproval ? `Approval code verified: ${quote?.priceOverrideApprovalCode || overrideApprovalCode.trim().toUpperCase()}` : 'Approval not required: healthy margin'
    onSetLineItems([{
      description: 'Moving Services — Agreed Rate',
      details: `${getOverrideReasonLabel(overrideReason)} — ${note}. ${marginText}. ${approvalText}.`,
      amount,
    }])
    setOverrideApplied(true)
    setBookTodayActive(false)
    setTenPctActive(false)
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

  if (!open) return null

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
              {listingContextSummary ? <span>· MLS {listingContextSummary}</span> : null}
              {listingHighlights.length > 0 ? <span>· {listingHighlights.slice(0, 2).join(' · ')}</span> : null}
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

            {/* ── SMART INTAKE ── */}
            <div className={`rounded-[10px] border ${intakeApplied ? 'border-emerald-300 bg-emerald-50' : 'border-[#1a2744]/20 bg-[#1a2744]/5'} overflow-hidden`}>
              <button
                type="button"
                onClick={() => setIntakeOpen(v => !v)}
                className="flex w-full items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">🧠</span>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-[#1a2744]">
                      Smart Intake {intakeApplied ? '· Applied ✓' : ''}
                    </div>
                    <div className="text-[11px] text-[#1a2744]/50">
                      Describe the move in plain English — AI fills in the fields
                    </div>
                  </div>
                </div>
                <span className="text-[var(--app-muted)] text-sm">{intakeOpen ? '▲' : '▼'}</span>
              </button>

              {intakeOpen && (
                <div className="border-t border-[#1a2744]/10 px-4 pb-4 pt-3 space-y-3">
                  <textarea
                    rows={5}
                    value={intakeText}
                    onChange={e => setIntakeText(e.target.value)}
                    className="w-full rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2.5 text-sm text-[var(--app-ink)] placeholder:text-[var(--app-muted)] focus:border-[#1a2744] focus:outline-none resize-none"
                    placeholder={`Describe the move — e.g.:\n\n"Lady moving 4-bed house in Greeley to storage first. Keys not available until 1pm. Needs full packing, has a piano and a large safe. Then 10 days later moving from storage to new house in Brockville. 2 kids helping on move day. Wants junk removal too."`}
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runSmartIntake()}
                      disabled={intakeBusy || !intakeText.trim()}
                      className="flex-1 rounded-[8px] bg-[#1a2744] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                    >
                      {intakeBusy ? '🧠 Parsing…' : '🧠 Parse Move'}
                    </button>
                    {intakeResult && !intakeApplied && (
                      <button
                        type="button"
                        onClick={() => applyIntakeResult(intakeResult)}
                        className="rounded-[8px] bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
                      >
                        Apply →
                      </button>
                    )}
                  </div>

                  {intakeResult && (
                    <div className="space-y-3">
                      {/* Summary */}
                      {intakeResult.summary && (
                        <div className="rounded-[6px] border border-[#1a2744]/20 bg-white px-3 py-2.5 text-sm text-[#1a2744]">
                          <span className="font-semibold">Understood: </span>{intakeResult.summary}
                        </div>
                      )}

                      {/* What will be filled */}
                      <div className="rounded-[6px] border border-sky-200 bg-sky-50 px-3 py-2.5 space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Will fill in:</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-sky-800">
                          {intakeResult.quoteType && <span>✓ Quote type: {intakeResult.quoteType.replace('_', ' ')}</span>}
                          {intakeResult.branch && <span>✓ Branch: {intakeResult.branch}</span>}
                          {intakeResult.moveTime && <span>✓ Start time: {intakeResult.moveTime}</span>}
                          {intakeResult.legsEnabled && <span>✓ Multi-stop: {intakeResult.legs?.length} legs</span>}
                          {intakeResult.addOns?.packing && <span>✓ Packing service</span>}
                          {intakeResult.addOns?.junk && <span>✓ Junk removal</span>}
                          {intakeResult.jobFactors?.packingStatus && <span>✓ Packing: {intakeResult.jobFactors.packingStatus.replace('-', ' ')}</span>}
                          {intakeResult.jobFactors?.floorsAtOrigin && intakeResult.jobFactors.floorsAtOrigin > 1 && <span>✓ Origin: {intakeResult.jobFactors.floorsAtOrigin} floors</span>}
                          {intakeResult.jobFactors?.disassemblyItemCount !== undefined && intakeResult.jobFactors.disassemblyItemCount > 0 && <span>✓ Disassembly: {intakeResult.jobFactors.disassemblyItemCount} items</span>}
                          {intakeResult.jobFactors?.boxCount !== undefined && intakeResult.jobFactors.boxCount > 0 && <span>✓ Boxes: ~{intakeResult.jobFactors.boxCount}</span>}
                          {intakeResult.jobFactors?.specialtyItems?.piano && <span>✓ Piano flagged</span>}
                          {intakeResult.jobFactors?.specialtyItems?.heavySafe && <span>✓ Heavy safe flagged</span>}
                          {intakeResult.moveDescription && <span>✓ Move description</span>}
                          {intakeResult.internalNotes && <span>✓ Internal notes</span>}
                        </div>
                      </div>

                      {/* Missing questions */}
                      {(intakeResult.missingInfo?.length ?? 0) > 0 && (
                        <div className="rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2.5 space-y-1">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Still need to ask:</div>
                          {intakeResult.missingInfo!.map((q, i) => (
                            <div key={i} className="text-[11px] text-amber-800">• {q}</div>
                          ))}
                        </div>
                      )}

                      {intakeApplied && (
                        <div className="rounded-[6px] border border-emerald-200 bg-emerald-100 px-3 py-2 text-[11px] font-semibold text-emerald-800">
                          ✓ Applied — scroll down to review and edit anything. Ask the missing questions above before sending.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Origin → Destination quick edit — hidden when multi-stop is on (legs ARE the route) */}
            {(onOriginAddressChange || onDestAddressChange) && !legsEnabled && (
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
                      // Defer recalculate to next tick so button state updates first (fixes INP)
                      setTimeout(() => onRecalculate({
                        quoteType: opt.id,
                        distanceKm: distanceKm || route?.distanceKm || undefined,
                        routeContext,
                      }), 0)
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

            {/* ── ADD-ON SERVICES ── */}
            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 space-y-3">
              <div>
                <div className="crm-label">Add-on Services</div>
                <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">Toggle services to include on this quote. Each appears as its own line item.</div>
              </div>

              {/* Service chips */}
              <div className="flex flex-wrap gap-2">
                {/* Moving — always active */}
                <div className="flex items-center gap-1.5 rounded-full bg-[#1a2744] px-3 py-1.5 text-xs font-semibold text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Moving
                </div>

                {/* Packing */}
                <button
                  type="button"
                  onClick={() => {
                    if (packingLaborAdded || packingMaterialsAdded) {
                      const nextItems = quoteLineItems.filter(li =>
                        li.description !== packingLaborLineDescription &&
                        li.description !== packingMaterialsLineDescription
                      )
                      onSetLineItems(nextItems)
                    } else {
                      const additions: QuoteLineItem[] = []
                      if (flags?.packingDayEstimate) {
                        additions.push({
                          description: packingLaborLineDescription,
                          details: `${flags.packingDayEstimate.crewSize} packers · ~${flags.packingDayEstimate.hours}h · day before move`,
                          amount: flags.packingDayEstimate.amountBeforeHst,
                        })
                      } else {
                        additions.push({
                          description: packingLaborLineDescription,
                          details: 'Professional packing service — crew day before move',
                          amount: 0,
                        })
                      }
                      if (packingMaterialsEstimate) {
                        additions.push({
                          description: packingMaterialsLineDescription,
                          details: buildPackingMaterialsLineItemDetails(packingMaterialsEstimate),
                          amount: packingMaterialsEstimate.subtotal,
                        })
                      } else {
                        additions.push({
                          description: packingMaterialsLineDescription,
                          details: 'Boxes, tape, paper, bubble wrap — charged for actual materials used',
                          amount: 0,
                        })
                      }
                      onSetLineItems([...quoteLineItems, ...additions])
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    packingLaborAdded || packingMaterialsAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#1a2744] hover:text-[#1a2744]'
                  }`}
                >
                  {packingLaborAdded || packingMaterialsAdded ? '✓' : '+'} Packing
                </button>

                {/* Junk Removal */}
                <button
                  type="button"
                  onClick={toggleJunk}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    junkAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#1a2744] hover:text-[#1a2744]'
                  }`}
                >
                  {junkAdded ? '✓' : '+'} Junk Removal
                </button>

                {/* Valuation */}
                <button
                  type="button"
                  onClick={toggleValuation}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    valuationAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#1a2744] hover:text-[#1a2744]'
                  }`}
                >
                  {valuationAdded ? '✓' : '+'} Valuation
                </button>
              </div>

              {/* ── Junk Removal Workflow ── */}
              {junkAdded && (
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-emerald-900">🗑 Junk Removal Details</div>
                    <button type="button" onClick={toggleJunk} className="text-[10px] text-emerald-600 hover:text-emerald-900">Remove</button>
                  </div>

                  {/* Junk pickup address — Google Places autocomplete */}
                  <div>
                    <label className="text-[10px] font-semibold text-emerald-800">Junk pickup address</label>
                    <div className="mt-1">
                      <AddressAutocompleteInput
                        value={junkAddress}
                        placeholder="Enter junk address (may differ from move origin)"
                        onSelect={(addr) => setJunkAddress(addr)}
                      />
                    </div>
                    {junkAddress && originAddress && junkAddress.trim().toLowerCase() !== originAddress.trim().toLowerCase() && (
                      <div className="mt-1 text-[10px] text-emerald-700">Different from move origin ✓ — will be treated as a separate stop</div>
                    )}
                    {junkAddress && originAddress && junkAddress.trim().toLowerCase() === originAddress.trim().toLowerCase() && (
                      <div className="mt-1 text-[10px] text-emerald-600">Same as move origin — junk cleared before/after main move</div>
                    )}
                  </div>

                  {/* Volume tier picker */}
                  <div>
                    <label className="text-[10px] font-semibold text-emerald-800">How much junk?</label>
                    <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                      {(Object.entries(JUNK_TIERS) as Array<[typeof junkVolumeTier, typeof JUNK_TIERS[string]]>).map(([tier, info]) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => startTransition(() => applyJunkTier(tier))}
                          className={`rounded-[6px] border px-2.5 py-2 text-left text-[11px] transition ${junkVolumeTier === tier ? 'border-emerald-500 bg-white font-semibold text-emerald-800' : 'border-emerald-200 bg-white/60 text-emerald-700 hover:border-emerald-400'}`}
                        >
                          <div className="font-medium">{info.label}</div>
                          {tier !== 'unknown' && <div className="mt-0.5 text-[10px] text-emerald-600">${info.price}</div>}
                        </button>
                      ))}
                    </div>
                    {junkVolumeTier !== 'unknown' && (
                      <div className="mt-1.5 text-[10px] text-emerald-700">{JUNK_TIERS[junkVolumeTier].detail}</div>
                    )}
                  </div>

                  {/* Price override */}
                  <div className="flex items-center gap-2">
                    <label className="text-[10px] font-semibold text-emerald-800 shrink-0">Price</label>
                    <div className="flex items-center gap-1 rounded-[6px] border border-emerald-300 bg-white px-2 py-1">
                      <span className="text-xs text-emerald-700">$</span>
                      <input
                        type="number"
                        value={junkAmount}
                        onChange={e => syncJunkAmount(e.target.value)}
                        className="w-20 text-sm font-semibold text-[var(--app-ink)] focus:outline-none"
                      />
                    </div>
                    <span className="text-[10px] text-emerald-600">Override if needed</span>
                  </div>

                  {/* Photo request */}
                  <div className="rounded-[6px] border border-dashed border-emerald-300 bg-white/60 p-2.5">
                    <div className="text-[10px] font-semibold text-emerald-800 mb-1">📷 Request junk photos from customer</div>
                    <div className="text-[10px] text-emerald-700 mb-2">Send them a link → they upload photos → AI estimates volume → you confirm the price.</div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => junkPhotoLink ? setJunkSmsDialogOpen(true) : void requestJunkPhotos()}
                        disabled={junkPhotoLinkBusy || !lead.phone}
                        className="rounded-[5px] bg-emerald-600 px-3 py-1.5 text-[10px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {junkPhotoLinkBusy ? 'Generating…' : junkPhotoLink ? '✉ Send SMS again' : lead.phone ? '📷 Generate & send photo request' : 'No phone on file'}
                      </button>
                      {junkPhotoLink && (
                        <button type="button" onClick={() => void navigator.clipboard.writeText(junkPhotoLink)} className="rounded-[5px] border border-emerald-400 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-100">
                          Copy link
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Junk photo SMS dialog ── */}
              {junkSmsDialogOpen && junkPhotoLink && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
                  <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-2xl">
                    <h3 className="text-base font-semibold text-[var(--app-ink)]">📷 Send junk photo request</h3>
                    <p className="mt-1 text-xs text-[var(--app-muted)]">Review and edit the message before sending to <span className="font-semibold text-[var(--app-ink)]">{lead.phone}</span></p>
                    <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-[11px] font-medium text-[var(--app-muted)] break-all">
                      🔗 {junkPhotoLink}
                    </div>
                    <textarea
                      value={junkSmsDraft}
                      onChange={e => setJunkSmsDraft(e.target.value)}
                      rows={7}
                      className="mt-3 w-full rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2.5 text-sm leading-6 outline-none focus:border-[var(--app-accent)] resize-none"
                    />
                    <div className="mt-4 flex items-center justify-end gap-3">
                      <button type="button" onClick={() => setJunkSmsDialogOpen(false)} className="crm-button text-sm">Cancel</button>
                      <button
                        type="button"
                        onClick={() => void sendJunkPhotoSms()}
                        disabled={junkSmsSending || !junkSmsDraft.trim()}
                        className="crm-button-dark text-sm disabled:opacity-60"
                      >
                        {junkSmsSending ? 'Sending…' : `Send to ${lead.phone}`}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Valuation detail row */}
              {valuationAdded && (
                <div className="flex items-center gap-3 rounded-[6px] border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                  <div className="flex-1 text-[11px] text-emerald-800">
                    <div className="font-semibold">Declared Value Protection</div>
                    <div className="text-emerald-700">Up to $50k coverage · full replacement liability on all items</div>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-emerald-800 font-semibold">
                    <span>$</span>
                    <input
                      type="number"
                      value={valuationAmount}
                      onChange={e => syncValuationAmount(e.target.value)}
                      className="w-20 rounded-[4px] border border-emerald-300 bg-white px-2 py-1 text-right text-xs font-semibold text-[var(--app-ink)] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Packing detail when active but no AI estimate */}
              {(packingLaborAdded || packingMaterialsAdded) && !flags?.packingDayEstimate && (
                <div className="rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                  Packing added with $0 placeholders — set amounts manually in line items below.
                </div>
              )}
            </div>

            {/* ── MULTI-STOP / STAGED MOVE ── */}
            <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="crm-label">Multi-Stop Move</div>
                  <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">Leg 1 → storage, Leg 2 → new house. Or delivery stops, junk runs, daughter's place — any route.</div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const next = !legsEnabled
                    setLegsEnabled(next)
                    if (next && legs.length === 0) addLeg()
                    if (!next) { setLegs([]); onLegsChange?.([]) }
                  }}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${legsEnabled ? 'bg-[#1a2744] text-white' : 'bg-[var(--app-line)] text-[var(--app-muted)]'}`}
                >
                  {legsEnabled ? 'On' : 'Off'}
                </button>
              </div>

              {legsEnabled && (
                <div className="space-y-3">
                  {legs.map((leg, idx) => (
                    <div key={leg.id} className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                      {/* Leg header */}
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1a2744] text-[9px] font-bold text-white shrink-0">{idx + 1}</span>
                        <input
                          value={leg.label}
                          onChange={e => updateLeg(leg.id, { label: e.target.value })}
                          className="flex-1 border-0 bg-transparent text-xs font-semibold text-[var(--app-ink)] outline-none placeholder:text-[var(--app-muted)]"
                          placeholder={`Leg ${idx + 1} label`}
                        />
                        <select
                          value={leg.type}
                          onChange={e => {
                            const newType = e.target.value as QuoteLegType
                            // Auto-update label if it still matches the old default
                            const oldDefault = getLegDefaultLabel(leg.type, idx)
                            const labelIsDefault = leg.label === oldDefault || leg.label === `Leg ${idx + 1}`
                            updateLeg(leg.id, {
                              type: newType,
                              label: labelIsDefault ? getLegDefaultLabel(newType, idx) : leg.label,
                            })
                          }}
                          className="rounded-[4px] border border-[var(--app-line)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--app-muted)]"
                        >
                          {(Object.entries(LEG_TYPE_LABELS) as [QuoteLegType, string][]).map(([k, v]) => (
                            <option key={k} value={k}>{v}</option>
                          ))}
                        </select>
                        {legs.length > 1 && (
                          <button type="button" onClick={() => removeLeg(leg.id)} className="text-[var(--app-muted)] hover:text-rose-500 text-xs">×</button>
                        )}
                      </div>

                      {/* Origin / Dest */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">From</div>
                          <AddressAutocompleteInput
                            value={leg.originAddress || ''}
                            placeholder="Origin address"
                            onSelect={(addr, city) => updateLeg(leg.id, { originAddress: addr, originCity: city || leg.originCity })}
                          />
                        </div>
                        <div>
                          <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">To</div>
                          <AddressAutocompleteInput
                            value={leg.destAddress || ''}
                            placeholder="Destination"
                            onSelect={(addr, city) => updateLeg(leg.id, { destAddress: addr, destCity: city || leg.destCity })}
                          />
                        </div>
                      </div>

                      {/* Storage leg smart hints */}
                      {leg.type === 'storage' && (
                        <div className="rounded-[4px] bg-blue-50 border border-blue-200 px-2 py-1.5 text-[10px] text-blue-800 space-y-0.5">
                          <div className="font-semibold">🏢 House → Storage rules:</div>
                          <div>✓ Disassemble only at pickup — no reassembly at storage</div>
                          <div>✓ Wrap all items for storage protection</div>
                          <div>✓ No destination access penalty (storage = ground floor)</div>
                        </div>
                      )}
                      {leg.type === 'storage_delivery' && (
                        <div className="rounded-[4px] bg-emerald-50 border border-emerald-200 px-2 py-1.5 text-[10px] text-emerald-800 space-y-0.5">
                          <div className="font-semibold">📦 Storage → House rules:</div>
                          <div>✓ Reassemble only at destination — no disassembly needed</div>
                          <div>✓ No rewrapping charge — items already wrapped in storage</div>
                          <div>✓ Faster unload — crew knows the inventory from Leg 1</div>
                        </div>
                      )}
                      {leg.type === 'move' && idx > 0 && (legs[idx - 1]?.type === 'storage' || legs[idx - 1]?.type === 'storage_delivery') && (
                        <div className="rounded-[4px] bg-amber-50 border border-amber-200 px-2 py-1.5 text-[10px] text-amber-800">
                          Follows a storage leg — confirm if items need wrapping or disassembly.
                        </div>
                      )}

                      {/* Route badge + date */}
                      <div className="flex items-center gap-2">
                        {legRoutes[leg.id] ? (
                          <div className="flex items-center gap-1 rounded-full bg-sky-50 border border-sky-200 px-2 py-0.5 text-[10px] text-sky-700 font-medium">
                            <span>{legRoutes[leg.id]!.distanceKm} km · {legRoutes[leg.id]!.driveHours}h drive</span>
                          </div>
                        ) : (leg.originAddress && leg.destAddress) ? (
                          <div className="text-[10px] text-[var(--app-muted)]">Calculating route…</div>
                        ) : null}
                        <input
                          type="date"
                          value={leg.scheduledDate || ''}
                          onChange={e => updateLeg(leg.id, { scheduledDate: e.target.value })}
                          className="ml-auto rounded-[4px] border border-[var(--app-line)] px-1.5 py-0.5 text-[10px] text-[var(--app-muted)]"
                        />
                      </div>

                      <div className="flex items-center gap-2 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-1.5">
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Shipment Share</div>
                        <input
                          type="number"
                          min={5}
                          max={100}
                          value={leg.inventorySharePct ?? ''}
                          onChange={e => updateLeg(leg.id, { inventorySharePct: e.target.value ? Number(e.target.value) : undefined })}
                          className="ml-auto w-16 rounded-[4px] border border-[var(--app-line)] bg-white px-2 py-1 text-right text-[11px] text-[var(--app-ink)] outline-none focus:border-[var(--app-accent)]"
                          placeholder={leg.type === 'delivery' ? '20' : '100'}
                        />
                        <span className="text-[10px] text-[var(--app-muted)]">%</span>
                      </div>
                      <div className="text-[10px] text-[var(--app-muted)]">
                        {leg.type === 'delivery'
                          ? 'For extra stops, set roughly how much of the shipment gets dropped here. The main stop uses the remaining share.'
                          : leg.type === 'junk'
                            ? 'Optional. Use this only if the junk run is a small portion of the overall job.'
                            : 'Optional. Leave blank for full-shipment handling on this leg, or enter a share for partial pickups / split jobs.'}
                      </div>

                      {/* Notes */}
                      <input
                        value={leg.notes || ''}
                        onChange={e => updateLeg(leg.id, { notes: e.target.value })}
                        className="w-full rounded-[4px] border border-[var(--app-line)] bg-[var(--app-bg)] px-2 py-1 text-[11px] text-[var(--app-muted)] placeholder:text-[var(--app-muted)] outline-none focus:border-[var(--app-accent)]"
                        placeholder="Notes — special instructions, timing, access…"
                      />
                    </div>
                  ))}

                  <button
                    type="button"
                    onClick={addLeg}
                    className="w-full rounded-[6px] border border-dashed border-[var(--app-line)] py-2 text-[11px] font-semibold text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition-colors"
                  >
                    + Add Another Stop
                  </button>

                  <div className="rounded-[6px] bg-sky-50 border border-sky-200 px-3 py-2 text-[10px] text-sky-800">
                    Each leg now prices automatically from its own route plus the shipment share you assign. Packing, valuation, junk, and other extras still layer in below.
                  </div>
                </div>
              )}
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

            {/* Move Start Time */}
            <div className="flex items-center gap-4 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-3">
              <div className="flex-1">
                <div className="crm-label">Crew Start Time</div>
                <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">Shown on the customer quote. Default is 9:00 AM.</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="time"
                  value={moveTime || '09:00'}
                  onChange={e => onMoveTimeChange?.(e.target.value)}
                  className="rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-1.5 text-sm font-semibold text-[var(--app-ink)] focus:border-[var(--app-accent)] focus:outline-none"
                />
                <div className="flex flex-wrap gap-1">
                  {['08:00', '09:00', '10:00', '13:00'].map(t => {
                    const labels: Record<string, string> = { '08:00': '8am', '09:00': '9am', '10:00': '10am', '13:00': '1pm' }
                    const active = (moveTime || '09:00') === t
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => onMoveTimeChange?.(t)}
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${active ? 'bg-[#1a2744] text-white' : 'bg-white border border-[var(--app-line)] text-[var(--app-muted)] hover:border-[#1a2744]'}`}
                      >
                        {labels[t]}
                      </button>
                    )
                  })}
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
                {listingContextSummary ? (
                  <div className="mt-3 rounded-[8px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-800">
                    MLS property context: {listingContextSummary}
                  </div>
                ) : null}
                {listingHighlights.length > 0 ? (
                  <div className="mt-3 rounded-[8px] border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900">
                    Listing intel: {listingHighlights.join(' · ')}
                  </div>
                ) : null}
                {scanDuplicateRisks.length > 0 ? (
                  <div className="mt-3 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <div className="font-semibold">Possible duplicates</div>
                    <div className="mt-1 space-y-1">
                      {scanDuplicateRisks.slice(0, 3).map(item => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {scanConfirmationQuestions.length > 0 ? (
                  <div className="mt-3 rounded-[8px] border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-900">
                    <div className="font-semibold">Confirm with customer</div>
                    <div className="mt-1 space-y-1">
                      {scanConfirmationQuestions.slice(0, 4).map(item => (
                        <div key={item}>{item}</div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {listingDescription ? (
                  <div className="mt-3 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-xs leading-5 text-[var(--app-muted)]">
                    Listing description: {listingDescription.length > 220 ? `${listingDescription.slice(0, 217)}...` : listingDescription}
                  </div>
                ) : null}
                {/* Beds / baths from MLS — shown inline with inventory for context */}
                {(lead.supabaseListing?.beds || lead.supabaseListing?.baths || lead.supabaseListing?.bathrooms) ? (
                  <div className="mt-3 flex items-center gap-3 rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-xs text-[var(--app-muted)]">
                    <span className="font-semibold text-[var(--app-ink)]">MLS property</span>
                    {lead.supabaseListing?.beds ? <span>🛏 <strong>{lead.supabaseListing.beds}</strong> bed{Number(lead.supabaseListing.beds) !== 1 ? 's' : ''}</span> : null}
                    {(lead.supabaseListing?.baths || lead.supabaseListing?.bathrooms) ? <span>🚿 <strong>{lead.supabaseListing?.baths || lead.supabaseListing?.bathrooms}</strong> bath{Number(lead.supabaseListing?.baths || lead.supabaseListing?.bathrooms) !== 1 ? 's' : ''}</span> : null}
                    <span className="ml-auto text-[10px]">Use this to verify the bedroom count below matches</span>
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
                    const isDropTarget = dragOverRoom === room && draggedItemIndex !== null
                    return (
                      <details
                        key={room}
                        open
                        className={`rounded-[6px] border bg-[var(--app-panel)] transition-colors ${isDropTarget ? 'border-blue-400 bg-blue-50' : 'border-[var(--app-line)]'}`}
                        onDragOver={e => { e.preventDefault(); setDragOverRoom(room) }}
                        onDragLeave={() => setDragOverRoom(null)}
                        onDrop={e => {
                          e.preventDefault()
                          setDragOverRoom(null)
                          if (draggedItemIndex !== null) {
                            onUpdateInventoryItem(draggedItemIndex, 'room', room)
                            setDraggedItemIndex(null)
                          }
                        }}
                      >
                        <summary className="flex cursor-pointer items-center justify-between px-3 py-2" style={{ listStyle: 'none' }}>
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-[var(--app-ink)]">{room}</div>
                            {isDropTarget && <span className="text-[10px] font-semibold text-blue-600">Drop here</span>}
                          </div>
                          <div className="text-xs text-[var(--app-muted)]">{items.length} items · {roomCuFt} cu ft</div>
                        </summary>
                        <div className="border-t border-[var(--app-line)] px-3 py-2 space-y-1">
                          {items.map(el => {
                            const policyFinding = getMovePolicyFinding(el.item)
                            const forceExcluded =
                              el.item.included === false ||
                              (!!policyFinding?.forceExclude && el.item.policyOverride !== 'include')
                            return (
                            <div
                              key={el.index}
                              draggable
                              onDragStart={() => setDraggedItemIndex(el.index)}
                              onDragEnd={() => { setDraggedItemIndex(null); setDragOverRoom(null) }}
                              className={`rounded-[6px] border px-2 py-2 text-xs cursor-grab active:cursor-grabbing transition-opacity ${draggedItemIndex === el.index ? 'opacity-40' : ''} ${forceExcluded ? 'border-slate-200 bg-slate-50 text-slate-400' : 'border-transparent bg-white text-[var(--app-muted)]'}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0 flex items-start gap-1.5">
                                  <span className="mt-0.5 shrink-0 text-sm" title="Item type">
                                    {el.item.icon || '📦'}
                                  </span>
                                  <span className="mt-0.5 shrink-0 text-[var(--app-muted)] text-[10px] select-none" title="Drag to move to another room">⠿</span>
                                  <div className="min-w-0">
                                    <span className={`font-medium ${forceExcluded ? 'text-slate-500 line-through' : 'text-[var(--app-ink)]'}`}>{getInventoryDisplayLabel(el.item)}</span>
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
                              <div className="mt-2 flex flex-wrap items-center gap-2">
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
                                  onClick={() => setTouchMoveItemIndex(current => current === el.index ? null : el.index)}
                                  className="rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)]"
                                >
                                  {touchMoveItemIndex === el.index ? 'Done moving' : 'Move to room'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => onRemoveInventoryItem(el.index)}
                                  className="rounded-[6px] bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700"
                                >
                                  Remove
                                </button>
                                <div className="flex items-center gap-1 ml-auto">
                                  <span className="text-[10px] text-[var(--app-muted)]">Room:</span>
                                  <select
                                    value={el.item.room || 'Other'}
                                    onChange={e => onUpdateInventoryItem(el.index, 'room', e.target.value)}
                                    className="crm-input h-7 py-0 text-[10px] pr-6"
                                  >
                                    {DEFAULT_ROOM_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                                  </select>
                                </div>
                              </div>
                              {(el.item.exclusionReason || policyFinding?.customerNote) ? (
                                <div className="mt-1 text-[10px] text-slate-500">{el.item.exclusionReason || policyFinding?.customerNote}</div>
                              ) : null}
                              {touchMoveItemIndex === el.index ? (
                                <div className="mt-2 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-2">
                                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                                    Tap a room
                                  </div>
                                  <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                                    {DEFAULT_ROOM_OPTIONS.map(roomOption => (
                                      <button
                                        key={`${el.index}-${roomOption}`}
                                        type="button"
                                        onClick={() => {
                                          onUpdateInventoryItem(el.index, 'room', roomOption)
                                          setTouchMoveItemIndex(null)
                                        }}
                                        className={`rounded-[6px] border px-2 py-1.5 text-left text-[10px] font-medium transition ${
                                          (el.item.room || 'Other') === roomOption
                                            ? 'border-[var(--app-accent)] bg-white text-[var(--app-ink)]'
                                            : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[var(--app-ink)]'
                                        }`}
                                      >
                                        {roomOption}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )})}
                        </div>
                      </details>
                    )
                  })}
                  {/* Missing area prompts — Garage and Basement if not detected */}
                  {(['Garage', 'Basement'].filter(area => !groupedInventory.find(([room]) => room === area))).map(area => (
                    <div key={area} className="rounded-[6px] border border-dashed border-amber-200 bg-amber-50 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-semibold text-amber-800">{area === 'Garage' ? '🚗' : '🏠'} {area} — not detected in photos</div>
                          <div className="mt-0.5 text-[10px] text-amber-700">If there are items here, add them manually before sending the quote.</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => onAddInventoryItems([{ id: `${area.toLowerCase()}-placeholder-${Date.now()}`, name: `${area} items`, item: `${area} items`, room: area, qty: 1, cubicFeet: 0, weightLbs: 0, included: true }])}
                          className="shrink-0 rounded-[6px] bg-amber-100 px-2.5 py-1 text-[10px] font-semibold text-amber-800 hover:bg-amber-200"
                        >
                          + Add {area}
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="rounded-[10px] border border-[var(--app-line)] bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Starter Inventory</div>
                        {starterPlan ? (
                          <>
                            <div className="mt-1 text-sm font-semibold text-[var(--app-ink)]">{starterPlan.title}</div>
                            <div className="mt-1 text-[11px] text-[var(--app-muted)]">{starterPlan.summary}</div>
                          </>
                        ) : (
                          <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                            Pick the home size and property type in Lead Basics to generate a starting inventory list.
                          </div>
                        )}
                      </div>
                      {starterPlan && onApplyStarterInventory ? (
                        <button
                          type="button"
                          onClick={() => {
                            const addedCount = onApplyStarterInventory()
                            if (addedCount > 0) onRecalculate()
                          }}
                          className="crm-button text-xs px-3 py-1.5"
                        >
                          Add starter list
                        </button>
                      ) : null}
                    </div>
                    {starterPlan?.warnings.length ? (
                      <div className="mt-3 space-y-1 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                        {starterPlan.warnings.map(warning => (
                          <div key={warning}>{warning}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
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

              {/* Customer-uploaded / survey photos */}
              {(customerPhotos?.length ?? 0) > 0 && (
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-4">
                  <div className="crm-label text-emerald-800">Customer Photos <span className="ml-1 font-normal normal-case text-emerald-600">({customerPhotos!.length})</span></div>
                  <div className="mt-2 text-[10px] text-emerald-700">Photos uploaded by the customer — use these to verify the AI inventory is correct.</div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                    {customerPhotos!.map((photo, index) => (
                      <a
                        key={`customer-${index}`}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="overflow-hidden rounded-[6px] border border-emerald-200 hover:border-emerald-400 transition-colors"
                      >
                        <img src={photo} alt={`Customer photo ${index + 1}`} className="h-14 w-full object-cover" />
                      </a>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[10px] text-emerald-600">Click any photo to open full size.</div>
                </div>
              )}
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

                {/* Disassembly — with live price impact */}
                {(() => {
                  const disassemblyHours = pricingBreakdown?.adjustmentBreakdown.find(a => a.category === 'disassembly')?.hours ?? 0
                  const rate = pricingBreakdown?.crewRatePerHour ?? 0
                  const disassemblyCost = Math.round(disassemblyHours * rate)
                  return (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--app-ink)]">Disassembly / Reassembly</div>
                      {disassemblyHours > 0 && jobFactors.disassemblyItemCount !== 0 && (
                        <div className="mt-0.5 text-[10px] font-medium text-amber-700">
                          +{disassemblyHours}h · ~{formatMoney(disassemblyCost)} added to estimate
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setFactor('disassemblyItemCount', jobFactors.disassemblyItemCount === 0 ? undefined : 0)}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${jobFactors.disassemblyItemCount === 0 ? 'bg-rose-100 text-rose-700' : 'bg-emerald-50 text-emerald-700 hover:bg-rose-50 hover:text-rose-600'}`}
                    >
                      {jobFactors.disassemblyItemCount === 0 ? 'Excluded' : 'Included'}
                    </button>
                  </div>
                  {jobFactors.disassemblyItemCount === 0 ? (
                    <div className="rounded-[6px] bg-rose-50 px-3 py-2 text-xs text-rose-700">
                      Customer self-assembles — no crew time added.
                      {disassemblyHours > 0 && <span className="ml-1 font-semibold text-emerald-700">Saves ~{disassemblyHours}h · ~{formatMoney(disassemblyCost)}.</span>}
                    </div>
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
                  {/* Mode price impact hints */}
                  {jobFactors.disassemblyItemCount !== 0 && pricingBreakdown && (
                    <div className="text-[10px] text-[var(--app-muted)] leading-4 space-y-0.5">
                      <div>• <strong>Dis + Reassembly</strong> = full service, both ends — included above</div>
                      <div>• <strong>Disassemble only</strong> = ~saves {Math.round((pricingBreakdown.adjustmentBreakdown.find(a => a.category === 'disassembly')?.hours ?? 0) * 0.45 * pricingBreakdown.crewRatePerHour)} (customer reassembles at dest)</div>
                      <div>• <strong>Reassemble only</strong> = ~saves {Math.round((pricingBreakdown.adjustmentBreakdown.find(a => a.category === 'disassembly')?.hours ?? 0) * 0.45 * pricingBreakdown.crewRatePerHour)} (customer disassembles at origin)</div>
                    </div>
                  )}
                  <textarea
                    rows={2}
                    placeholder="Any other specialty notes..."
                    value={jobFactors.specialtyNotes ?? ''}
                    onChange={e => setFactor('specialtyNotes', e.target.value || undefined)}
                    className="crm-input w-full resize-none text-xs"
                  />
                </div>
                  )
                })()}
              </div>
            </div>

            {/* Line Items — grouped by service */}
            <div>
              <div className="mb-4 crm-label">Estimate Line Items</div>
              {quoteLineItems.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--app-line)] px-4 py-12 text-center text-sm text-[var(--app-muted)]">
                  No draft line items yet. Set job factors and click Recalculate, or create the draft first.
                </div>
              ) : (
                <div className="space-y-4">
                  {/* ── Moving items (not packing / junk / valuation) ── */}
                  {(() => {
                    const serviceDescriptions = new Set([
                      packingLaborLineDescription,
                      packingMaterialsLineDescription,
                      junkLineDescription,
                      valuationLineDescription,
                    ])
                    const movingItems = quoteLineItems
                      .map((item, index) => ({ item, index }))
                      .filter(({ item }) => !serviceDescriptions.has(item.description))
                    if (movingItems.length === 0) return null
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#1a2744]" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">Moving</span>
                        </div>
                        <div className="space-y-2">
                          {movingItems.map(({ item, index }) => (
                            <div key={`${item.description}-${index}`} className="grid gap-2 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_36px]">
                              <input value={item.description} onChange={e => onUpdateLineItem(index, 'description', e.target.value)} className="crm-input text-xs" placeholder="Line item" />
                              <input value={item.details || ''} onChange={e => onUpdateLineItem(index, 'details', e.target.value)} className="crm-input text-xs" placeholder="Details" />
                              <input type="number" value={item.amount} onChange={e => onUpdateLineItem(index, 'amount', e.target.value)} className="crm-input text-right text-xs" placeholder="Amount" />
                              <button onClick={() => onRemoveLineItem(index)} className="crm-button justify-center text-rose-700 hover:bg-rose-50 text-sm">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Packing items ── */}
                  {(packingLaborAdded || packingMaterialsAdded) && (() => {
                    const packingItems = quoteLineItems
                      .map((item, index) => ({ item, index }))
                      .filter(({ item }) => item.description === packingLaborLineDescription || item.description === packingMaterialsLineDescription)
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">Packing</span>
                        </div>
                        <div className="space-y-2">
                          {packingItems.map(({ item, index }) => (
                            <div key={`${item.description}-${index}`} className="grid gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_36px]">
                              <input value={item.description} onChange={e => onUpdateLineItem(index, 'description', e.target.value)} className="crm-input text-xs" placeholder="Line item" />
                              <input value={item.details || ''} onChange={e => onUpdateLineItem(index, 'details', e.target.value)} className="crm-input text-xs" placeholder="Details" />
                              <input type="number" value={item.amount} onChange={e => onUpdateLineItem(index, 'amount', e.target.value)} className="crm-input text-right text-xs" placeholder="Amount" />
                              <button onClick={() => onRemoveLineItem(index)} className="crm-button justify-center text-rose-700 hover:bg-rose-50 text-sm">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Junk Removal items ── */}
                  {junkAdded && (() => {
                    const junkItems = quoteLineItems
                      .map((item, index) => ({ item, index }))
                      .filter(({ item }) => item.description === junkLineDescription)
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">Junk Removal</span>
                        </div>
                        <div className="space-y-2">
                          {junkItems.map(({ item, index }) => (
                            <div key={`${item.description}-${index}`} className="grid gap-2 rounded-[8px] border border-orange-200 bg-orange-50 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_36px]">
                              <input value={item.description} onChange={e => onUpdateLineItem(index, 'description', e.target.value)} className="crm-input text-xs" placeholder="Line item" />
                              <input value={item.details || ''} onChange={e => onUpdateLineItem(index, 'details', e.target.value)} className="crm-input text-xs" placeholder="Details" />
                              <input type="number" value={item.amount} onChange={e => onUpdateLineItem(index, 'amount', e.target.value)} className="crm-input text-right text-xs" placeholder="Amount" />
                              <button onClick={() => onRemoveLineItem(index)} className="crm-button justify-center text-rose-700 hover:bg-rose-50 text-sm">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}

                  {/* ── Valuation items ── */}
                  {valuationAdded && (() => {
                    const valuationItems = quoteLineItems
                      .map((item, index) => ({ item, index }))
                      .filter(({ item }) => item.description === valuationLineDescription)
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-purple-500" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">Valuation / Protection</span>
                        </div>
                        <div className="space-y-2">
                          {valuationItems.map(({ item, index }) => (
                            <div key={`${item.description}-${index}`} className="grid gap-2 rounded-[8px] border border-purple-200 bg-purple-50 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_36px]">
                              <input value={item.description} onChange={e => onUpdateLineItem(index, 'description', e.target.value)} className="crm-input text-xs" placeholder="Line item" />
                              <input value={item.details || ''} onChange={e => onUpdateLineItem(index, 'details', e.target.value)} className="crm-input text-xs" placeholder="Details" />
                              <input type="number" value={item.amount} onChange={e => onUpdateLineItem(index, 'amount', e.target.value)} className="crm-input text-right text-xs" placeholder="Amount" />
                              <button onClick={() => onRemoveLineItem(index)} className="crm-button justify-center text-rose-700 hover:bg-rose-50 text-sm">×</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
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

                  {/* Per-leg route summary when multi-stop is on */}
                  {legsEnabled && legs.length > 0 && (
                    <div className="px-3 py-2.5 space-y-1.5">
                      <div className="font-semibold text-[10px] uppercase tracking-wide text-purple-700">Stop-by-Stop Route</div>
                      {legs.map((leg, idx) => {
                        const r = legRoutes[leg.id]
                        const fromShort = (leg.originAddress || leg.originCity || '—').split(',')[0]
                        const toShort = (leg.destAddress || leg.destCity || '—').split(',')[0]
                        return (
                          <div key={leg.id} className="flex items-start justify-between gap-1 text-[var(--app-muted)]">
                            <div className="flex items-start gap-1">
                              <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-purple-100 text-[8px] font-bold text-purple-700">{idx + 1}</span>
                              <span className="truncate">{fromShort} → {toShort}</span>
                            </div>
                            <span className="shrink-0 tabular-nums">
                              {r ? `${r.distanceKm} km · ${r.driveHours}h` : leg.distanceKm ? `${leg.distanceKm} km · ${leg.driveHours}h` : '—'}
                            </span>
                          </div>
                        )
                      })}
                      <div className="flex justify-between text-[10px] font-semibold text-purple-700 border-t border-purple-100 pt-1 mt-1">
                        <span>Total route</span>
                        <span>
                          {legs.reduce((s, l) => s + (legRoutes[l.id]?.distanceKm || l.distanceKm || 0), 0)} km ·{' '}
                          {legs.reduce((s, l) => s + (legRoutes[l.id]?.driveHours || l.driveHours || 0), 0)}h drive
                        </span>
                      </div>
                    </div>
                  )}

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

                  {/* TOTAL — only show final price when route is settled */}
                  <div className="px-3 py-3 bg-[#1a2744] text-white space-y-1">
                    <div className="flex justify-between font-semibold">
                      <span>{pricingBreakdown.crewSize} movers · {pricingBreakdown.truckCount} truck{pricingBreakdown.truckCount > 1 ? 's' : ''} · ${pricingBreakdown.crewRatePerHour}/hr</span>
                      <span>{routeBusy ? '…' : `${pricingBreakdown.totalHours}h`}</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-[#f5a623]">
                      <span>Estimate</span>
                      {routeBusy
                        ? <span className="text-xs font-normal text-white/60 animate-pulse">Calculating route…</span>
                        : <span>{formatMoney(pricingBreakdown.totalHours * pricingBreakdown.crewRatePerHour)}</span>
                      }
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

            {/* ── JOB PLAN (Logistics + Scope merged) ── */}
            {pricingBreakdown && (() => {
              const totalH = pricingBreakdown.totalHours
              const trucks = pricingBreakdown.truckCount
              const needsPacking = jobFactors.packingStatus === 'not-started' || jobFactors.packingStatus === 'partial'
              const hasStorage = legsEnabled && legs.some(l => l.type === 'storage' || l.type === 'storage_delivery')
              const isBigMove = trucks >= 2 || totalH >= 10

              const days: Array<{ label: string; who: string; hours: string; color: string; note?: string }> = []

              if (needsPacking) {
                days.push({
                  label: 'Packing Day',
                  who: `${flags?.packingDayEstimate?.crewSize ?? 2} packers`,
                  hours: flags?.packingDayEstimate?.hours ? `~${flags.packingDayEstimate.hours}h` : '~4-6h',
                  color: 'emerald',
                  note: 'Day before move — crew packs and labels everything',
                })
              }

              days.push({
                label: hasStorage ? 'Loading + Move to Storage' : 'Loading Day',
                who: `${pricingBreakdown.crewSize} movers · ${trucks} truck${trucks > 1 ? 's' : ''}`,
                hours: `~${pricingBreakdown.loadHours + pricingBreakdown.driveHours}h`,
                color: 'blue',
                note: hasStorage ? 'Load, transit to storage, unload — no reassembly' : trucks >= 2 ? 'Both trucks load simultaneously — faster' : 'Load, transit, offload',
              })

              if (hasStorage) {
                days.push({
                  label: 'Storage → New Home',
                  who: `${pricingBreakdown.crewSize} movers`,
                  hours: `~${pricingBreakdown.unloadHours + 1}h`,
                  color: 'purple',
                  note: 'Pickup from storage, deliver + reassemble — no rewrap charge',
                })
              } else if (isBigMove && flags?.twoDayMoveEstimate) {
                days.push({
                  label: 'Unloading Day',
                  who: `${pricingBreakdown.crewSize} movers`,
                  hours: `~${flags.twoDayMoveEstimate.day2Hours}h`,
                  color: 'purple',
                  note: 'Fresh crew — unwrap, place, reassemble',
                })
              }

              // Scope items
              const scopeLines: string[] = [
                `${effectiveInventoryMetrics.totalItems} items · ${effectiveInventoryMetrics.totalCubicFeet} cu ft · wrap + pad all furniture`,
              ]
              if (includedDisassemblyItems.length > 0) {
                scopeLines.push(`${disassemblyScopeLabel}: ${includedDisassemblyItems.join(', ')}`)
              }
              pricingBreakdown.specialtyItemFlags.forEach(item => scopeLines.push(`Specialty handling: ${item}`))
              if (jobFactors.specialtyNotes?.trim()) scopeLines.push(jobFactors.specialtyNotes.trim())

              const colorMap: Record<string, string> = {
                emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
                blue: 'border-blue-200 bg-blue-50 text-blue-800',
                purple: 'border-purple-200 bg-purple-50 text-purple-800',
              }

              return (
                <div>
                  <div className="crm-label mb-3">Job Plan</div>
                  <div className="rounded-[8px] border border-[var(--app-line)] overflow-hidden">
                    {/* Day cards */}
                    {days.length > 0 && (
                      <div className={`divide-y divide-[var(--app-line)] ${days.length === 0 ? '' : ''}`}>
                        {days.map((day, i) => (
                          <div key={i} className={`px-3 py-2.5 ${colorMap[day.color]}`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/60 text-[9px] font-bold">D{i + 1}</span>
                                <span className="text-xs font-semibold">{day.label}</span>
                              </div>
                              <span className="text-[10px] font-semibold">{day.hours}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] opacity-80">{day.who}{day.note ? ` · ${day.note}` : ''}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Scope lines */}
                    <div className="px-3 py-2.5 bg-white space-y-1">
                      {scopeLines.map((line, i) => (
                        <div key={i} className="text-[11px] text-[var(--app-muted)]">✓ {line}</div>
                      ))}
                      {pricingBreakdown.pricingStatus === 'provisional' && (
                        <div className="text-[11px] text-amber-700">⚠ Travel time provisional — add destination address</div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })()}


            {/* U-Haul Job Cost Calculator */}
            {pricingBreakdown && (distanceKm > 0 || (route?.distanceKm ?? 0) > 0) && (() => {
              const oneWayKm = distanceKm || route?.distanceKm || 0
              const truckCount = pricingBreakdown.truckCount || 1
              const tripStrategy = (pricingBreakdown.tripStrategy || 'single_truck') as TripStrategy
              const totalCubicFeet = pricingBreakdown.totalCubicFeet || effectiveInventoryMetrics.totalCubicFeet || 0
              const truckSize = truckSizeFromCubicFeet(totalCubicFeet)
              const defaultBlankets = DEFAULT_BLANKET_BAGS[truckSize] ?? 6
              const blanketBags = uhaulBlankets ?? (defaultBlankets * truckCount)
              const estimatedHours = pricingBreakdown.totalHours || 3
              const crewSize = pricingBreakdown.crewSize || 3
              const revenue = quoteModalTotals.subtotal || 0

              const pickupKm = uhaulPickupKm ?? 0
              const blanketBagsPerTruck = uhaulBlankets != null
                ? Math.max(1, Math.round(uhaulBlankets / truckCount))
                : defaultBlankets

              // Use selected strategy if rep toggled one, otherwise use detected strategy
              const activeStrategy = uhaulSelectedStrategy ?? tripStrategy
              const activeTruckCount = activeStrategy === 'two_trucks' ? 2
                : activeStrategy === 'three_trucks' ? 3 : 1
              const activeBlankets = blanketBagsPerTruck * activeTruckCount

              const cost = calcUHaulCost({
                truckSize, truckCount: activeTruckCount, tripStrategy: activeStrategy,
                oneWayDistanceKm: oneWayKm, uhaulPickupKm: pickupKm,
                gasPrice: uhaulGasPrice, blanketBags: activeBlankets,
                includeStraightDrop: uhaulStraightDrop,
                crewSize, estimatedHours, miscBuffer: uhaulMisc, revenue,
              })

              const showComparison = oneWayKm > 0 && oneWayKm < 120
              const comparison = showComparison
                ? compareStrategies(
                    { truckSize, oneWayDistanceKm: oneWayKm, uhaulPickupKm: pickupKm, gasPrice: uhaulGasPrice, includeStraightDrop: uhaulStraightDrop, crewSize, estimatedHours, miscBuffer: uhaulMisc, revenue },
                    blanketBagsPerTruck
                  )
                : null

              return (
                <div className="border border-[var(--app-line)] rounded-[10px] overflow-hidden">
                  {/* Header — always visible */}
                  <button
                    type="button"
                    onClick={() => setUhaulOpen(o => !o)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 bg-[var(--app-surface)] hover:bg-[var(--app-line)]/40 transition text-left"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-[var(--app-ink)]">Live Margin</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${cost.grossMarginPct >= 55 ? 'text-emerald-700' : cost.grossMarginPct >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>
                        {formatMoney(cost.grossProfit)} · {cost.grossMarginPct.toFixed(1)}%
                      </span>
                      <span className="text-[var(--app-muted)] text-[10px]">{uhaulOpen ? '▲' : '▼'}</span>
                    </div>
                  </button>

                  {uhaulOpen && (
                    <div className="px-3.5 pb-3.5 pt-2 bg-white space-y-3">

                      {/* U-Haul Job Cost */}
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">🚛 U-Haul Job Cost</div>
                          {uhaulDepotName && (
                            <div className="text-[10px] text-[var(--app-muted)] truncate max-w-[180px]" title={uhaulDepotName}>
                              📍 {uhaulDepotName}{pickupKm > 0 ? ` · ${pickupKm} km away` : ''}
                            </div>
                          )}
                        </div>
                        {/* Route summary */}
                        <div className="text-[10px] text-[var(--app-muted)] mb-1.5 font-mono bg-slate-50 rounded px-2 py-1">
                          {activeStrategy === 'single_truck_two_trips'
                            ? `UHaul(${pickupKm}km) → Org → Dest(${oneWayKm}km) → Org → Dest → UHaul · total ${Math.round(cost.totalOperationalKm)}km`
                            : `UHaul(${pickupKm}km) → Org → Dest(${oneWayKm}km) → UHaul${activeTruckCount > 1 ? ` × ${activeTruckCount} trucks` : ''} · total ${Math.round(cost.totalOperationalKm)}km`}
                        </div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">{activeTruckCount}× {truckSize} rental (1 day)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.dailyRental)}</span>
                          </div>
                          {pickupKm > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--app-muted)]">
                                {activeStrategy === 'single_truck_two_trips'
                                  ? `UHaul→Org→Dest→Org→Dest→UHaul · depot legs: ${pickupKm * 2} km`
                                  : `UHaul→Origin→Dest→UHaul${activeTruckCount > 1 ? ` × ${activeTruckCount} trucks` : ''} · depot: ${pickupKm * 2 * activeTruckCount} km`}
                              </span>
                              <span className="text-[var(--app-muted)]">{pickupKm * 2 * activeTruckCount} km</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Mileage total ({Math.round(cost.totalOperationalKm)} km @ $0.99)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.mileageCharge)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Fuel (~{Math.round(cost.totalOperationalKm * (UHAUL_FUEL_L_PER_100KM[truckSize] ?? 23.5) / 100)}L @ ${uhaulGasPrice.toFixed(2)}/L)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.fuelCost)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">SafeMove + blankets + HST</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.safeMoveInsurance + cost.blankets + cost.truckHST)}</span>
                          </div>
                          {uhaulStraightDrop && (
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--app-muted)]">Straight drop</span>
                              <span className="text-[var(--app-ink)]">{formatMoney(cost.straightDrop)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs font-semibold border-t border-[var(--app-line)] pt-1.5">
                            <span>U-Haul total</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.truckTotal)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Labour */}
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">👷 Labour</div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">{crewSize} movers × {estimatedHours}h @ $25/hr</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.laborCost)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Miscellaneous */}
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">📦 Miscellaneous</div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Food + crew gas buffer</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.miscCost)}</span>
                          </div>
                        </div>
                      </div>

                      {/* P&L summary */}
                      <div className="border-t border-[var(--app-line)] pt-2 space-y-1">
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Revenue (pre-tax)</span>
                          <span className="text-[var(--app-ink)]">{formatMoney(revenue)}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-[var(--app-muted)]">Total cost</span>
                          <span className="text-[var(--app-ink)]">{formatMoney(cost.totalCost)}</span>
                        </div>
                        <div className={`flex justify-between text-sm font-bold pt-0.5 ${cost.grossMarginPct >= 55 ? 'text-emerald-700' : cost.grossMarginPct >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>
                          <span>Gross profit</span>
                          <span>{formatMoney(cost.grossProfit)} ({cost.grossMarginPct.toFixed(1)}%)</span>
                        </div>
                      </div>

                      {/* Trip strategy toggle — clickable cards that recalculate the whole panel */}
                      {comparison && (
                        <div className="border-t border-[var(--app-line)] pt-2">
                          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">Switch Strategy</div>
                          <div className="grid grid-cols-2 gap-1.5">
                            {([
                              { label: '1 truck · 2 trips', strategy: 'single_truck_two_trips' as TripStrategy, data: comparison.oneTruckTwoTrips },
                              { label: '2 trucks · 1 trip', strategy: 'two_trucks' as TripStrategy, data: comparison.twoTrucksOneTrip },
                            ]).map(({ label, strategy, data }) => {
                              const isActive = activeStrategy === strategy
                              const isCheaper = data.truckTotal <= Math.min(comparison.oneTruckTwoTrips.truckTotal, comparison.twoTrucksOneTrip.truckTotal)
                              const timing = calcStrategyTiming(
                                strategy,
                                {
                                  loadHours: pricingBreakdown.loadHours,
                                  driveHours: pricingBreakdown.driveHours,
                                  unloadHours: pricingBreakdown.unloadHours,
                                  totalHours: pricingBreakdown.totalHours,
                                  penaltyHours: pricingBreakdown.penaltyHours,
                                  totalCubicFeet: pricingBreakdown.totalCubicFeet,
                                  totalWeightLbs: effectiveInventoryMetrics.totalWeightLbs,
                                },
                                flags ?? null,
                              )
                              return (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => setUhaulSelectedStrategy(strategy)}
                                  className={`rounded-[6px] border px-2.5 py-2 text-left transition ${
                                    isActive
                                      ? 'border-[#1a2744] bg-[#1a2744]/5 ring-1 ring-[#1a2744]/20'
                                      : 'border-[var(--app-line)] hover:border-[var(--app-muted)]'
                                  }`}
                                >
                                  <div className="text-[10px] font-semibold text-[var(--app-ink)]">{label}</div>
                                  <div className="text-sm font-bold text-[var(--app-ink)] mt-0.5">{formatMoney(data.truckTotal)}</div>
                                  {/* Timing phases */}
                                  <div className="mt-1.5 space-y-0.5">
                                    {timing.phases.map((p, i) => (
                                      <div key={i} className="text-[9px] text-[var(--app-muted)]">
                                        <span className="font-semibold text-[var(--app-ink)]">{p.end}</span>{p.note ? ` · ${p.note}` : ` · ${p.label}`}
                                      </div>
                                    ))}
                                    {timing.warning && (
                                      <div className="text-[9px] text-amber-700 font-semibold mt-0.5">⚠ {timing.warning}</div>
                                    )}
                                  </div>
                                  <div className="text-[9px] mt-1 space-x-1">
                                    {isActive && <span className="text-[#1a2744] font-semibold">● Active</span>}
                                    {!isActive && isCheaper && <span className="text-emerald-700 font-semibold">★ Lower truck cost</span>}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })()}

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
                    <div className="mt-2 rounded-[6px] border border-amber-200 bg-amber-50 px-2.5 py-2 space-y-2">
                      <div className="text-[10px] text-amber-800">
                        Confirm before sending: {warningReadiness.map(item => item.detail).join(' · ')}
                      </div>
                      {!jobFactors.packingStatus && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] text-amber-700 font-medium">Packing?</span>
                          {(['not-started', 'partial', 'packed'] as const).map(s => (
                            <button
                              key={s}
                              type="button"
                              onClick={() => setFactor('packingStatus', s)}
                              className="rounded-[4px] border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-800 hover:bg-amber-100 transition"
                            >
                              {s === 'not-started' ? 'Not started' : s === 'partial' ? 'Partial' : 'Fully packed'}
                            </button>
                          ))}
                        </div>
                      )}
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
              {/* Long-Distance Pricing Calculator */}
              {(route?.category === 'long-distance' || quoteType === 'long_distance') && (() => {
                const uhaulPerTruck = Math.round(Number(uhaulInputPerTruck || 0) * 100) / 100
                const ldTruckCount = pricingBreakdown?.truckCount || 1
                const ldTruckOperational = Math.round(uhaulPerTruck * 1.5 * 100) / 100
                const ldLaborCost = ldTruckCount >= 2 ? 3000 : 2000
                const ldTotalCost = uhaulPerTruck > 0 ? Math.round((ldTruckOperational * ldTruckCount + ldLaborCost) * 100) / 100 : 0
                const ldFloor = ldTotalCost > 0 ? Math.round(ldTotalCost / 0.60 * 100) / 100 : 0
                const ldTarget = ldTotalCost > 0 ? Math.round(ldTotalCost / 0.50 * 100) / 100 : 0
                const ldCeiling = ldTotalCost > 0 ? Math.round(ldTotalCost / 0.44 * 100) / 100 : 0
                const originCityForUrl = originCity || originAddress || ''
                const destCityForUrl = destCity || destAddress || ''
                const uhaulUrl = originCityForUrl && destCityForUrl
                  ? `https://www.uhaul.com/Truck-Rentals/?go=movingequipment&size=26ft&OneWay=true`
                  : 'https://www.uhaul.com/Truck-Rentals/One-Way-Truck-Rentals.aspx'
                return (
                  <div className="mt-4 rounded-[10px] border border-blue-200 bg-blue-50 p-3 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-blue-900">Long-Distance Pricing</div>
                        <div className="text-[10px] text-blue-700 mt-0.5">
                          {route?.distanceKm ? `${route.distanceKm} km · ` : ''}{ldTruckCount} truck{ldTruckCount === 1 ? '' : 's'} detected — U-Haul one-way
                        </div>
                      </div>
                      <a
                        href={uhaulUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded-[6px] bg-blue-700 px-2.5 py-1.5 text-[10px] font-semibold text-white hover:bg-blue-800 transition"
                      >
                        Check U-Haul →
                      </a>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[10px] font-semibold text-blue-800 uppercase tracking-wide">U-Haul quote (per truck)</div>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--app-muted)]">$</span>
                        <input
                          type="number"
                          min={0}
                          step={50}
                          value={uhaulInputPerTruck}
                          onChange={e => setUhaulInputPerTruck(e.target.value)}
                          placeholder="e.g. 2000"
                          className="crm-input pl-5 w-full text-sm font-semibold"
                        />
                      </div>
                      {ldTruckCount >= 2 && uhaulPerTruck > 0 && (
                        <div className="text-[10px] text-blue-700">{ldTruckCount} trucks × {formatMoney(uhaulPerTruck)} = {formatMoney(uhaulPerTruck * ldTruckCount)} total U-Haul</div>
                      )}
                    </div>

                    {uhaulPerTruck > 0 && ldTotalCost > 0 && (
                      <div className="rounded-[8px] bg-white border border-blue-200 p-2.5 space-y-1.5 text-[10px]">
                        <div className="flex justify-between text-blue-800">
                          <span>Truck cost × 1.5 (gas + insurance)</span>
                          <span className="font-semibold">{formatMoney(ldTruckOperational * ldTruckCount)}</span>
                        </div>
                        <div className="flex justify-between text-blue-800">
                          <span>Labor (load + unload, baked in)</span>
                          <span className="font-semibold">{formatMoney(ldLaborCost)}</span>
                        </div>
                        <div className="flex justify-between text-blue-900 font-semibold border-t border-blue-100 pt-1.5">
                          <span>Our total cost</span>
                          <span>{formatMoney(ldTotalCost)}</span>
                        </div>
                        <div className="border-t border-blue-100 pt-1.5 space-y-1">
                          <div className="flex justify-between text-blue-700">
                            <span>Floor — 40% margin</span>
                            <span className="font-semibold">{formatMoney(ldFloor)}</span>
                          </div>
                          <div className="flex justify-between text-blue-900 font-bold">
                            <span>Target — 50% margin</span>
                            <span>{formatMoney(ldTarget)}</span>
                          </div>
                          <div className="flex justify-between text-blue-700">
                            <span>Ceiling — 56% margin</span>
                            <span className="font-semibold">{formatMoney(ldCeiling)}</span>
                          </div>
                          <div className="text-blue-600 text-[9px] pt-0.5">All pre-tax · customer pays +HST on top</div>
                        </div>
                      </div>
                    )}

                    {uhaulPerTruck > 0 && ldTarget > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-[10px] text-blue-700 font-medium">
                          Range: {formatMoney(ldFloor)} – {formatMoney(ldCeiling)} · Sweet spot: {formatMoney(ldTarget)} + HST = {formatMoney(Math.round(ldTarget * 1.13 * 100) / 100)}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onSetLineItems([{
                              description: 'Long-Distance Moving Service — All Inclusive',
                              details: `U-Haul one-way · ${ldTruckCount} truck${ldTruckCount === 1 ? '' : 's'} · packing, loading, transport, unloading`,
                              amount: ldTarget,
                            }])
                            setOverrideInput(String(ldTarget))
                            setOverrideApplied(true)
                            setBookTodayActive(false)
                            setTenPctActive(false)
                          }}
                          className="w-full rounded-[6px] bg-blue-700 px-3 py-2 text-[11px] font-semibold text-white hover:bg-blue-800 transition"
                        >
                          Lock in flat rate — {formatMoney(ldTarget)} + HST
                        </button>
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Discounts & Deals */}
              <div className="mt-4 space-y-2">

                {/* Price Override */}
                {overrideApplied && (
                  <div className="rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 flex items-center justify-between gap-2">
                    <span>⚠ Override active — {formatMoney(Number(overrideInput) || 0)} + HST = {formatMoney(Math.round(Number(overrideInput) * 1.13 * 100) / 100)} total</span>
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
                    Enter the <span className="font-semibold text-[var(--app-ink)]">pre-tax base price</span>. HST (13%) is added on top. Healthy-margin overrides are allowed, but every override needs a quick note.
                  </div>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--app-muted)]">$</span>
                      <input
                        type="number"
                        min={0}
                        step={50}
                        value={overrideInput}
                        onChange={e => {
                          setOverrideInput(e.target.value)
                          setOverrideApplied(false)
                          setApprovedOverrideAmount(null)
                          setOverrideApprovalNotice(null)
                        }}
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
                  <textarea
                    value={overrideNote}
                    onChange={e => {
                      setOverrideNote(e.target.value)
                      setOverrideApplied(false)
                      setOverrideApprovalNotice(null)
                    }}
                    rows={2}
                    placeholder="Quick note: why are we overriding this price?"
                    className="crm-input w-full text-xs"
                  />
                  {overrideInput && Number(overrideInput) > 0 && (
                    <div className="text-[10px] text-[var(--app-muted)]">
                      {formatMoney(Number(overrideInput))} + HST (13%) = <span className="font-semibold text-[var(--app-ink)]">{formatMoney(Math.round(Number(overrideInput) * 1.13 * 100) / 100)}</span> total
                    </div>
                  )}
                  {overrideProjectedMargin !== null && (
                    <div className={`text-[10px] ${overrideProjectedMargin < 55 ? 'text-rose-700' : 'text-[var(--app-muted)]'}`}>
                      Projected margin after override: {overrideProjectedMargin.toFixed(1)}%
                      {overrideProjectedMargin < 55 ? canApproveMarginException ? ' · manager approval should be documented.' : ' · owner/manager approval required below threshold.' : ' · healthy margin, approval code not required.'}
                    </div>
                  )}
                  {overrideProjectedMargin === null && currentUser?.role === 'sales_rep' && (
                    <div className="text-[10px] text-amber-700">
                      Margin cannot be confirmed yet, so owner/manager approval is required for this override.
                    </div>
                  )}
                  {overrideNeedsApproval && (
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-2.5">
                      <div className="text-[10px] font-semibold text-amber-800">This override needs owner/manager approval because the margin is below threshold or unknown.</div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                        <input
                          value={overrideApprovalCode}
                          onChange={e => setOverrideApprovalCode(e.target.value.toUpperCase())}
                          placeholder="Approval code"
                          className="crm-input text-xs font-semibold tracking-[0.18em]"
                        />
                        <button
                          type="button"
                          onClick={() => void verifyOverrideApproval()}
                          disabled={!overrideApprovalCode.trim() || overrideApprovalBusy}
                          className="rounded-[6px] border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-40"
                        >
                          Verify
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => void requestOverrideApproval()}
                        disabled={!overrideInput || overrideAmount <= 0 || overrideNote.trim().length < 6 || overrideApprovalBusy}
                        className="mt-2 w-full rounded-[6px] bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
                      >
                        {overrideApprovalBusy ? 'Working...' : 'Request Owner/Manager Approval'}
                      </button>
                    </div>
                  )}
                  {overrideApprovalNotice && (
                    <div className={`rounded-[6px] px-2.5 py-2 text-[10px] ${overrideApprovalNotice.toLowerCase().includes('invalid') || overrideApprovalNotice.toLowerCase().includes('expired') || overrideApprovalNotice.toLowerCase().includes('failed') ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                      {overrideApprovalNotice}
                    </div>
                  )}
                  <button
                    type="button"
                    disabled={
                      !overrideInput ||
                      overrideAmount <= 0 ||
                      overrideNote.trim().length < 6 ||
                      (overrideNeedsApproval && !canApproveMarginException && !overrideApprovalMatches)
                    }
                    onClick={applyOverrideLineItem}
                    className="w-full rounded-[6px] bg-rose-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-800 disabled:opacity-40 transition"
                  >
                    {overrideNeedsApproval && !overrideApprovalMatches ? 'Apply Override After Approval' : 'Apply Override'}
                  </button>
                </div>

                {/* Realtor Referral — 20% off */}
                {lead.source === 'realtor_referral' && (() => {
                  const refDiscountDesc = 'Realtor Referral Discount (20%)'
                  const refDiscountAdded = quoteLineItems.some(li => li.description === refDiscountDesc)
                  const refAmount = Math.round(baseQuoteSubtotal * 0.20 * 100) / 100
                  return (
                    <div className="rounded-[8px] border border-amber-200 bg-amber-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-amber-900">Realtor Referral — 20% off</div>
                          <div className="text-[10px] text-amber-700">Referred by {lead.realtorName || 'realtor partner'}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (refDiscountAdded) {
                              const idx = quoteLineItems.findIndex(li => li.description === refDiscountDesc)
                              if (idx >= 0) onRemoveLineItem(idx)
                            } else {
                              onSetLineItems([...quoteLineItems, {
                                description: refDiscountDesc,
                                details: `Referred by ${lead.realtorName || 'realtor partner'} — 20% partner rate`,
                                amount: -refAmount,
                              }])
                            }
                          }}
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition-colors ${refDiscountAdded ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700 hover:bg-amber-200'}`}
                        >
                          {refDiscountAdded ? '✓ Applied' : `Apply −${formatMoney(refAmount)}`}
                        </button>
                      </div>
                    </div>
                  )
                })()}

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
                {liveMarginSummary && liveMarginSummary.liveMargin < 50 && liveMarginSummary.actualRevenue > 0 && !marginGateAck && (
                  <div className={`rounded-[8px] border px-3 py-3 ${liveMarginSummary.liveMargin < 40 ? 'border-rose-300 bg-rose-50' : 'border-amber-200 bg-amber-50'}`}>
                    <div className={`text-xs font-bold ${liveMarginSummary.liveMargin < 40 ? 'text-rose-800' : 'text-amber-800'}`}>
                      {liveMarginSummary.liveMargin < 40 ? '⛔ Low margin — manager review required' : '⚠ Below target margin'}
                    </div>
                    <div className={`mt-1 text-[11px] ${liveMarginSummary.liveMargin < 40 ? 'text-rose-700' : 'text-amber-700'}`}>
                      This quote is at {liveMarginSummary.liveMargin.toFixed(1)}% margin. Target is 65%+.
                      Revenue {formatMoney(liveMarginSummary.actualRevenue)} — Costs {formatMoney(liveMarginSummary.totalCost)} — Profit {formatMoney(liveMarginSummary.liveProfit)}.
                    </div>
                    <button
                      type="button"
                      onClick={() => setMarginGateAck(true)}
                      className={`mt-2 w-full rounded-[6px] px-3 py-1.5 text-[11px] font-semibold ${liveMarginSummary.liveMargin < 40 ? 'bg-rose-700 text-white hover:bg-rose-800' : 'bg-amber-700 text-white hover:bg-amber-800'}`}
                    >
                      I understand — send anyway
                    </button>
                  </div>
                )}
                <button onClick={() => void handlePreviewSend()} disabled={quoteModalBusy || routeBusy || !quote || (liveMarginSummary !== null && liveMarginSummary.liveMargin < 50 && liveMarginSummary.actualRevenue > 0 && !marginGateAck)} className="w-full justify-center rounded-[8px] bg-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity">
                  {routeBusy ? 'Calculating route…' : quoteModalBusy ? 'Saving...' : 'Preview & Send →'}
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
