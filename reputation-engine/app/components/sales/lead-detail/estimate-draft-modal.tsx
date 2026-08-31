'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useCurrentUser } from '@/lib/hooks/use-current-user'
import { formatListingContextSummary, getListingDescription, getListingOperationalHighlights } from '@/lib/listing'
import { getQuotedTruckCount } from '@/lib/operations'
import { fetchSalesOverview, requestPriceOverrideApproval, verifyPriceOverrideApproval } from '@/lib/sales-api'
import { estimateLeadQuote, deriveInventoryMetrics, formatMoney, getSalesBranchLabel, isBookedLikeStage, suggestTruckCount, detectSalesBranchFromLocation } from '@/lib/sales'
import { INVENTORY_PRESETS, createInventoryItemFromPreset, matchInventoryPreset } from '@/lib/item-presets'
import { getDisassemblyServiceLabel, getIncludedDisassemblyItems } from '@/lib/move-scope'
import { formatMovePolicyCategoryLabel, getMovePolicyFinding, summarizeMovePolicy } from '@/lib/move-policy'
import { getTvBoxMaterialPresetForSize } from '@/lib/packing-materials'
import { buildStarterInventoryPlan } from '@/lib/starter-inventory'
import { buildInventorySnapshotCopyText } from '@/lib/inventory-copy'
import { buildCustomerQuoteScope } from '@/lib/customer-quote-content'
import { resolveOntarioPriceOverride, type OntarioPriceOverrideMode } from '@/lib/quote-pricing-safety'
import { deriveAccessComplexityAssessment } from '@/lib/access-intelligence'
import { deriveMoveLogisticsPlan, type LogisticsOption } from '@/lib/move-logistics'
import { prepareUploadFile } from '@/lib/browser-media'
import { PhotoLightbox } from '@/app/components/sales/photo-lightbox'
import { AccessProfileEditor } from './access-profile-editor'
import { accessProfilesForStops } from '@/lib/access-profile'
import { DEFAULT_ROOM_OPTIONS } from './helpers'
import type { CustomerQuoteScope, EstimateRouteContext, JobFactors, CRMLead, CRMQuote, InventoryItem, LeadMediaAsset, PricingBreakdown, QuoteLineItem, QuoteLeg, QuoteLegType } from '@/lib/types'
import { buildServiceProfitabilityPlan } from '@/lib/service-profitability'
import { buildContributionPricingPlan, buildProtectionRecommendation } from '@/lib/contribution-pricing'
import { buildConsultativeMovePlan } from '@/lib/consultative-move-plan'
import { removeStorageQuoteScope, type QuoteType } from '@/lib/storage-quote-scope'
import { qualifyMoveAddress } from '@/lib/route-address'
import { evaluateQuoteReadiness, HIDDEN_INVENTORY_AREAS } from '@/lib/quote-readiness'
import { buildEstimateWorkflowStages, nextEstimateWorkflowStage, type EstimateWorkflowStageId } from '@/lib/estimate-workflow'
import { selectedAddressCity } from '@/lib/address-city'
import type { HiddenInventoryArea, MoveEvidenceState } from '@/lib/types'
import {
  calcUHaulCost, compareStrategies, truckSizeFromCubicFeet, calcStrategyTiming, calcLongDistanceUHaul,
  DEFAULT_BLANKET_BAGS, DEFAULT_GAS_PRICE_PER_L, DEFAULT_MISC_BUFFER,
  UHAUL_DAILY_RATES, UHAUL_PER_KM_RATE, UHAUL_FUEL_L_PER_100KM, UHAUL_BLANKET_BAG_COST, type TripStrategy,
} from '@/lib/uhaul-calculator'

// Inline address autocomplete — shares the same API as lead-basics-panel
function AddressAutocompleteInput({ value, placeholder, onSelect }: {
  value: string
  placeholder: string
  onSelect: (address: string, city?: string, placeType?: string, placeId?: string) => void
}) {
  const [raw, setRaw] = useState(value)
  const [suggestions, setSuggestions] = useState<Array<{ label: string; city?: string; country?: string; countryCode?: 'ca' | 'us'; placeType?: string; placeId?: string }>>([])
  const [open, setOpen] = useState(false)
  const [fetching, setFetching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const focusedRef = useRef(false)
  const latestQueryRef = useRef('')
  const suggestionSelectedRef = useRef(false)
  useEffect(() => {
    if (!focusedRef.current) setRaw(value)
  }, [value])
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])
  useEffect(() => {
    function h(e: MouseEvent) { if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  function handleChange(val: string) {
    setRaw(val)
    suggestionSelectedRef.current = false
    onSelect(val)
    latestQueryRef.current = val
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (val.length < 4) { setSuggestions([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      setFetching(true)
      try {
        const res = await fetch(`/api/sales/address-suggest?q=${encodeURIComponent(val)}`, { credentials: 'include' })
        const data = (await res.json()) as { suggestions?: Array<{ label: string; city?: string; country?: string; countryCode?: 'ca' | 'us'; placeType?: string; placeId?: string }> }
        if (latestQueryRef.current !== val) return
        const list = data.suggestions || []
        setSuggestions(list)
        if (list.length > 0) setOpen(true)
      } catch {
        if (latestQueryRef.current === val) setSuggestions([])
      } finally {
        if (latestQueryRef.current === val) setFetching(false)
      }
    }, 350)
  }
  function select(s: { label: string; city?: string; country?: string; countryCode?: 'ca' | 'us'; placeType?: string; placeId?: string }) {
    suggestionSelectedRef.current = true
    setRaw(s.label)
    setSuggestions([])
    setOpen(false)
    onSelect(s.label, selectedAddressCity(s.label, s.city), s.placeType, s.placeId)
  }
  return (
    <div ref={containerRef} className="relative">
      <input value={raw} onChange={e => handleChange(e.target.value)}
        onFocus={() => {
          focusedRef.current = true
          if (suggestions.length > 0) setOpen(true)
        }}
        onBlur={() => {
          focusedRef.current = false
          // Blur occurs before a suggestion's click. Let an explicit click win;
          // otherwise resolve typed street text to the best match and save city.
          setTimeout(() => {
            if (suggestionSelectedRef.current) return
            const bestMatch = suggestions[0]
            if (bestMatch && latestQueryRef.current === raw) select(bestMatch)
            else onSelect(raw, selectedAddressCity(raw))
          }, 100)
        }}
        className="w-full rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2 text-sm outline-none focus:border-[var(--app-accent)] focus:ring-1 focus:ring-[var(--app-accent)]"
        placeholder={placeholder} autoComplete="off" />
      {fetching && <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 block h-3 w-3 animate-spin rounded-full border-2 border-[var(--app-accent)] border-t-transparent" />}
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-[min(42rem,calc(100vw-2rem))] overflow-y-auto rounded-[8px] border border-[var(--app-line)] bg-white shadow-lg">
          {suggestions.map((s, i) => (
            <button key={i} type="button" onMouseDown={() => select(s)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-[var(--app-bg)]">
              <span className="text-[10px]">{s.placeType === 'apartment' ? '🏢' : '🏠'}</span>
              <span className="min-w-0 flex-1 whitespace-normal break-words text-sm leading-5 text-[var(--app-ink)]">{s.label}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${s.countryCode === 'ca' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                {s.countryCode === 'ca' ? 'Canada' : s.countryCode === 'us' ? 'USA' : s.country || 'Address'}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type RouteResult = {
  branch?: 'windsor' | 'waterloo' | 'london' | 'ottawa'
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
  conditionalClause?: string
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
  customerScope?: CustomerQuoteScope
  scopeStatus?: 'confirmed' | 'provisional'
}

type QuoteWorkspaceSendOptions = QuoteWorkspaceSaveOptions & {
  provisional?: boolean
  missingItems?: string[]
}

type QuoteReadinessItem = {
  category: 'evidence' | 'inventory' | 'logistics' | 'commercial'
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

function isCustomerFacingQuote(quote?: CRMQuote | null) {
  if (!quote) return false
  return Boolean(
    quote.billingModel === 'binding' ||
    quote.sentAt ||
    quote.viewedAt ||
    quote.acceptedAt ||
    quote.depositPaidAt ||
    ['sent', 'viewed', 'accepted', 'invoiced'].includes(quote.status)
  )
}

function normalizeQuoteLineItemsForCompare(items?: QuoteLineItem[]) {
  return (items || []).map(item => ({
    description: (item.description || '').trim(),
    details: (item.details || '').trim(),
    amount: Math.round(Number(item.amount || 0) * 100) / 100,
  }))
}

function quotePricingInputsMatchSaved(
  quote: CRMQuote,
  lineItems: QuoteLineItem[],
  discountAmount: number,
  discountLabel: string
) {
  const savedDiscountAmount = Math.round(Number(quote.discountAmount || 0) * 100) / 100
  const nextDiscountAmount = Math.round(Number(discountAmount || 0) * 100) / 100
  return (
    JSON.stringify(normalizeQuoteLineItemsForCompare(quote.lineItems)) === JSON.stringify(normalizeQuoteLineItemsForCompare(lineItems)) &&
    savedDiscountAmount === nextDiscountAmount &&
    (quote.discountLabel || '').trim() === (discountLabel || '').trim()
  )
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
  mediaAssets?: LeadMediaAsset[]
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
  onLeadMediaSynced?: (lead: CRMLead) => void
  legs?: QuoteLeg[]
  onLegsChange?: (legs: QuoteLeg[]) => void
  onUhaulPriceChange?: (pricePerTruck: number) => void
  onOperationalPlanChange?: (plan: { crewSize: number; estimatedHours: number; truckCount: number; estimatedWeightLbs?: number }) => void
  onBranchChange?: (value: NonNullable<CRMLead['branch']>) => void
  onJobFactorsChange: (factors: JobFactors) => void
  onAddInventoryItems: (items: InventoryItem[]) => void
  onApplyStarterInventory?: () => number
  onUpdateInventoryItem: (index: number, field: keyof InventoryItem, value: string) => void
  onConfirmInventory: () => Promise<void>
  onToggleInventoryItem: (index: number) => void
  onRemoveInventoryItem: (index: number) => void
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
  mediaAssets = [],
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
  onLeadMediaSynced,
  onQuoteApprovalUpdated,
  legs: legsProp,
  onLegsChange,
  onUhaulPriceChange,
  onOperationalPlanChange,
  onBranchChange,
  onJobFactorsChange,
  onAddInventoryItems,
  onApplyStarterInventory,
  onUpdateInventoryItem,
  onConfirmInventory,
  onToggleInventoryItem,
  onRemoveInventoryItem,
  onOriginAddressChange,
  onOriginCityChange,
  onDestAddressChange,
  onDestCityChange,
}: Props) {
  const currentUser = useCurrentUser()
  const onRecalculateRef = useRef(onRecalculate)
  const routeSectionRef = useRef<HTMLDivElement | null>(null)
  const manualKmInputRef = useRef<HTMLInputElement | null>(null)
  const [route, setRoute] = useState<RouteResult | null>(null)
  const [routeBusy, setRouteBusy] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const branchManuallySelectedRef = useRef(false)
  const [quoteType, setQuoteType] = useState<'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'>(
    lead.quoteType || 'standard'
  )
  const [localBranch, setLocalBranch] = useState<'windsor' | 'waterloo' | 'london' | 'ottawa'>(
    detectSalesBranchFromLocation(lead.originAddress, lead.originCity) || lead.branch || 'windsor'
  )
  const [distanceKm, setDistanceKm] = useState<number>(0)
  const [bookTodayActive, setBookTodayActive] = useState(false)
  const [tenPctActive, setTenPctActive] = useState(false)
  const [excludedDisassemblyItems, setExcludedDisassemblyItems] = useState<Set<string>>(new Set())
  const [overrideInput, setOverrideInput] = useState('')
  const [overrideTaxMode, setOverrideTaxMode] = useState<OntarioPriceOverrideMode | null>(null)
  const [overrideReason, setOverrideReason] = useState('relationship')
  const [overrideNote, setOverrideNote] = useState('')
  const [overrideApprovalCode, setOverrideApprovalCode] = useState('')
  const [overrideApprovalBusy, setOverrideApprovalBusy] = useState(false)
  const [overrideApprovalNotice, setOverrideApprovalNotice] = useState<string | null>(null)
  const [approvedOverrideAmount, setApprovedOverrideAmount] = useState<number | null>(null)
  // Persist manual U-Haul price — initialize from saved quote value if set
  const [uhaulInputPerTruck, setUhaulInputPerTruck] = useState(
    () => quote?.longDistanceTruckCost ? String(quote.longDistanceTruckCost) : ''
  )
  const [uhaulInputIsEstimate, setUhaulInputIsEstimate] = useState(
    () => !quote?.longDistanceTruckCost  // treat as estimate if nothing saved yet
  )
  const [, startTransition] = useTransition()
  const [marginGateAck, setMarginGateAck] = useState(false)
  const [conditionalClauseEnabled, setConditionalClauseEnabled] = useState(() => Boolean(quote?.conditionalClause))
  const [conditionalClauseText, setConditionalClauseText] = useState(() => quote?.conditionalClause || '')
  const [overrideApplied, setOverrideApplied] = useState(false)
  // U-Haul cost panel
  const [uhaulOpen, setUhaulOpen] = useState(false)
  const [uhaulGasPrice, setUhaulGasPrice] = useState(DEFAULT_GAS_PRICE_PER_L)
  const [uhaulMisc, setUhaulMisc] = useState(DEFAULT_MISC_BUFFER)
  const [ldMarginTarget, setLdMarginTarget] = useState(50)  // 40–60% slider
  const [lightbox, setLightbox] = useState<{ photos: string[]; index: number } | null>(null)
  const [uhaulStraightDrop, setUhaulStraightDrop] = useState(false)
  const [uhaulBlankets, setUhaulBlankets] = useState<number | null>(null)  // null = auto
  const [originPlaceId, setOriginPlaceId] = useState<string | undefined>(undefined)
  const [destPlaceId, setDestPlaceId] = useState<string | undefined>(undefined)
  const [uhaulDepotName, setUhaulDepotName] = useState<string | null>(null)
  const [uhaulDepotLat, setUhaulDepotLat] = useState<number | null>(null)
  const [uhaulDepotLng, setUhaulDepotLng] = useState<number | null>(null)
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
  const [inventoryConfirmBusy, setInventoryConfirmBusy] = useState(false)
  const [activeConjointOwner, setActiveConjointOwner] = useState<'person_a' | 'person_b' | 'combined'>('person_a')
  const [conjointCustomItem, setConjointCustomItem] = useState('')
  const [valuationAmount, setValuationAmount] = useState('149')
  const [intakeOpen, setIntakeOpen] = useState(false)
  const [intakeText, setIntakeText] = useState('')
  const [intakeBusy, setIntakeBusy] = useState(false)
  const [intakeResult, setIntakeResult] = useState<import('@/app/api/sales/smart-intake/route').SmartIntakeResult | null>(null)
  const [intakeApplied, setIntakeApplied] = useState(false)
  const [legsEnabled, setLegsEnabled] = useState(() => (legsProp?.length ?? 0) > 0)
  const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null)
  const [activeStage, setActiveStage] = useState<EstimateWorkflowStageId>('lead')
  const [estimateView, setEstimateView] = useState<'simple' | 'guided'>('simple')

  function chooseEstimateView(view: 'simple' | 'guided') {
    setEstimateView(view)
  }

  useEffect(() => { onRecalculateRef.current = onRecalculate }, [onRecalculate])
  const [dragOverRoom, setDragOverRoom] = useState<string | null>(null)
  const [touchMoveItemIndex, setTouchMoveItemIndex] = useState<number | null>(null)
  const [legs, setLegs] = useState<QuoteLeg[]>(() => legsProp?.length ? legsProp : [])
  const [legRoutes, setLegRoutes] = useState<Record<string, { distanceKm: number; driveHours: number } | null>>({})
  const legRouteFetchRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const [conjointUploadOwner, setConjointUploadOwner] = useState<'person_a' | 'person_b' | null>(null)
  const [conjointUploadBusy, setConjointUploadBusy] = useState(false)
  const [conjointUploadNotice, setConjointUploadNotice] = useState<string | null>(null)
  const [conjointLocalPhotoUrls, setConjointLocalPhotoUrls] = useState<Record<'person_a' | 'person_b', string[]>>({ person_a: [], person_b: [] })
  const [conjointPendingScanItems, setConjointPendingScanItems] = useState<InventoryItem[]>([])
  const [conjointSurveyBusy, setConjointSurveyBusy] = useState<'person_a' | 'person_b' | null>(null)
  const [conjointSurveyNotice, setConjointSurveyNotice] = useState<string | null>(null)
  const [conjointMlsBusy, setConjointMlsBusy] = useState<'person_a' | 'person_b' | null>(null)
  const [conjointMlsNotice, setConjointMlsNotice] = useState<string | null>(null)
  const conjointUploadInputRef = useRef<HTMLInputElement | null>(null)
  const conjointUploadOwnerRef = useRef<'person_a' | 'person_b' | null>(null)
  const conjointLocalPhotoUrlsRef = useRef<string[]>([])

  useEffect(() => {
    return () => {
      conjointLocalPhotoUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
    }
  }, [])

  async function handleConjointRepUpload(owner: 'person_a' | 'person_b', files: File[]) {
    if (!files.length) return
    setConjointUploadBusy(true)
    setConjointUploadNotice(null)
    const partyLabel = owner === 'person_b' ? (jobFactors.personBLabel || 'Party B') : (jobFactors.personALabel || 'Party A')
    const localUrls = files.filter(file => file.type.startsWith('image/')).map(file => URL.createObjectURL(file))
    if (localUrls.length > 0) {
      conjointLocalPhotoUrlsRef.current = [...conjointLocalPhotoUrlsRef.current, ...localUrls]
      setConjointLocalPhotoUrls(current => ({
        ...current,
        [owner]: [...current[owner], ...localUrls],
      }))
    }
    try {
      const form = new FormData()
      form.set('purpose', 'customer_media')
      form.set('room', partyLabel)
      form.set('notes', `Conjoint upload — ${partyLabel}`)
      form.set('partyLabel', partyLabel)
      form.set('partyOwner', owner)
      const allDetectedItems: InventoryItem[] = []
      let latestLead: CRMLead | undefined
      let uploadedCount = 0
      let analyzedImageCount = 0
      const analyzeWarnings: string[] = []
      for (const file of files) {
        const preparedFile = await prepareUploadFile(file)
        const perFileForm = new FormData()
        perFileForm.set('purpose', String(form.get('purpose') || 'customer_media'))
        perFileForm.set('room', String(form.get('room') || partyLabel))
        perFileForm.set('notes', String(form.get('notes') || `Conjoint upload — ${partyLabel}`))
        perFileForm.set('partyLabel', String(form.get('partyLabel') || partyLabel))
        perFileForm.set('partyOwner', String(form.get('partyOwner') || owner))
        perFileForm.append('files', preparedFile)
        const res = await fetch(`/api/sales/leads/${lead.id}/media-upload`, { method: 'POST', body: perFileForm, credentials: 'include' })
        const data = await res.json().catch(() => ({ error: `Upload failed (${res.status})` })) as { ok?: boolean; uploadedCount?: number; analyzedImageCount?: number; detectedItems?: InventoryItem[]; lead?: CRMLead; analyzeWarning?: string; error?: string }
        if (!res.ok || data.error) throw new Error(data.error || 'Upload failed')
        uploadedCount += data.uploadedCount || 0
        analyzedImageCount += data.analyzedImageCount || 0
        if (data.lead) latestLead = data.lead
        if (data.analyzeWarning) analyzeWarnings.push(data.analyzeWarning)
        allDetectedItems.push(...(data.detectedItems || []))
      }
      const detectedItems = allDetectedItems.map(item => ({
        ...item,
        id: item.id || `conjoint-${owner}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        owner: owner,
        room: item.room || partyLabel,
        included: item.included !== false,
        source: item.source || 'rep_upload',
      }))
      if (detectedItems.length > 0) {
        setConjointPendingScanItems(current => {
          const merged = [...current]
          const keys = new Set(merged.map(item => String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()))
          detectedItems.forEach(item => {
            const key = String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()
            if (!keys.has(key)) {
              keys.add(key)
              merged.push(item)
            }
          })
          return merged
        })
        console.info('[conjoint-upload]', {
          party: partyLabel,
          owner,
          detected: detectedItems.length,
          returnedLeadInventory: latestLead?.inventory?.length || 0,
        })
      }
      if (latestLead) {
        if (detectedItems.length > 0) onAddInventoryItems(detectedItems)
        const leadInventory = Array.isArray(latestLead.inventory) ? latestLead.inventory : []
        const detectedIds = new Set(detectedItems.map(item => item.id).filter(Boolean))
        const detectedNames = new Set(detectedItems.map(item => String(item.name || item.item || '').trim().toLowerCase()).filter(Boolean))
        const ownedLeadInventory = leadInventory.map(item => {
          const itemName = String(item.name || item.item || '').trim().toLowerCase()
          const matchesDetected = (item.id && detectedIds.has(item.id)) || (itemName && detectedNames.has(itemName))
          return matchesDetected
            ? {
              ...item,
              owner,
              room: item.room || partyLabel,
              included: item.included !== false,
              source: item.source || 'rep_upload',
            }
            : item
        })
        const existingKeys = new Set(ownedLeadInventory.map(item => {
          const label = String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()
          return label
        }))
        const mergedInventory = [
          ...ownedLeadInventory,
          ...detectedItems.filter(item => {
            const key = String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()
            if (existingKeys.has(key)) return false
            existingKeys.add(key)
            return true
          }),
        ]
        const mergedMetrics = deriveInventoryMetrics(mergedInventory)
        onLeadMediaSynced?.({
          ...latestLead,
          inventory: mergedInventory,
          totalItems: mergedMetrics.totalItems,
          totalCubicFeet: mergedMetrics.totalCubicFeet,
          totalWeightLbs: mergedMetrics.totalWeightLbs,
        })
        if (detectedItems.length > 0) {
          const syncedKeys = new Set(detectedItems.map(item => conjointInventoryKey(item)))
          setConjointPendingScanItems(current => current.filter(item => !syncedKeys.has(conjointInventoryKey(item))))
        }
      } else if (detectedItems.length > 0) {
        onAddInventoryItems(detectedItems)
        const syncedKeys = new Set(detectedItems.map(item => conjointInventoryKey(item)))
        setConjointPendingScanItems(current => current.filter(item => !syncedKeys.has(conjointInventoryKey(item))))
      }
      const detectedCount = detectedItems.length
      const scanText = detectedCount > 0
        ? ` Scan added ${detectedCount} inventory item${detectedCount === 1 ? '' : 's'} to ${partyLabel}.`
        : analyzedImageCount
          ? ' Photos saved; no inventory items were detected automatically.'
          : ''
      const finalUploadedCount = uploadedCount || files.length
      setConjointUploadNotice(`Uploaded ${finalUploadedCount} file${finalUploadedCount !== 1 ? 's' : ''} for ${partyLabel}.${scanText}${analyzeWarnings.length ? ` ${analyzeWarnings.join(' ')}` : ''}`)
    } catch (err) {
      setConjointUploadNotice((err as Error).message)
    } finally {
      setConjointUploadBusy(false)
      setConjointUploadOwner(null)
      conjointUploadOwnerRef.current = null
    }
  }

  async function handleConjointSurveyRequest(owner: 'person_a' | 'person_b', address: string) {
    setConjointSurveyBusy(owner)
    setConjointSurveyNotice(null)
    const partyLabel = owner === 'person_b' ? (jobFactors.personBLabel || 'Party B') : (jobFactors.personALabel || 'Party A')
    const isPartyB = owner === 'person_b'
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/survey`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
        body: JSON.stringify({ skipSms: true, ...(isPartyB ? { partyB: true, partyBLabel: partyLabel } : {}) }),
      })
      const data = await res.json() as { surveyUrl?: string; error?: string }
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to generate link')
      if (data.surveyUrl) void navigator.clipboard.writeText(data.surveyUrl)
      setConjointSurveyNotice(`Link for ${partyLabel} copied — paste into SMS`)
    } catch (err) {
      setConjointSurveyNotice((err as Error).message)
    } finally {
      setConjointSurveyBusy(null)
      void address
    }
  }

  function handleConjointMlsScan(owner: 'person_a' | 'person_b', address: string) {
    void owner
    if (!address || address.includes('Add ')) {
      setConjointMlsNotice('Add the pickup address in Legs first, then close this modal and use Scan from MLS on the lead page.')
      return
    }
    const mlsPhotoCount = (lead.supabaseListing?.carouselphotos || []).length
    if (mlsPhotoCount > 0) {
      setConjointMlsNotice(`MLS listing already loaded (${mlsPhotoCount} photos). Close this modal and hit Scan from MLS to run inventory detection.`)
    } else {
      setConjointMlsNotice(`No MLS listing attached yet. Close this modal → use the MLS search on the lead page for: ${address}`)
    }
  }

  const effectiveConjointInventory = useMemo(() => {
    if (conjointPendingScanItems.length === 0) return inventory
    const merged = [...inventory]
    const keys = new Set(merged.map(item => String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()))
    conjointPendingScanItems.forEach(item => {
      const key = String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()
      if (!keys.has(key)) {
        keys.add(key)
        merged.push(item)
      }
    })
    return merged
  }, [conjointPendingScanItems, inventory])

  function conjointInventoryKey(item: InventoryItem) {
    return String(item.id || `${item.owner || 'person_a'}:${item.room || ''}:${item.name || item.item || ''}`).toLowerCase()
  }

  const conjointMode = !!jobFactors.conjointMove
  const conjointMetrics = useMemo(() => {
    const included = effectiveConjointInventory.filter(item => item.included !== false)
    const personAItems = included.filter(item => item.owner !== 'person_b')
    const personBItems = included.filter(item => item.owner === 'person_b')
    const volume = (items: InventoryItem[]) => Math.round(items.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0))
    const personACubicFeet = volume(personAItems)
    const personBCubicFeet = volume(personBItems)
    const personAItemCount = personAItems.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
    const personBItemCount = personBItems.reduce((sum, item) => sum + Math.max(1, Number(item.qty || 1)), 0)
    const totalCubicFeet = personACubicFeet + personBCubicFeet
    const personASharePct = totalCubicFeet > 0 ? Math.round((personACubicFeet / totalCubicFeet) * 100) : 50
    return {
      personAItems,
      personBItems,
      personAItemCount,
      personBItemCount,
      personACubicFeet,
      personBCubicFeet,
      totalCubicFeet,
      personASharePct,
      personBSharePct: Math.max(0, 100 - personASharePct),
    }
  }, [effectiveConjointInventory])

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

  function applyConjointTemplate() {
    const personAAddr = lead.originAddress || originAddress || ''
    const personACity = lead.originCity || originCity || ''
    const finalDest = lead.destAddress || ''
    const finalDestCity = lead.destCity || destCity || ''
    const now = Date.now()
    const newLegs: QuoteLeg[] = [
      {
        id: `leg-cj-a-${now}`,
        label: 'Leg 1 — Person A pickup',
        type: 'move',
        originAddress: personAAddr,
        originCity: personACity,
        destAddress: '',
        destCity: '',
        inventorySharePct: 50,
        notes: 'Load items from first pickup location, drive to second pickup',
      },
      {
        id: `leg-cj-b-${now + 1}`,
        label: 'Leg 2 — Person B pickup + delivery',
        type: 'move',
        originAddress: '',
        originCity: '',
        destAddress: finalDest,
        destCity: finalDestCity,
        inventorySharePct: 50,
        notes: 'Load items from second pickup, deliver everything to final destination',
      },
    ]
    setLegsEnabled(true)
    setLegs(newLegs)
    onLegsChange?.(newLegs)
    onJobFactorsChange({ ...jobFactors, conjointMove: true })
  }

  function applyStorageTemplate() {
    const now = Date.now()
    const newLegs: QuoteLeg[] = [
      {
        id: `leg-storage-out-${now}`,
        label: 'Leg 1 — Home to storage',
        type: 'storage',
        originAddress: originAddress || lead.originAddress || '',
        originCity: originCity || lead.originCity || '',
        destAddress: '',
        destCity: '',
        inventorySharePct: 100,
        notes: 'Load and wrap items for storage; disassembly only at pickup',
      },
      {
        id: `leg-storage-in-${now + 1}`,
        label: 'Leg 2 — Storage to new home',
        type: 'storage_delivery',
        originAddress: '',
        originCity: '',
        destAddress: destAddress || lead.destAddress || '',
        destCity: destCity || lead.destCity || '',
        inventorySharePct: 100,
        notes: 'Pickup same stored inventory, deliver and reassemble at destination',
      },
    ]
    setLegsEnabled(true)
    setLegs(newLegs)
    onLegsChange?.(newLegs)
    setQuoteType('storage')
    onRecalculate({ quoteType: 'storage', distanceKm: distanceKm || route?.distanceKm || undefined, routeContext })
    onJobFactorsChange({
      ...jobFactors,
      temporaryStorageNeeded: true,
      planningScenario: 'storage_staged',
      preferredOperatingPlan: 'split_day_storage',
    })
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
            moveTime,
            inventory: {
              itemCount: inventoryMetrics.totalItems,
              cubicFeet: inventoryMetrics.totalCubicFeet,
              weightLbs: inventoryMetrics.totalWeightLbs,
            },
            jobFactors,
            quoteLegs: legs,
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
    const recommendedMoveTime = r.recommendations?.startTime || r.moveTime
    if (recommendedMoveTime) onMoveTimeChange?.(recommendedMoveTime)
    if (r.originAddress) onOriginAddressChange?.(r.originAddress)
    if (r.originCity) onOriginCityChange?.(r.originCity)
    if (r.destAddress) onDestAddressChange?.(r.destAddress)
    if (r.destCity) onDestCityChange?.(r.destCity)
    if (r.moveDescription) onMoveDescriptionChange(r.moveDescription)

    const opsNotes: string[] = []
    if (r.internalNotes) opsNotes.push(r.internalNotes)
    if (r.scenarioType) opsNotes.push(`AI move scenario: ${r.scenarioType.replace(/_/g, ' ')}`)
    if (r.recommendations?.setup) {
      const reason = r.recommendations.rationale ? ` — ${r.recommendations.rationale}` : ''
      opsNotes.push(`AI recommended setup: ${r.recommendations.setup.replace(/_/g, ' ')}${reason}`)
    }
    if (r.recommendations?.truckPlan) opsNotes.push(`AI truck plan: ${r.recommendations.truckPlan}`)
    if (r.recommendations?.pricingNote) opsNotes.push(`AI pricing note: ${r.recommendations.pricingNote}`)
    if (r.recommendations?.marginNote) opsNotes.push(`AI margin note: ${r.recommendations.marginNote}`)
    r.constraints?.forEach(c => {
      const details = [c.appliesTo, c.date, c.time, c.impact].filter(Boolean).join(' · ')
      opsNotes.push(`Constraint - ${c.label}${details ? `: ${details}` : ''}`)
    })
    r.parties?.forEach(p => {
      const sources = p.inventorySources?.filter(Boolean).join(', ')
      const missing = p.missingInventory ? 'inventory pending' : 'inventory partly known'
      const pieces = [p.pickupAddress || p.pickupCity, sources ? `intake: ${sources}` : '', p.knownInventory, p.accessNotes, p.timingConstraint, missing].filter(Boolean)
      opsNotes.push(`${p.label}: ${pieces.join(' · ')}`)
    })
    const nextInternalNotes = opsNotes.reduce((notes, note) => prependUniqueLine(notes, note), internalNotes)
    if (opsNotes.length > 0) onInternalNotesChange(nextInternalNotes)

    // Apply job factors (map AI field names to actual JobFactors type)
    if (r.jobFactors || r.scenarioType === 'conjoint' || (r.parties?.length ?? 0) > 1) {
      const jf = r.jobFactors || {}
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
      if (jf.conjointMove || r.scenarioType === 'conjoint' || (r.parties?.length ?? 0) > 1) next.conjointMove = true
      const personA = r.parties?.[0]
      const personB = r.parties?.[1]
      if (jf.personALabel || personA?.label) next.personALabel = jf.personALabel || personA?.label
      if (jf.personBLabel || personB?.label) next.personBLabel = jf.personBLabel || personB?.label
      if (jf.personBOriginFloors) next.personBOriginFloors = jf.personBOriginFloors
      if (jf.personBOriginHasElevator !== undefined) next.personBOriginHasElevator = jf.personBOriginHasElevator
      if (jf.personBOriginElevatorReserved !== undefined) next.personBOriginElevatorReserved = jf.personBOriginElevatorReserved
      if (jf.personBOriginParkingOk !== undefined) next.personBOriginParkingOk = jf.personBOriginParkingOk
      if (r.scenarioType) next.planningScenario = r.scenarioType
      if (r.recommendations?.setup) next.preferredOperatingPlan = r.recommendations.setup
      const keysConstraint = r.constraints?.find(c => c.type === 'keys' || /key/i.test(c.label))
      const latestConstraint = r.constraints?.find(c => c.type === 'closing' || c.type === 'time_window' || /finish|closing|out by/i.test(`${c.label} ${c.impact || ''}`))
      const earliestConstraint = r.constraints?.find(c => /start|load|elevator/i.test(`${c.label} ${c.impact || ''}`) && c.time)
      if (keysConstraint?.time) next.destinationKeysTime = keysConstraint.time
      if (latestConstraint?.time) next.latestFinishTime = latestConstraint.time
      if (earliestConstraint?.time) next.earliestLoadTime = earliestConstraint.time
      if (r.constraints?.length) {
        next.moveConstraintNotes = r.constraints
          .map(c => [c.label, c.appliesTo, c.date, c.time, c.impact].filter(Boolean).join(' · '))
          .filter(Boolean)
          .join('\n')
      }
      onJobFactorsChange(next)
    }

    // Apply legs
    const hasAiLegs = r.legsEnabled && r.legs?.length
    const conjointParties = r.scenarioType === 'conjoint' && (r.parties?.length ?? 0) >= 2
    if (hasAiLegs || conjointParties) {
      const now = Date.now()
      const inferredConjointLegs: Array<{
        label: string
        type: QuoteLegType
        originAddress?: string
        originCity?: string
        destAddress?: string
        destCity?: string
        scheduledDate?: string
        notes?: string
      }> = conjointParties
        ? [
            {
              label: `Leg 1 — ${r.parties![0].label} pickup`,
              type: 'move' as QuoteLegType,
              originAddress: r.parties![0].pickupAddress || r.originAddress || originAddress || lead.originAddress || '',
              originCity: r.parties![0].pickupCity || r.originCity || originCity || lead.originCity || '',
              destAddress: r.parties![1].pickupAddress || '',
              destCity: r.parties![1].pickupCity || '',
              notes: `Load ${r.parties![0].label}; then continue to ${r.parties![1].label}.`,
            },
            {
              label: `Leg 2 — ${r.parties![1].label} pickup + delivery`,
              type: 'delivery' as QuoteLegType,
              originAddress: r.parties![1].pickupAddress || '',
              originCity: r.parties![1].pickupCity || '',
              destAddress: r.destAddress || destAddress || lead.destAddress || '',
              destCity: r.destCity || destCity || lead.destCity || '',
              notes: `Load ${r.parties![1].label}; deliver combined shipment to final destination.`,
            },
          ]
        : []
      const legSource = hasAiLegs ? r.legs! : inferredConjointLegs
      const newLegs = legSource.map((l, i) => ({
        id: `leg-${now}-${i}`,
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
    if (originParts.length === 0 || destParts.length === 0) {
      // Clear stale saved distance so incomplete legs don't pollute pricing
      setLegRoutes(prev => ({ ...prev, [id]: null }))
      setLegs(prev => prev.map(l => l.id === id ? { ...l, distanceKm: undefined, driveHours: undefined } : l))
      return
    }
    const origin = originParts.join(', ')
    const dest   = destParts.join(', ')
    try {
      const res = await fetch('/api/sales/route-estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination: dest,
          branch: branchManuallySelectedRef.current ? selectedBranch : undefined,
        }),
        credentials: 'include',
      })
      if (!res.ok) return
      const data = (await res.json()) as RouteResult & { error?: string }
      if (data.error) return
      const km  = data.originToDestination?.distanceKm  ?? data.distanceKm  ?? 0
      const hrs = data.originToDestination?.driveHours  ?? data.driveHours  ?? 0
      if (!km && !hrs) return  // API returned zeros — don't overwrite with bad data
      setLegRoutes(prev => ({ ...prev, [id]: { distanceKm: km, driveHours: hrs } }))
      setLegs(prev => {
        const withRoute = prev.map(l => l.id === id ? {
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
        onLegsChange?.(withRoute)
        return withRoute
      })
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

  useEffect(() => {
    if (!open || !legsEnabled || !conjointMode || legs.length < 2 || conjointMetrics.totalCubicFeet <= 0) return
    const firstShare = Math.max(1, conjointMetrics.personASharePct)
    const secondShare = Math.max(1, 100 - firstShare)
    const next = legs.map((leg, index) => {
      if (index === 0) return leg.inventorySharePct === firstShare ? leg : { ...leg, inventorySharePct: firstShare }
      if (index === 1) return leg.inventorySharePct === secondShare ? leg : { ...leg, inventorySharePct: secondShare }
      return leg
    })
    if (next.some((leg, index) => leg.inventorySharePct !== legs[index]?.inventorySharePct)) {
      setLegs(next)
      onLegsChange?.(next)
    }
  }, [conjointMetrics.personASharePct, conjointMetrics.totalCubicFeet, conjointMode, legs, legsEnabled, onLegsChange, open])

  // Manual inventory quick-add state
  const [quickRoom, setQuickRoom] = useState('Living Room')
  const [quickItem, setQuickItem] = useState('')
  const [quickQty, setQuickQty] = useState('1')
  const [quickCuFt, setQuickCuFt] = useState('')
  const [quickWeightLbs, setQuickWeightLbs] = useState('')
  const [quickLookupLoading, setQuickLookupLoading] = useState(false)
  const [quickLookupNote, setQuickLookupNote] = useState<string | null>(null)
  // Paste-list import
  const [inventoryTab, setInventoryTab] = useState<'quick' | 'paste'>('quick')
  const [pasteText, setPasteText] = useState('')
  const [pasteLoading, setPasteLoading] = useState(false)
  const [pastePreview, setPastePreview] = useState<Array<InventoryItem & { _source?: string }> | null>(null)
  const [pasteError, setPasteError] = useState<string | null>(null)
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
    const direct = INVENTORY_PRESETS.filter(p =>
      p.label.toLowerCase().includes(q) ||
      getInventoryDisplayLabel(p.item).toLowerCase().includes(q) ||
      (p.room || '').toLowerCase().includes(q)
    )
    const aliasMatch = matchInventoryPreset(q)
    return [
      ...(aliasMatch ? [aliasMatch] : []),
      ...direct.filter(item => item.id !== aliasMatch?.id),
    ].slice(0, 12)
  }, [presetSearch])
  const starterPlan = useMemo(
    () => buildStarterInventoryPlan({ bedrooms: propertyBedrooms, propertyType }),
    [propertyBedrooms, propertyType]
  )

  function buildRouteAddress(address?: string, city?: string) {
    return qualifyMoveAddress(address, city)
  }

  // Auto-calculate route when both origin and destination are present.
  // Always include province/country context for partial street addresses; otherwise
  // Google can resolve common street names to the wrong city.
  const originFull = (() => {
    return buildRouteAddress(originAddress || lead.originAddress, originCity || lead.originCity)
  })()
  const destFull = (() => {
    return buildRouteAddress(destAddress || lead.destAddress, destCity || lead.destCity)
  })()
  const selectedBranch = (localBranch || branch || lead.branch || 'windsor') as 'windsor' | 'waterloo' | 'london' | 'ottawa'
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
      const savedCustomerTotal = Number(quote?.priceOverrideTotal || 0)
      const derivedCustomerTotal = Math.round(Number(overrideItem.amount) * 1.13 * 100) / 100
      const savedTotal = savedCustomerTotal > 0 ? savedCustomerTotal : derivedCustomerTotal
      const savedAsAllIn = Math.abs(savedTotal - derivedCustomerTotal) < 0.02
      setOverrideTaxMode(savedAsAllIn ? 'hst_included' : 'plus_hst')
      setOverrideInput(String(savedAsAllIn ? savedTotal : overrideItem.amount))
    } else if (!overrideItem) {
      setOverrideApplied(false)
    }
    // Restore saved U-Haul price — if rep manually entered a price before, reload it
    if (quote?.longDistanceTruckCost) {
      setUhaulInputPerTruck(String(quote.longDistanceTruckCost))
      setUhaulInputIsEstimate(false)
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
    if (!open) {
      branchManuallySelectedRef.current = false
      return
    }
    // Address evidence corrects stale/default branch data. A rep's selection
    // during the current workspace session remains authoritative.
    const detected = detectSalesBranchFromLocation(
      originAddress || lead.originAddress,
      originCity || lead.originCity
    )
    const resolved = (
      branchManuallySelectedRef.current
        ? (branch || localBranch || lead.branch)
        : (detected || branch || lead.branch)
    || 'windsor') as 'windsor' | 'waterloo' | 'london' | 'ottawa'
    setLocalBranch(resolved)
    if (!branchManuallySelectedRef.current && detected && detected !== (branch || lead.branch)) {
      onBranchChange?.(detected as 'windsor' | 'waterloo' | 'london' | 'ottawa')
    }
  }, [branch, lead.branch, localBranch, open, originAddress, originCity, lead.originAddress, lead.originCity, onBranchChange])

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

  // Auto-open Live Margin when long-distance is detected
  useEffect(() => {
    if (route?.category === 'long-distance' || quoteType === 'long_distance') {
      setUhaulOpen(true)
    }
  }, [route?.category, quoteType])

  // Route classification is authoritative. Keep the selected quote type in sync
  // so the controls, pricing engine and header cannot describe different jobs.
  useEffect(() => {
    if (routeBusy || !route) return
    if (route.category === 'long-distance' && quoteType !== 'long_distance') {
      setQuoteType('long_distance')
    } else if (route.category !== 'long-distance' && quoteType === 'long_distance' && lead.quoteType !== 'long_distance') {
      setQuoteType('standard')
    }
  }, [lead.quoteType, quoteType, route, routeBusy])

  // Auto-find nearest U-Haul to origin when origin address is known
  useEffect(() => {
    const addr = originFull || lead.originAddress
    if (!addr || uhaulDepotLookupDone) return
    setUhaulDepotLookupDone(true)
    void fetch(`/api/sales/uhaul-nearest?address=${encodeURIComponent(addr)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { name?: string; distanceKm?: number | null; lat?: number; lng?: number } | null) => {
        if (data?.distanceKm != null) {
          setUhaulPickupKm(data.distanceKm)
          setUhaulDepotName(data.name ?? null)
          if (data.lat != null) setUhaulDepotLat(data.lat)
          if (data.lng != null) setUhaulDepotLng(data.lng)
        }
      })
      .catch(() => {})
  }, [originFull, lead.originAddress, uhaulDepotLookupDone])

  const routeContext = useMemo<EstimateRouteContext | undefined>(() => {
    if (!originFull) return undefined
    if (quoteType === 'labor_only') {
      return {
        pricingStatus: 'ready',
        routeCategory: 'local',
        billableDriveHours: route?.yardToOrigin?.driveHours ?? route?.billableDriveHours,
        operationalDriveHours: route?.operationalDriveHours,
        yardToOriginHours: route?.yardToOrigin?.driveHours,
        yardToOriginDistanceKm: route?.yardToOrigin?.distanceKm,
        billableDistanceKm: route?.yardToOrigin?.distanceKm ?? route?.billableDistanceKm,
        operationalDistanceKm: route?.operationalDistanceKm,
        missingRequirements: [],
      }
    }
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
    // Keep an already-resolved route visible during background refreshes.
    setRouteBusy(!route)
    setRouteError(null)
    fetch('/api/sales/route-estimate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: originFull,
        destination: destFull || undefined,
        branch: branchManuallySelectedRef.current ? selectedBranch : undefined,
        originPlaceId,
        destPlaceId,
      }),
      credentials: 'include',
      signal: AbortSignal.timeout(15000),
    })
      .then(r => r.json())
      .then((data: RouteResult & { error?: string }) => {
        if (cancelled) return
        if (data.error) { setRouteError(data.error); setRoute(null) }
        else {
          setRoute(data)
          const originBranch = detectSalesBranchFromLocation(originFull, lead.originCity)
          if (!branchManuallySelectedRef.current && !originBranch && data.branch && data.branch !== selectedBranch) {
            setLocalBranch(data.branch)
            onBranchChange?.(data.branch)
          }
        }
      })
      .catch(() => { if (!cancelled) setRouteError('Could not calculate route') })
      .finally(() => { if (!cancelled) setRouteBusy(false) })
    return () => { cancelled = true }
  }, [open, originFull, destFull, selectedBranch, originPlaceId, destPlaceId])

  useEffect(() => {
    if (!open) return
    if (routeBusy) return  // wait for route API to settle — prevents provisional→final price flicker
    onRecalculateRef.current({
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
  const operationalInventoryWeightLbs = deriveInventoryMetrics(inventory).totalWeightLbs

  useEffect(() => {
    if (!open || !pricingBreakdown) return
    onOperationalPlanChange?.({
      crewSize: pricingBreakdown.crewSize,
      estimatedHours: pricingBreakdown.totalHours,
      truckCount: pricingBreakdown.truckCount,
      estimatedWeightLbs: operationalInventoryWeightLbs || undefined,
    })
  }, [onOperationalPlanChange, open, operationalInventoryWeightLbs, pricingBreakdown])

  useEffect(() => {
    const nextBudget = pricingBreakdown?.operationalTimeBudget
    if (!open || !nextBudget) return
    const comparable = (value: typeof nextBudget | undefined) => JSON.stringify(value ? { ...value, generatedAt: '' } : null)
    if (comparable(jobFactors.operationalTimeBudget) === comparable(nextBudget)) return
    onJobFactorsChange({ ...jobFactors, operationalTimeBudget: nextBudget })
  }, [jobFactors, onJobFactorsChange, open, pricingBreakdown?.operationalTimeBudget])

  function selectTruckStrategy(strategy: TripStrategy) {
    const truckCountOverride = strategy === 'two_trucks' ? 2 : strategy === 'three_trucks' ? 3 : 1
    setUhaulSelectedStrategy(strategy)
    onJobFactorsChange({
      ...jobFactors,
      truckCountOverride,
      preferredOperatingPlan: strategy === 'two_trucks' ? 'two_trucks_parallel' : 'one_truck_shuttle',
    })
  }

  const quoteIsCustomerFacing = isCustomerFacingQuote(quote)
  const quoteHasUnsavedPricingRevision = Boolean(
    quoteIsCustomerFacing &&
    quote &&
    !quotePricingInputsMatchSaved(quote, quoteLineItems, quoteDiscountAmount, quoteDiscountLabel)
  )
  const savedQuoteSubtotal = quote ? Number(quote.subtotal || 0) : quoteModalTotals.subtotal
  const savedQuoteTotal = quote ? Number(quote.total || 0) : quoteModalTotals.total
  const savedQuoteHours = quote ? Number(quote.estimatedHours || 0) : 0
  const savedQuoteCrewSize = quote ? Number(quote.crewSize || 0) : 0
  const savedQuoteTruckCount = quote ? Number(quote.truckCount || 0) : 0
  const savedQuoteStatusLabel = quote?.status ? quote.status.replace(/_/g, ' ') : 'draft'
  const showLivePricingBreakdown = !quoteIsCustomerFacing || quoteHasUnsavedPricingRevision
  const savedQuoteLineItems = quoteHasUnsavedPricingRevision ? quoteLineItems : (quote?.lineItems || quoteLineItems)

  function setFactor<K extends keyof JobFactors>(key: K, value: JobFactors[K]) {
    const next = { ...jobFactors, [key]: value }
    onJobFactorsChange(next)
  }

  function setHiddenCoverage(area: HiddenInventoryArea, state: MoveEvidenceState) {
    const current = jobFactors.hiddenInventoryCoverage?.[area]
    const areaLabel = HIDDEN_INVENTORY_AREAS.find(item => item.key === area)?.label || area
    const previousNoteWasAutomatic = current?.state === 'customer_confirmed_empty' || current?.state === 'not_applicable'
    const automaticNote = state === 'customer_confirmed_empty'
      ? `Customer confirmed ${areaLabel.toLowerCase()} is empty / has nothing moving.`
      : state === 'not_applicable'
        ? `Customer confirmed ${areaLabel.toLowerCase()} does not exist or is not applicable.`
        : previousNoteWasAutomatic ? undefined : current?.note
    const entry = {
      ...current,
      state,
      note: automaticNote,
      source: state === 'observed' ? 'property evidence' : 'sales consultation',
      updatedAt: new Date().toISOString(),
      updatedBy: currentUser?.name || 'Sales',
    }
    if (area === 'boxes' && state === 'estimated' && jobFactors.estimatedBoxes) {
      entry.estimatedCountMin = jobFactors.estimatedBoxes
      entry.estimatedCountMax = jobFactors.estimatedBoxes
    }
    onJobFactorsChange({ ...jobFactors, hiddenInventoryCoverage: { ...(jobFactors.hiddenInventoryCoverage || {}), [area]: entry } })
  }

  function setFactors(next: JobFactors) {
    onJobFactorsChange(next)
  }

  function clearStorageScope(nextQuoteType?: Exclude<QuoteType, 'storage'>, factorOverrides?: Partial<JobFactors>) {
    const fallbackQuoteType = nextQuoteType || (route?.category === 'long-distance' ? 'long_distance' : 'standard')
    const cleared = removeStorageQuoteScope({
      factors: jobFactors,
      legs,
      lineItems: quoteLineItems,
      fallbackQuoteType,
    })
    onJobFactorsChange({ ...cleared.factors, ...factorOverrides })
    setLegs(cleared.legs)
    setLegsEnabled(cleared.legsEnabled)
    onLegsChange?.(cleared.legs)
    onSetLineItems(cleared.lineItems)
    setQuoteType(cleared.quoteType)
    window.setTimeout(() => onRecalculate({
      quoteType: cleared.quoteType,
      distanceKm: distanceKm || route?.distanceKm || undefined,
      routeContext,
    }), 0)
  }

  function applyTimelineStartTime(startTime?: string, note?: string) {
    if (!startTime) return
    onMoveTimeChange?.(startTime)
    if (note) onInternalNotesChange(prependUniqueLine(internalNotes, note))
    window.setTimeout(() => onRecalculate({ quoteType, distanceKm: distanceKm || route?.distanceKm || undefined, routeContext }), 100)
  }

  function applyLogisticsOption(option: LogisticsOption) {
    const preferredOperatingPlan =
      option.id === 'two_truck_parallel'
        ? 'two_trucks_parallel'
        : option.id === 'split_day'
          ? 'split_day_storage'
          : option.id
    const next: JobFactors = {
      ...jobFactors,
      preferredOperatingPlan,
      truckCountOverride: option.truckCount,
    }
    if (option.id === 'two_truck_parallel') {
      next.crewSizeOverride = Math.max(jobFactors.crewSizeOverride || pricingBreakdown?.crewSize || 3, 4)
    }
    if (option.id === 'one_truck_sequence' || option.id === 'one_truck_shuttle') {
      next.crewSizeOverride = jobFactors.crewSizeOverride
    }
    const note = [
      `Operating plan selected: ${option.label}`,
      `${option.truckCount} truck${option.truckCount === 1 ? '' : 's'}, ${option.crewCount} crew${option.crewCount === 1 ? '' : 's'}, ${option.dayCount} day${option.dayCount === 1 ? '' : 's'}`,
      `Estimated window ~${option.estimatedHours}h, finish around ${option.finishTime}.`,
      option.summary,
      option.tradeoff,
    ].filter(Boolean).join(' ')
    next.moveConstraintNotes = prependUniqueLine(jobFactors.moveConstraintNotes || '', note)
    onJobFactorsChange(next)
    onInternalNotesChange(prependUniqueLine(internalNotes, note))
    window.setTimeout(() => onRecalculate({ quoteType, distanceKm: distanceKm || route?.distanceKm || undefined, routeContext }), 100)
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

  // Auto-populate long-distance U-Haul estimate — runs after pricingBreakdown is available
  useEffect(() => {
    if (!route || route.category !== 'long-distance') return
    if (uhaulInputPerTruck && !uhaulInputIsEstimate) return
    const distKm = route.distanceKm || 0
    if (!distKm) return
    const size = truckSizeFromCubicFeet(pricingBreakdown?.totalCubicFeet || 0)
    const est = calcLongDistanceUHaul(distKm, size, 1)
    setUhaulInputPerTruck(String(est.oneWayEstimate))
    setUhaulInputIsEstimate(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.category, route?.distanceKm, pricingBreakdown?.totalCubicFeet])

  const effectiveInventoryMetrics = useMemo(() => deriveInventoryMetrics(inventory), [inventory])
  const inventoryPolicySummary = useMemo(() => summarizeMovePolicy(inventory, { moveType: lead.moveType }), [inventory, lead.moveType])
  const blockedPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.blocked), [inventoryPolicySummary.blocked])
  const hazardousPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.hazardous), [inventoryPolicySummary.hazardous])
  const manualReviewPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.manualReview), [inventoryPolicySummary.manualReview])
  const specialtyPolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.specialtyFee), [inventoryPolicySummary.specialtyFee])
  const specialtyServiceRecommendations = useMemo(() => {
    const internalAllowanceByRule: Record<string, number> = {
      safe: 225,
      piano: 350,
      pool_table: 650,
      hot_tub: 1000,
    }
    const seen = new Set<string>()
    return inventoryPolicySummary.specialtyFee.flatMap(finding => {
      if (seen.has(finding.ruleId)) return []
      seen.add(finding.ruleId)
      const internalAllowance = internalAllowanceByRule[finding.ruleId] || 300
      return [{
        key: finding.ruleId,
        label: finding.label,
        itemLabel: finding.itemLabel,
        internalAllowance,
        sellingAllocation: Math.ceil((internalAllowance * 1.2) / 25) * 25,
      }]
    })
  }, [inventoryPolicySummary.specialtyFee])
  const defaultExcludePolicyLabels = useMemo(() => uniquePolicyLabels(inventoryPolicySummary.defaultExclude), [inventoryPolicySummary.defaultExclude])
  const flags = pricingBreakdown?.intelligenceFlags
  const packingMaterialsEstimate = flags?.packingMaterialsEstimate || null
  const packingLaborLineDescription = 'Professional Packing Service (Day Before Move)'
  const packingMaterialsLineDescription = 'Packing Materials Allowance'
  const unpackingLineDescription = 'Professional Unpacking Service'
  const cleaningLineDescription = 'Move-In / Move-Out Cleaning'
  const containerHandlingLineDescription = 'Storage Container Loading / Unloading'
  const packingLaborAdded = quoteLineItems.some(item => item.description === packingLaborLineDescription)
  const packingMaterialsAdded = quoteLineItems.some(item => item.description === packingMaterialsLineDescription)
  const unpackingAdded = quoteLineItems.some(item => item.description === unpackingLineDescription)
  const cleaningAdded = quoteLineItems.some(item => item.description === cleaningLineDescription)
  const containerHandlingAdded = quoteLineItems.some(item => item.description === containerHandlingLineDescription)
  const needsTwoTrucks = flags?.twoTruckRequired ?? false
  const includedDisassemblyItems = pricingBreakdown
    ? getIncludedDisassemblyItems(pricingBreakdown.disassemblyItems, excludedDisassemblyItems)
    : []
  function captureCustomerScope() {
    return buildCustomerQuoteScope({
      inventory: effectiveInventoryMetrics.inventory,
      jobFactors,
      assemblyItems: includedDisassemblyItems,
      customerHandledAssemblyItems: Array.from(excludedDisassemblyItems),
      specialtyItems: pricingBreakdown?.specialtyItemFlags || [],
    })
  }
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
    branchManuallySelectedRef.current = true
    setLocalBranch(nextBranch)
    onBranchChange?.(nextBranch)
  }

  function appendQuoteLineItem(item: QuoteLineItem) {
    onSetLineItems([...quoteLineItems, item])
  }

  function addSpecialtyService(item: typeof specialtyServiceRecommendations[number]) {
    const description = `${item.label} — Specialty Handling`
    if (quoteLineItems.some(line => line.description === description)) return
    appendQuoteLineItem({
      description,
      details: `${item.itemLabel} · planning allowance includes specialty crew/equipment · confirm photo, weight and access before binding`,
      amount: item.sellingAllocation,
    })
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

  function toggleUnpackingService() {
    if (unpackingAdded) {
      onSetLineItems(quoteLineItems.filter(item => item.description !== unpackingLineDescription))
      return
    }
    const plannedBoxes = Math.max(20, packingMaterialsEstimate?.plannedBoxes || jobFactors.estimatedBoxes || Math.ceil(effectiveInventoryMetrics.totalCubicFeet / 35))
    const labourHours = Math.round(plannedBoxes * 0.125 * 4) / 4
    const internalCost = labourHours * 25
    const bundledPrice = Math.ceil((internalCost / (1 - 0.03 - 0.38)) / 50) * 50
    appendQuoteLineItem({
      description: unpackingLineDescription,
      details: `Room-by-room unpacking and empty-box consolidation · ~${labourHours} labour-hours based on ${plannedBoxes} planned boxes`,
      amount: bundledPrice,
    })
  }

  const junkLineDescription = 'Junk Removal Service'
  const valuationLineDescription = 'Move Protection Plus'
  const isProtectionLine = (description: string) => /^(?:Move Protection Plus|Declared Value Protection)$/i.test(description)
  const junkAdded = quoteLineItems.some(li => li.description === junkLineDescription)
  const valuationAdded = quoteLineItems.some(li => isProtectionLine(li.description))
  const protectionRecommendation = useMemo(() => buildProtectionRecommendation({
    currentPrice: quoteModalTotals.subtotal,
    pricing: pricingBreakdown,
    factors: jobFactors,
    inventory: effectiveInventoryMetrics.inventory,
  }), [effectiveInventoryMetrics.inventory, jobFactors, pricingBreakdown, quoteModalTotals.subtotal])
  const tvDismountLineDescription = 'TV Dismount & Remount Service'
  const tvDismountAdded = quoteLineItems.some(li => li.description === tvDismountLineDescription)
  // All TVs in inventory (for boxes) — wall-mounted subset for dismount service
  const allTvsInInventory = effectiveInventoryMetrics.inventory.filter(item => {
    const label = (item.name || item.item || '').toLowerCase()
    return (label.includes('tv') || label.includes('television') || label.includes('flat screen') || label.includes('flatscreen')) && !label.includes('tv box') && !label.includes('tv stand') && !label.includes('tv unit') && !label.includes('tv cabinet')
  })
  const wallMountedTvs = allTvsInInventory.filter(item => {
    const label = (item.name || item.item || '').toLowerCase()
    return label.includes('wall') || label.includes('mount') || label.includes('bracket')
  })
  const tvDismountPrice = Math.min(150, 75 + wallMountedTvs.length * 50)  // $75 base + $50/TV, max $150

  // TV boxes — $20 each, NOT included in the free box deal, auto-detected from inventory
  // U-Haul TV box pricing (CAD, as of 2026) — our cost = U-Haul retail, customer pays cost + 10%
  const TV_BOX_TIERS = [
    { maxInches: 40,  label: 'Medium (up to 40")',  uHaulCost: 21, ourPrice: Math.round(21 * 1.10) },
    { maxInches: 70,  label: 'Large (32"–70")',      uHaulCost: 29, ourPrice: Math.round(29 * 1.10) },
    { maxInches: 999, label: 'XL (55"–86")',         uHaulCost: 38, ourPrice: Math.round(38 * 1.10) },
  ]
  function getTvBoxTier(itemLabel: string) {
    const match = itemLabel.match(/(\d{2,3})\s*(?:inch|in|")/i)
    const inches = match ? parseInt(match[1]) : 55  // default to large if size unknown
    return TV_BOX_TIERS.find(t => inches <= t.maxInches) || TV_BOX_TIERS[TV_BOX_TIERS.length - 1]
  }
  const tvBoxLineDescription = 'TV Box (Protective Packaging)'
  const tvBoxesAdded = quoteLineItems.some(li => li.description === tvBoxLineDescription)
  const tvBoxItems = allTvsInInventory.map(item => ({
    item,
    qty: Math.max(1, item.qty || 1),
    tier: getTvBoxTier(item.name || item.item || ''),
  }))
  const tvBoxCount   = tvBoxItems.reduce((s, t) => s + t.qty, 0)
  const tvBoxRevenue = tvBoxItems.reduce((s, t) => s + t.qty * t.tier.ourPrice, 0)
  const tvBoxCost    = tvBoxItems.reduce((s, t) => s + t.qty * t.tier.uHaulCost, 0)
  // Price shown on chip: use most common tier or average
  const tvBoxChipPrice = tvBoxCount > 0 ? Math.round(tvBoxRevenue / tvBoxCount) : 32

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
      const idx = quoteLineItems.findIndex(li => isProtectionLine(li.description))
      if (idx >= 0) onRemoveLineItem(idx)
    } else {
      const recommendedAmount = protectionRecommendation.price
      setValuationAmount(String(recommendedAmount))
      onSetLineItems([...quoteLineItems, {
        description: valuationLineDescription,
        details: `Optional enhanced move protection · terms and declared-value limits apply${protectionRecommendation.reasons.length ? ` · recommended for ${protectionRecommendation.reasons.join(', ')}` : ''}`,
        amount: recommendedAmount,
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
    const idx = quoteLineItems.findIndex(li => isProtectionLine(li.description))
    if (idx >= 0) onUpdateLineItem(idx, 'amount', val)
  }

  async function parseInventoryFromText() {
    if (!pasteText.trim() || !lead?.id) return
    setPasteLoading(true)
    setPasteError(null)
    setPastePreview(null)
    try {
      const res = await fetch(`/api/sales/leads/${lead.id}/parse-inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ text: pasteText }),
      })
      const data = await res.json() as { items?: Array<InventoryItem & { _source?: string }>; total?: number; error?: string }
      if (!res.ok || data.error) { setPasteError(data.error || 'Parse failed'); return }
      if (!data.items?.length) { setPasteError('No items found in that text. Try being more specific.'); return }
      setPastePreview(data.items)
    } catch {
      setPasteError('Something went wrong. Try again.')
    } finally {
      setPasteLoading(false)
    }
  }

  function addAllParsed() {
    if (!pastePreview?.length) return
    onAddInventoryItems(pastePreview)
    setPastePreview(null)
    setPasteText('')
    setInventoryTab('quick')
  }

  async function lookupItemDimensions(name: string) {
    if (!name.trim() || quickCuFt) return
    setQuickLookupLoading(true)
    setQuickLookupNote(null)
    try {
      const res = await fetch(`/api/sales/items/lookup?item=${encodeURIComponent(name.trim())}`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json() as { cubicFeet?: number; weightLbs?: number; notes?: string; confidence?: string; source?: string }
      if (data.cubicFeet && !quickCuFt) {
        setQuickCuFt(String(data.cubicFeet))
        if (data.weightLbs) setQuickWeightLbs(String(data.weightLbs))
        const src = data.source === 'preset' ? 'preset' : `AI · ${data.confidence || 'medium'} confidence`
        setQuickLookupNote(`${data.cubicFeet} cu ft · ${data.weightLbs ? `${data.weightLbs} lbs` : ''} (${src})${data.notes ? ` — ${data.notes}` : ''}`)
      }
    } catch { /* non-fatal */ }
    finally { setQuickLookupLoading(false) }
  }

  function addQuickItem() {
    if (!quickItem.trim()) return
    const qty = Math.max(1, Number(quickQty) || 1)
    const cf = Number(quickCuFt) || 0
    const weightLbs = Number(quickWeightLbs) || Math.round(cf * 4)
    onAddInventoryItems([{
      id: `manual-${Date.now()}`,
      room: quickRoom,
      name: quickItem.trim(),
      item: quickItem.trim(),
      qty,
      cubicFeet: cf,
      weightLbs,
      included: true,
    }])
    setQuickItem('')
    setQuickQty('1')
    setQuickCuFt('')
    setQuickWeightLbs('')
    setQuickLookupNote(null)
  }

  function addConjointPresetItem(presetId: string, owner: 'person_a' | 'person_b') {
    const preset = INVENTORY_PRESETS.find(item => item.id === presetId)
    if (!preset) return
    onAddInventoryItems([{ ...createInventoryItemFromPreset(preset), owner }])
  }

  function addConjointCustomItem(owner: 'person_a' | 'person_b') {
    const label = conjointCustomItem.trim()
    if (!label) return
    onAddInventoryItems([{
      id: `conjoint-${owner}-${Date.now()}`,
      room: 'Custom Items',
      name: label,
      item: label,
      qty: 1,
      cubicFeet: 0,
      weightLbs: 0,
      included: true,
      source: 'manual',
      owner,
    }])
    setConjointCustomItem('')
  }

  function assignUntaggedConjointItems(owner: 'person_a' | 'person_b') {
    inventory.forEach((item, index) => {
      if (!item.owner) onUpdateInventoryItem(index, 'owner', owner)
    })
  }

  function appendConjointScopeNote(owner: 'person_a' | 'person_b', note: string) {
    const label = owner === 'person_b'
      ? jobFactors.personBLabel || 'Person B'
      : jobFactors.personALabel || 'Person A'
    onInternalNotesChange(prependUniqueLine(internalNotes, `${label}: ${note}`))
    setConjointMlsNotice(`${label} note added.`)
  }

  async function copyInventorySnapshot() {
    const text = buildInventorySnapshotCopyText(inventory)
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
  const conjointMissingInventoryLabels = [
    conjointMode && conjointMetrics.personAItemCount <= 0 ? (jobFactors.personALabel || 'Person A') : null,
    conjointMode && legsEnabled && legs.length >= 2 && conjointMetrics.personBItemCount <= 0 ? (jobFactors.personBLabel || 'Person B') : null,
  ].filter(Boolean) as string[]
  const conjointUnmeasuredInventoryLabels = [
    conjointMode && conjointMetrics.personAItemCount > 0 && conjointMetrics.personACubicFeet <= 0 ? (jobFactors.personALabel || 'Person A') : null,
    conjointMode && legsEnabled && legs.length >= 2 && conjointMetrics.personBItemCount > 0 && conjointMetrics.personBCubicFeet <= 0 ? (jobFactors.personBLabel || 'Person B') : null,
  ].filter(Boolean) as string[]
  const conjointInventoryPending = conjointMode && legsEnabled && legs.length >= 2 && conjointMissingInventoryLabels.length > 0
  const conjointPendingLabel = conjointMissingInventoryLabels.join(' / ') || (jobFactors.personBLabel || 'Person B')
  const conjointVolumePending = conjointMode && legsEnabled && legs.length >= 2 && !conjointInventoryPending && conjointUnmeasuredInventoryLabels.length > 0
  const conjointVolumePendingLabel = conjointUnmeasuredInventoryLabels.join(' / ')
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
      (pricingBreakdown.internalCostEstimate.commercialDirectCost || 0) +
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
  const serviceProfitabilityPlan = useMemo(() => buildServiceProfitabilityPlan({
    lineItems: quoteLineItems,
    legs: legsEnabled ? legs : undefined,
    jobFactors,
    pricingBreakdown,
  }), [jobFactors, legs, legsEnabled, pricingBreakdown, quoteLineItems])
  const contributionPlan = useMemo(() => buildContributionPricingPlan({
    currentPrice: quoteModalTotals.subtotal,
    pricing: pricingBreakdown,
    lineItems: quoteLineItems,
    factors: jobFactors,
    binding: quote?.billingModel === 'binding',
    quoteType,
    moveDate: selectedMoveDate,
    inventory: effectiveInventoryMetrics.inventory,
  }), [effectiveInventoryMetrics.inventory, jobFactors, pricingBreakdown, quote?.billingModel, quoteLineItems, quoteModalTotals.subtotal, quoteType, selectedMoveDate])
  const consultativeMovePlan = useMemo(() => buildConsultativeMovePlan({
    factors: jobFactors,
    lineItems: quoteLineItems,
    destinationKnown: Boolean(destFull),
    lead: {
      moveDate: lead.moveDate,
      moveDateFlexible: lead.moveDateFlexible,
      moveDateFlexibleReason: lead.moveDateFlexibleReason,
      originAddress,
      originCity,
      destAddress,
      destCity,
      propertyType,
      tentativeReason: lead.tentativeReason,
      followUpDate: lead.followUpDate,
    },
  }), [
    destAddress,
    destCity,
    destFull,
    jobFactors,
    lead.followUpDate,
    lead.moveDate,
    lead.moveDateFlexible,
    lead.moveDateFlexibleReason,
    lead.tentativeReason,
    originAddress,
    originCity,
    propertyType,
    quoteLineItems,
  ])
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
    const overrideAmount = overrideTaxMode ? resolveOntarioPriceOverride(Number(overrideInput || 0), overrideTaxMode).subtotal : 0
    if (overrideAmount <= 0) return null
    return Math.round(((overrideAmount - liveMarginSummary.totalCost) / overrideAmount) * 1000) / 10
  }, [liveMarginSummary, overrideInput, overrideTaxMode])
  const overridePricing = useMemo(() => overrideTaxMode
    ? resolveOntarioPriceOverride(Number(overrideInput || 0), overrideTaxMode)
    : { subtotal: 0, hst: 0, total: 0 }, [overrideInput, overrideTaxMode])
  const overrideAmount = overridePricing.subtotal
  const overrideIsIncrease = baseQuoteSubtotal > 0 && overrideAmount >= baseQuoteSubtotal
  const overrideNeedsApproval = currentUser?.role === 'sales_rep' && !overrideIsIncrease && (overrideProjectedMargin === null || overrideProjectedMargin < 55)
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

  const accessAssessment = useMemo(() => deriveAccessComplexityAssessment({
    jobFactors,
    parkingNotes,
    originAccess,
    destAccess,
    propertyType: lead.propertyType,
    supabaseListing: lead.supabaseListing,
  }), [destAccess, jobFactors, lead.propertyType, lead.supabaseListing, originAccess, parkingNotes])
  const boxesAsked = Boolean(
    Number(jobFactors.estimatedBoxes || 0) > 0 ||
    packingMaterialsEstimate?.plannedBoxes ||
    effectiveInventoryMetrics.inventory.some(item => getInventoryDisplayLabel(item).toLowerCase().includes('box'))
  )
  const includedInventory = useMemo(
    () => effectiveInventoryMetrics.inventory.filter(item => item.included !== false && item.status !== 'excluded'),
    [effectiveInventoryMetrics.inventory]
  )
  const unknownVolumeItems = useMemo(
    () => includedInventory.filter(item => Number(item.cubicFeet || 0) <= 0),
    [includedInventory]
  )
  const unresolvedInventoryItems = useMemo(
    () => includedInventory.filter(item => item.status === 'needs_confirmation'),
    [includedInventory]
  )
  const textParsedInventoryItems = useMemo(
    () => unresolvedInventoryItems.filter(item =>
      item.source === 'customer_verification' &&
      /automatically parsed from customer sms/i.test(item.notes || '')
    ),
    [unresolvedInventoryItems]
  )
  const excludedInventoryCount = useMemo(
    () => effectiveInventoryMetrics.inventory.filter(item => item.included === false || item.status === 'excluded').length,
    [effectiveInventoryMetrics.inventory]
  )
  const evidenceSources = useMemo(() => {
    const sources = new Set<string>()
    if (lead.supabaseListing || lead.listingScanSnapshot || includedInventory.some(item => item.source === 'mls')) sources.add('MLS')
    if ((mediaAssets || []).some(asset => asset.kind === 'image' && !asset.removed)) sources.add('Photos')
    if (
      includedInventory.some(item => item.source === 'survey_ai') ||
      (mediaAssets || []).some(asset => asset.kind === 'video' && !asset.removed)
    ) sources.add('Video')
    if (includedInventory.some(item => item.source === 'manual')) sources.add('Rep / phone list')
    if (lead.surveyCompletedAt || lead.inventoryVerification?.completedAt) {
      sources.add('Customer confirmed')
    }
    return Array.from(sources)
  }, [includedInventory, lead.inventoryVerification?.completedAt, lead.listingScanSnapshot, lead.supabaseListing, lead.surveyCompletedAt, mediaAssets])
  const customerInventoryConfirmed = Boolean(
    lead.surveyCompletedAt ||
    lead.inventoryVerification?.completedAt ||
    (includedInventory.length > 0 && unresolvedInventoryItems.length === 0 && includedInventory.every(item => item.status === 'confirmed'))
  )
  const quoteReadyAssessment = useMemo(() => evaluateQuoteReadiness({ ...lead, inventory: effectiveInventoryMetrics.inventory, jobFactors }, {
    billingModel: quote?.billingModel,
    quoteType,
    originAddress: originFull,
    destAddress: destFull,
  }), [destFull, effectiveInventoryMetrics.inventory, jobFactors, lead, originFull, quote?.billingModel, quoteType])
  const originAccessConfirmed = Boolean(
    originAccess ||
    jobFactors.originParkingOk !== undefined ||
    jobFactors.originHasElevator !== undefined ||
    jobFactors.accessProfiles?.some(profile => profile.stopRole === 'pickup' && (profile.standardAccessConfirmed || (profile.evidenceStatus && profile.evidenceStatus !== 'unknown')))
  )
  const destinationAccessConfirmed = Boolean(
    destAccess ||
    jobFactors.destParkingOk !== undefined ||
    jobFactors.destHasElevator !== undefined ||
    jobFactors.accessProfiles?.some(profile => profile.stopRole === 'dropoff' && (profile.standardAccessConfirmed || (profile.evidenceStatus && profile.evidenceStatus !== 'unknown')))
  )
  const isLaborOnly = quoteType === 'labor_only'
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
      { category: 'evidence', label: 'Evidence source on file', ready: evidenceSources.length > 0, critical: true, detail: 'No MLS, photo, video, customer-confirmed, or rep inventory evidence is on file.' },
      { category: 'evidence', label: 'Customer scope confirmation', ready: customerInventoryConfirmed, critical: quoteType !== 'labor_only', detail: 'Ask the customer to verify what is moving, staying, missing, and decision-pending.' },
      ...quoteReadyAssessment.hidden.map(area => ({ category: 'evidence' as const, label: area.label, ready: area.resolved, critical: true, detail: `${area.label} must be observed, customer confirmed, defensibly estimated, or explicitly not applicable.` })),
      { category: 'inventory', label: 'Inventory captured', ready: effectiveInventoryMetrics.totalItems > 0, critical: true, detail: 'Inventory is still empty.' },
      { category: 'inventory', label: 'Item decisions resolved', ready: unresolvedInventoryItems.length === 0, critical: unresolvedInventoryItems.length > 0, detail: `${unresolvedInventoryItems.length} included item${unresolvedInventoryItems.length === 1 ? '' : 's'} still need a moving, staying, or decision-pending answer.` },
      { category: 'inventory', label: 'Volume / dimensions complete', ready: unknownVolumeItems.length === 0, critical: unknownVolumeItems.length > 0, detail: `${unknownVolumeItems.length} included item${unknownVolumeItems.length === 1 ? '' : 's'} still have unknown cubic feet.` },
      ...(conjointMode
        ? [{
          category: 'inventory' as const,
          label: `${conjointPendingLabel} inventory`,
          ready: !conjointInventoryPending,
          critical: true,
          detail: `${conjointPendingLabel} has no tagged inventory items yet. Add MLS/photos/manual intake before sending a final quote.`,
        }]
        : []),
      ...(conjointVolumePending
        ? [{
          category: 'inventory' as const,
          label: `${conjointVolumePendingLabel} volume`,
          ready: false,
          critical: false,
          detail: `${conjointVolumePendingLabel} has tagged inventory, but cubic feet are still unknown. Timing, truck plan, and margin are provisional until the items are measured.`,
        }]
        : []),
      { category: 'logistics', label: 'Customer name', ready: Boolean(lead.name.trim()), critical: true, detail: 'Customer name is missing.' },
      { category: 'logistics', label: 'Phone', ready: Boolean((lead.phone || '').trim()), critical: true, detail: 'Phone number is missing.' },
      { category: 'logistics', label: 'Email or SMS available', ready: Boolean((lead.email || '').trim() || (lead.phone || '').trim()), critical: true, detail: 'No email or SMS delivery path is available.' },
      { category: 'logistics', label: isLaborOnly ? 'Work location' : 'Origin address', ready: Boolean(originFull.trim()), critical: true, detail: isLaborOnly ? 'Work location is missing.' : 'Origin address is missing.' },
      ...(isLaborOnly ? [] : [{ category: 'logistics' as const, label: 'Destination address', ready: Boolean(destFull.trim()), critical: true, detail: 'Destination address is missing.' }]),
      { category: 'logistics', label: isLaborOnly ? 'Work location geocoded' : 'Origin geocoded', ready: Boolean(originFull.trim() && !routeError && route?.originResolved), critical: true, detail: originFull.trim() ? `${isLaborOnly ? 'Work location' : 'Origin address'} could not be located.` : `${isLaborOnly ? 'Work location' : 'Origin address'} is missing.` },
      ...(isLaborOnly ? [] : [{ category: 'logistics' as const, label: 'Destination geocoded', ready: Boolean(destFull.trim() && !routeError && route?.destResolved), critical: true, detail: destFull.trim() ? 'Destination address could not be located.' : 'Destination address is missing.' }]),
      { category: 'logistics', label: 'Move date', ready: Boolean(selectedMoveDate), critical: true, detail: 'Move date is missing.' },
      { category: 'logistics', label: 'Origin access / parking', ready: originAccessConfirmed, detail: 'Origin stairs, elevator, parking, doorway, and carry distance are still unknown.' },
      ...(isLaborOnly ? [] : [{ category: 'logistics' as const, label: 'Destination access / parking', ready: destinationAccessConfirmed, detail: 'Destination stairs, elevator, parking, doorway, and carry distance are still unknown.' }]),
      { category: 'logistics', label: 'Packing status', ready: Boolean(jobFactors.packingStatus), detail: 'Packing status is not confirmed.' },
      { category: 'logistics', label: 'Boxes asked', ready: boxesAsked, detail: 'Boxes were not confirmed.' },
      { category: 'commercial', label: 'Crew / truck recommendation', ready: Boolean(pricingBreakdown?.crewSize && pricingBreakdown?.truckCount), critical: true, detail: 'Crew or truck recommendation is missing.' },
      { category: 'commercial', label: 'Specialty fulfillment priced', ready: contributionPlan.pricingGaps.length === 0, critical: contributionPlan.pricingGaps.length > 0, detail: contributionPlan.pricingGaps.length ? `Add confirmed specialty pricing for: ${contributionPlan.pricingGaps.map(item => item.label).join(', ')}.` : 'Specialty fulfillment is priced.' },
      {
        category: 'commercial',
        label: 'Final price confidence',
        ready: Boolean(pricingBreakdown && quoteModalTotals.total > 0 && !conjointInventoryPending),
        critical: conjointInventoryPending,
        detail: conjointInventoryPending
          ? `Price is only provisional until ${conjointPendingLabel} inventory is added.`
          : conjointVolumePending
            ? `Price is provisional because ${conjointVolumePendingLabel} has inventory items with unknown cubic feet.`
          : 'Price has not been generated yet.',
      },
      {
        category: 'logistics',
        label: 'Item-path intelligence',
        ready: pricingBreakdown?.moveIntelligence?.fixedPriceReadiness === 'ready',
        critical: pricingBreakdown?.moveIntelligence?.fixedPriceReadiness === 'manual_review',
        detail: pricingBreakdown?.moveIntelligence
          ? `${pricingBreakdown.moveIntelligence.fixedPriceReadiness.replace('_', ' ')} · ${pricingBreakdown.moveIntelligence.uncertaintyPct}% uncertainty · ${pricingBreakdown.moveIntelligence.questions.slice(0, 2).map(question => question.question).join(' ') || 'No unresolved high-impact questions.'}`
          : 'Item handling and origin/destination paths have not been assessed.',
      },
      { category: 'commercial', label: 'Margin reviewed', ready: Boolean(liveMarginSummary && liveMarginSummary.liveMargin >= 50), critical: Boolean(liveMarginSummary && liveMarginSummary.actualRevenue > 0 && liveMarginSummary.liveMargin < 40), detail: liveMarginSummary ? `Current margin is ${liveMarginSummary.liveMargin.toFixed(1)}%; manager review may be required.` : 'Margin has not been calculated.' },
      { category: 'commercial', label: 'Deposit amount', ready: quoteModalTotals.deposit > 0, critical: true, detail: 'Deposit amount is missing.' },
      { category: 'commercial', label: 'Quote explanation available', ready: Boolean(quoteExplanation.detailed.trim()), detail: 'Customer-facing price explanation is not ready.' },
    ]
    return items
  }, [boxesAsked, conjointInventoryPending, conjointMode, conjointPendingLabel, conjointVolumePending, conjointVolumePendingLabel, contributionPlan.pricingGaps, customerInventoryConfirmed, destFull, destinationAccessConfirmed, effectiveInventoryMetrics.totalItems, evidenceSources.length, isLaborOnly, jobFactors.packingStatus, lead.email, lead.name, lead.phone, liveMarginSummary, originAccessConfirmed, originFull, pricingBreakdown, quoteExplanation.detailed, quoteModalTotals.deposit, quoteModalTotals.total, quoteReadyAssessment.hidden, route?.destResolved, route?.originResolved, routeError, selectedMoveDate, unknownVolumeItems.length, unresolvedInventoryItems.length])
  const blockingReadiness = useMemo(
    () => readinessItems.filter(item => !item.ready && item.critical),
    [readinessItems]
  )
  const warningReadiness = useMemo(
    () => readinessItems.filter(item => !item.ready && !item.critical),
    [readinessItems]
  )
  const workflowStages = useMemo(() => buildEstimateWorkflowStages({
    readiness: readinessItems,
    laborOnly: isLaborOnly,
    hasLeadContext: Boolean(lead.name.trim() && (lead.phone || lead.email) && selectedMoveDate),
    hasOrigin: Boolean(originFull.trim()),
    hasDestination: Boolean(destFull.trim()),
    hasInventory: effectiveInventoryMetrics.totalItems > 0,
    hasHandlingPlan: Boolean(jobFactors.packingStatus || includedDisassemblyItems.length || jobFactors.specialtyNotes),
    hasOperationalPlan: Boolean(pricingBreakdown?.crewSize && pricingBreakdown?.truckCount),
    hasPrice: quoteModalTotals.total > 0,
  }), [destFull, effectiveInventoryMetrics.totalItems, includedDisassemblyItems.length, isLaborOnly, jobFactors.packingStatus, jobFactors.specialtyNotes, lead.email, lead.name, lead.phone, originFull, pricingBreakdown?.crewSize, pricingBreakdown?.truckCount, quoteModalTotals.total, readinessItems, selectedMoveDate])
  const activeStageIndex = Math.max(0, workflowStages.findIndex(stage => stage.id === activeStage))
  const activeWorkflowStage = workflowStages[activeStageIndex] || workflowStages[0]
  const goToStage = (stage: EstimateWorkflowStageId) => {
    setActiveStage(stage)
    requestAnimationFrame(() => document.getElementById('estimate-stage-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  useEffect(() => {
    if (!workflowStages.some(stage => stage.id === activeStage)) setActiveStage(workflowStages[0]?.id || 'lead')
  }, [activeStage, workflowStages])
  const sendIssueDetails = useMemo(
    () => [...blockingReadiness, ...warningReadiness]
      // Commercial checks are internal controls, never customer quote copy.
      .filter(item => item.category !== 'commercial')
      .map(item => item.detail),
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
    const calculatedContext = pricingBreakdown
      ? `Calculated baseline before override: ${formatMoney(baseQuoteSubtotal)} pre-tax; operational estimate: ${pricingBreakdown.crewSize} movers, ${pricingBreakdown.truckCount} truck${pricingBreakdown.truckCount === 1 ? '' : 's'}, about ${pricingBreakdown.totalHours}h at ${formatMoney(pricingBreakdown.crewRatePerHour)}/hr`
      : `Calculated baseline before override: ${formatMoney(baseQuoteSubtotal)} pre-tax`
    const separateServices = quoteLineItems.filter(item => isProtectionLine(item.description) || [
      packingLaborLineDescription,
      packingMaterialsLineDescription,
      junkLineDescription,
      cleaningLineDescription,
      containerHandlingLineDescription,
    ].includes(item.description))
    onSetLineItems([{
      description: 'Moving Services — Agreed Rate',
      details: `${getOverrideReasonLabel(overrideReason)} — ${note}. ${calculatedContext}. ${marginText}. ${approvalText}.`,
      amount,
    }, ...separateServices])
    setOverrideApplied(true)
    setBookTodayActive(false)
    setTenPctActive(false)
  }

  function saveAsRouteUnresolved() {
    onInternalNotesChange(prependUniqueLine(internalNotes, `Route unresolved: ${routeError || routeContext?.missingRequirements?.[0] || 'manual review required'}`))
  }

  async function handlePreviewSend() {
    if (blockingReadiness.length > 0 || warningReadiness.length > 0) {
      if (estimateView === 'simple') {
        await handleProvisionalSend()
        return
      }
      setSendGuardOpen(true)
      return
    }
    await onSaveAndPreview({ conditionalClause: conditionalClauseEnabled ? conditionalClauseText : undefined, quoteType, customerScope: captureCustomerScope(), scopeStatus: 'confirmed' })
  }

  async function handleProvisionalSend() {
    const missingItems = sendIssueDetails.length > 0 ? sendIssueDetails : ['Missing quote details still need confirmation.']
    const moveNote = `Provisional estimate. Final pricing will be confirmed once we verify: ${missingItems.join(' ')}`
    const internalNote = `PROVISIONAL QUOTE — collect before final confirmation: ${missingItems.join(' ')}`
    await onSaveAndPreview({
      provisional: true,
      scopeStatus: 'provisional',
      missingItems,
      quoteType,
      moveDescription: prependUniqueLine(moveDescription, moveNote),
      internalNotes: prependUniqueLine(internalNotes, internalNote),
      customerScope: captureCustomerScope(),
    })
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/35 px-0 py-0 md:px-4 md:py-6" onClick={onClose}>
      <div
        className="mx-auto flex min-h-screen w-full max-w-6xl flex-col overflow-hidden rounded-none border border-[var(--app-line)] bg-[var(--app-panel)] shadow-none md:my-4 md:min-h-0 md:rounded-[12px]"
        onClick={event => event.stopPropagation()}
      >
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-[var(--app-line)] px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
          <div>
            <div className="crm-label">Estimate Draft</div>
            <div className="mt-1 text-2xl font-semibold text-[var(--app-ink)]">{quote?.number || 'Preparing draft...'}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-[var(--app-muted)]">
              <span>{quoteType === 'labor_only' ? `Work location: ${originFull || 'TBD'}` : `${originFull || 'Origin TBD'} → ${destFull || 'Destination TBD'}`}</span>
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

        <div className="sticky top-0 z-30 border-b border-[var(--app-line)] bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Estimate view</span>
              <span className="ml-2 text-[10px] text-[var(--app-muted)]">Both views save the same complete move context.</span>
            </div>
            <div className="flex rounded-[7px] border border-[var(--app-line)] bg-[var(--app-bg)] p-0.5">
              <button type="button" onClick={() => chooseEstimateView('simple')} className={`rounded-[5px] px-3 py-1 text-[10px] font-semibold ${estimateView === 'simple' ? 'bg-white text-[var(--app-ink)] shadow-sm' : 'text-[var(--app-muted)]'}`}>Simple</button>
              <button type="button" onClick={() => chooseEstimateView('guided')} className={`rounded-[5px] px-3 py-1 text-[10px] font-semibold ${estimateView === 'guided' ? 'bg-[#071421] text-white' : 'text-[var(--app-muted)]'}`}>Guided</button>
            </div>
          </div>
          {estimateView === 'guided' ? <><div className="flex items-center gap-2 overflow-x-auto">
            {workflowStages.map((step, index) => (
              <button
                key={step.id}
                type="button"
                onClick={() => goToStage(step.id)}
                className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
                  activeStage === step.id
                    ? 'border-[#071421] bg-[#071421] text-white'
                    : step.status === 'complete'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}
              >
                {step.status === 'complete' ? '✓ ' : step.status === 'needs_attention' ? '! ' : '○ '}{index + 1} · {step.label}
              </button>
            ))}
          </div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-[var(--app-ink)]">{activeWorkflowStage?.label}</div>
              <div className="truncate text-[10px] text-[var(--app-muted)]">{activeWorkflowStage?.description}</div>
            </div>
            <span className="shrink-0 text-[10px] text-[var(--app-muted)]">{activeWorkflowStage?.issueCount ? `${activeWorkflowStage.issueCount} item${activeWorkflowStage.issueCount === 1 ? '' : 's'} to confirm` : 'Stage complete'}</span>
          </div></> : <div className="text-xs text-[var(--app-muted)]">Everything is on one page. Review only what matters, then use the readiness summary before sending.</div>}
        </div>

        <div id="estimate-stage-content" className={`scroll-mt-28 grid ${estimateView === 'simple' || activeStage === 'plan' ? 'xl:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
          {/* Main content */}
          <div className="overflow-y-auto p-4 md:p-6 space-y-6">
            {estimateView === 'guided' ? <style>{`[data-estimate-stage]:not([data-estimate-stage="${activeStage}"]) { display: none !important; }`}</style> : null}

            {/* ── SMART INTAKE ── */}
            <div data-estimate-stage="lead" className={`rounded-[10px] border ${intakeApplied ? 'border-emerald-300 bg-emerald-50' : 'border-[#071421]/20 bg-[#071421]/5'} overflow-hidden`}>
              <button
                type="button"
                onClick={() => setIntakeOpen(v => !v)}
                className="flex w-full items-center justify-between px-4 py-3"
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">🧠</span>
                  <div className="text-left">
                    <div className="text-sm font-semibold text-[#071421]">
                      Smart Intake {intakeApplied ? '· Applied ✓' : ''}
                    </div>
                    <div className="text-[11px] text-[#071421]/50">
                      Describe the move in plain English — AI fills in the fields
                    </div>
                  </div>
                </div>
                <span className="text-[var(--app-muted)] text-sm">{intakeOpen ? '▲' : '▼'}</span>
              </button>

              {intakeOpen && (
                <div className="border-t border-[#071421]/10 px-4 pb-4 pt-3 space-y-3">
                  <textarea
                    rows={5}
                    value={intakeText}
                    onChange={e => setIntakeText(e.target.value)}
                    className="w-full rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-2.5 text-sm text-[var(--app-ink)] placeholder:text-[var(--app-muted)] focus:border-[#071421] focus:outline-none resize-none"
                    placeholder={`Describe the move — e.g.:\n\n"Lady moving 4-bed house in Greeley to storage first. Keys not available until 1pm. Needs full packing, has a piano and a large safe. Then 10 days later moving from storage to new house in Brockville. 2 kids helping on move day. Wants junk removal too."`}
                  />

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => void runSmartIntake()}
                      disabled={intakeBusy || !intakeText.trim()}
                      className="flex-1 rounded-[8px] bg-[#071421] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
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
                        <div className="rounded-[6px] border border-[#071421]/20 bg-white px-3 py-2.5 text-sm text-[#071421]">
                          <span className="font-semibold">Understood: </span>{intakeResult.summary}
                        </div>
                      )}

                      {(intakeResult.scenarioType || intakeResult.recommendations) && (
                        <div className="rounded-[6px] border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-violet-900">
                            {intakeResult.scenarioType && (
                              <span className="rounded-full bg-white px-2 py-1 font-semibold">
                                Scenario: {intakeResult.scenarioType.replace(/_/g, ' ')}
                              </span>
                            )}
                            {intakeResult.recommendations?.setup && (
                              <span className="rounded-full bg-white px-2 py-1 font-semibold">
                                Setup: {intakeResult.recommendations.setup.replace(/_/g, ' ')}
                              </span>
                            )}
                            {(intakeResult.recommendations?.startTime || intakeResult.moveTime) && (
                              <span className="rounded-full bg-white px-2 py-1 font-semibold">
                                Start: {intakeResult.recommendations?.startTime || intakeResult.moveTime}
                              </span>
                            )}
                          </div>
                          {intakeResult.recommendations?.truckPlan && (
                            <div className="text-[11px] font-semibold text-violet-900">{intakeResult.recommendations.truckPlan}</div>
                          )}
                          {intakeResult.recommendations?.rationale && (
                            <div className="text-[11px] text-violet-800">{intakeResult.recommendations.rationale}</div>
                          )}
                          {(intakeResult.recommendations?.nextBestActions?.length ?? 0) > 0 && (
                            <div className="space-y-0.5">
                              <div className="text-[10px] font-bold uppercase tracking-wider text-violet-700">Next best actions</div>
                              {intakeResult.recommendations!.nextBestActions!.map((action, i) => (
                                <div key={i} className="text-[11px] text-violet-800">• {action}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {(intakeResult.parties?.length ?? 0) > 0 && (
                        <div className="rounded-[6px] border border-slate-200 bg-white px-3 py-2.5 space-y-2">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Pickup contexts</div>
                          {intakeResult.parties!.map((party, i) => (
                            <div key={`${party.label}-${i}`} className="rounded-[6px] border border-slate-100 bg-slate-50 px-2.5 py-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[12px] font-semibold text-[#071421]">{party.label}</div>
                                  <div className="truncate text-[11px] text-slate-500">{party.pickupAddress || party.pickupCity || 'Address pending'}</div>
                                </div>
                                <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${party.missingInventory ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                                  {party.missingInventory ? 'Inventory pending' : 'Inventory known'}
                                </span>
                              </div>
                              {(party.inventorySources?.length ?? 0) > 0 && (
                                <div className="mt-1 flex flex-wrap gap-1">
                                  {party.inventorySources!.map(source => (
                                    <span key={source} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                      {source.replace(/_/g, ' ')}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* What will be filled */}
                      <div className="rounded-[6px] border border-sky-200 bg-sky-50 px-3 py-2.5 space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Will fill in:</div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-sky-800">
                          {intakeResult.scenarioType && <span>✓ Scenario: {intakeResult.scenarioType.replace(/_/g, ' ')}</span>}
                          {(intakeResult.parties?.length ?? 0) > 0 && <span>✓ Pickup contexts: {intakeResult.parties?.length}</span>}
                          {(intakeResult.constraints?.length ?? 0) > 0 && <span>✓ Constraints: {intakeResult.constraints?.length}</span>}
                          {intakeResult.quoteType && <span>✓ Quote type: {intakeResult.quoteType.replace('_', ' ')}</span>}
                          {intakeResult.branch && <span>✓ Branch: {intakeResult.branch}</span>}
                          {(intakeResult.recommendations?.startTime || intakeResult.moveTime) && <span>✓ Start time: {intakeResult.recommendations?.startTime || intakeResult.moveTime}</span>}
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

            {/* Route / work-location quick edit — hidden when multi-stop is on (legs ARE the route) */}
            {(estimateView === 'simple' || activeStage === 'origin' || activeStage === 'destination') && (onOriginAddressChange || onDestAddressChange) && !legsEnabled && (
              <div id="estimate-route" ref={routeSectionRef} className="scroll-mt-16 rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label mb-1">{estimateView === 'simple' ? (isLaborOnly ? 'Work Location' : 'Move Route') : activeStage === 'destination' ? 'Destination' : isLaborOnly ? 'Work Location' : 'Origin'}</div>
                <div className="mb-3 text-xs text-[var(--app-muted)]">Confirm the address first, then describe the actual route the crew will carry furniture.</div>
                <div className={`grid gap-3 ${estimateView === 'simple' && !isLaborOnly ? 'sm:grid-cols-2' : ''}`}>
                  {(estimateView === 'simple' || activeStage === 'origin' || isLaborOnly) && <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">{isLaborOnly ? 'Service address' : 'Origin'}</div>
                    <AddressAutocompleteInput
                      value={originAddress || lead.originAddress || ''}
                      placeholder={isLaborOnly ? 'Where the labour is needed' : 'Origin address'}
                      onSelect={(address, city, placeType, placeId) => {
                        onOriginAddressChange?.(address)
                        if (city) onOriginCityChange?.(city)
                        if (placeId) setOriginPlaceId(placeId)
                        if (placeType === 'apartment' || placeType === 'house') {
                          const profiles = accessProfilesForStops({ lead: { ...lead, jobFactors }, legs: undefined })
                          const suggestedType = placeType === 'apartment' ? 'low_rise' : 'detached'
                          onJobFactorsChange({ ...jobFactors, accessProfiles: profiles.map(profile => profile.stopRole === 'pickup' ? { ...profile, propertyType: suggestedType, propertyTypeSource: 'address_provider' as const, standardAccessConfirmed: false, evidenceStatus: 'customer_estimated' as const, evidenceNote: 'Property type suggested from the address provider; practical access still needs confirmation.' } : profile) })
                        }
                      }}
                    />
                  </div>}
                  {!isLaborOnly && (estimateView === 'simple' || activeStage === 'destination') && <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">Destination</div>
                    <AddressAutocompleteInput
                      value={destAddress || lead.destAddress || destCity || lead.destCity || ''}
                      placeholder="Destination address or city"
                      onSelect={(address, city, placeType, placeId) => {
                        onDestAddressChange?.(address)
                        if (city) onDestCityChange?.(city)
                        if (placeId) setDestPlaceId(placeId)
                        if (placeType === 'apartment' || placeType === 'house') {
                          const profiles = accessProfilesForStops({ lead: { ...lead, jobFactors }, legs: undefined })
                          const suggestedType = placeType === 'apartment' ? 'low_rise' : 'detached'
                          onJobFactorsChange({ ...jobFactors, accessProfiles: profiles.map(profile => profile.stopRole === 'dropoff' ? { ...profile, propertyType: suggestedType, propertyTypeSource: 'address_provider' as const, standardAccessConfirmed: false, evidenceStatus: 'customer_estimated' as const, evidenceNote: 'Property type suggested from the address provider; practical access still needs confirmation.' } : profile) })
                        }
                      }}
                    />
                  </div>}
                </div>
                <div className="mt-4">
                  <AccessProfileEditor
                    lead={lead}
                    factors={jobFactors}
                    legs={undefined}
                    singleLocation={isLaborOnly}
                    stopRole={estimateView === 'simple' ? undefined : activeStage === 'destination' ? 'dropoff' : 'pickup'}
                    compact
                    baseHours={{ origin: Number(pricingBreakdown?.loadHours || 0), destination: Number(pricingBreakdown?.unloadHours || 0) }}
                    currentUserName={currentUser?.name}
                    onChange={onJobFactorsChange}
                  />
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
                        {isLaborOnly ? originFull || 'Work location TBD' : `${originFull || 'Origin TBD'} → ${destFull || 'Destination TBD'}`}
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
                  {Boolean(routeError || route?.missingRequirements?.length) && (
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

            {(estimateView === 'simple' || activeStage === 'origin' || activeStage === 'destination') && legsEnabled && (
              <div className="rounded-[10px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label mb-1">{activeStage === 'destination' ? 'Delivery access' : 'Pickup access'}</div>
                <p className="mb-4 text-xs leading-5 text-[var(--app-muted)]">This move has multiple stops. Each {activeStage === 'destination' ? 'delivery' : 'pickup'} keeps its own access profile so one easy address cannot hide a difficult one.</p>
                <AccessProfileEditor
                  lead={lead}
                  factors={jobFactors}
                  legs={legs}
                  singleLocation={isLaborOnly}
                  stopRole={estimateView === 'simple' ? undefined : activeStage === 'destination' ? 'dropoff' : 'pickup'}
                  compact
                  baseHours={{ origin: Number(pricingBreakdown?.loadHours || 0), destination: Number(pricingBreakdown?.unloadHours || 0) }}
                  currentUserName={currentUser?.name}
                  onChange={onJobFactorsChange}
                />
              </div>
            )}

            {/* Quote Type Selector */}
            <div data-estimate-stage="lead">
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
                      const storageScopeActive = quoteType === 'storage' || jobFactors.temporaryStorageNeeded === true || legs.some(leg => leg.type === 'storage' || leg.type === 'storage_delivery')
                      if (opt.id !== 'storage' && storageScopeActive) {
                        clearStorageScope(opt.id)
                        return
                      }
                      setQuoteType(opt.id)
                      // Defer recalculate to next tick so button state updates first (fixes INP)
                      setTimeout(() => onRecalculate({
                        quoteType: opt.id,
                        distanceKm: distanceKm || route?.distanceKm || undefined,
                        routeContext,
                      }), 0)
                    }}
                    className={quoteType === opt.id
                      ? 'rounded-full px-4 py-1.5 text-sm font-semibold bg-[#071421] text-white'
                      : 'rounded-full border border-slate-200 bg-white text-slate-500 px-4 py-1.5 text-sm hover:border-[#071421] transition'}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {effectiveInventoryMetrics.totalCubicFeet > 0 && (
              <div data-estimate-stage="plan" className="rounded-[10px] border border-sky-200 bg-sky-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-sky-700">Recommended operating setup</div>
                    <div className="mt-1 text-sm font-semibold text-sky-950">
                      {suggestTruckCount(
                        effectiveInventoryMetrics.totalCubicFeet,
                        effectiveInventoryMetrics.totalWeightLbs,
                        route?.category === 'long-distance' || quoteType === 'long_distance' ? 'long-distance' : lead.moveType,
                      )} company truck{suggestTruckCount(effectiveInventoryMetrics.totalCubicFeet, effectiveInventoryMetrics.totalWeightLbs, route?.category === 'long-distance' || quoteType === 'long_distance' ? 'long-distance' : lead.moveType) > 1 ? 's' : ''}
                      {' · '}{pricingBreakdown?.crewSize || 3} movers
                    </div>
                    <div className="mt-1 text-xs leading-5 text-sky-800">
                      Based on {effectiveInventoryMetrics.totalCubicFeet.toLocaleString()} cu ft / {effectiveInventoryMetrics.totalWeightLbs.toLocaleString()} lbs.
                      {(route?.category === 'long-distance' || quoteType === 'long_distance')
                        ? ' Long-distance transport is priced by the required one-way truck capacity, not by each ordinary item. Inventory is still required to confirm truck count, loading complexity, specialty handling, and safe dispatch.'
                        : null}
                      {effectiveInventoryMetrics.totalCubicFeet >= 1200 && effectiveInventoryMetrics.totalCubicFeet <= 1600
                        ? ' This is close to practical capacity; safer fallback is one main truck plus a 10-ft overflow truck.'
                        : effectiveInventoryMetrics.totalCubicFeet > 1600
                          ? ' Inventory exceeds one-truck safe capacity; do not plan this as a single-load job.'
                          : ` If using a rental for labor-only or container support, the inventory-equivalent size is ${truckSizeFromCubicFeet(effectiveInventoryMetrics.totalCubicFeet)}.`}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setFactors({
                        ...jobFactors,
                        truckCountOverride: suggestTruckCount(effectiveInventoryMetrics.totalCubicFeet, effectiveInventoryMetrics.totalWeightLbs, route?.category === 'long-distance' || quoteType === 'long_distance' ? 'long-distance' : lead.moveType),
                      })}
                      className="rounded-[6px] bg-sky-900 px-3 py-1.5 text-[11px] font-semibold text-white"
                    >
                      Use recommendation
                    </button>
                    {effectiveInventoryMetrics.totalCubicFeet >= 1200 && effectiveInventoryMetrics.totalCubicFeet <= 1600 && (
                      <button
                        type="button"
                        onClick={() => setFactors({ ...jobFactors, truckCountOverride: 2, crewSizeOverride: Math.max(jobFactors.crewSizeOverride || 0, 4) })}
                        className="rounded-[6px] border border-sky-300 bg-white px-3 py-1.5 text-[11px] font-semibold text-sky-900"
                      >
                        Use safer 2-truck plan
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {lead.moveType === 'commercial' && (
              <div data-estimate-stage="handling" className="rounded-[8px] border border-sky-200 bg-sky-50/70 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="crm-label">Commercial Scope</div>
                    <div className="mt-0.5 text-[11px] leading-5 text-sky-800/75">
                      Keep the quote tied to business logistics: site contact, invoice/PO, access window, dock/elevator, COI, labeling, IT, and disposal.
                    </div>
                  </div>
                  <span className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-sky-700">Commercial</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-sky-900">Company / Department</span>
                    <input
                      value={jobFactors.commercialCompanyName || ''}
                      onChange={e => setFactor('commercialCompanyName', e.target.value || undefined)}
                      className="crm-input bg-white"
                      placeholder="e.g. City office, clinic, retail store"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-sky-900">PO / Billing Ref</span>
                    <input
                      value={jobFactors.commercialPoNumber || ''}
                      onChange={e => setFactor('commercialPoNumber', e.target.value || undefined)}
                      className="crm-input bg-white"
                      placeholder="PO number or invoice contact"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-sky-900">Site Contact</span>
                    <input
                      value={jobFactors.commercialSiteContact || ''}
                      onChange={e => setFactor('commercialSiteContact', e.target.value || undefined)}
                      className="crm-input bg-white"
                      placeholder="Name + phone for move day"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-sky-900">Access Window</span>
                    <input
                      value={jobFactors.commercialAccessWindow || ''}
                      onChange={e => setFactor('commercialAccessWindow', e.target.value || undefined)}
                      className="crm-input bg-white"
                      placeholder="e.g. after 5 PM, dock 9-12"
                    />
                  </label>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {[
                    ['commercialLoadingDock', 'Loading dock'],
                    ['commercialFreightElevator', 'Freight elevator'],
                    ['commercialAfterHours', 'After-hours'],
                    ['commercialCOIRequired', 'COI required'],
                    ['commercialLabelingRequired', 'Label/placement plan'],
                    ['commercialITEquipment', 'IT/electronics'],
                    ['commercialDisposalRequired', 'Disposal/cleanout'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center gap-2 rounded-[6px] border border-sky-200 bg-white px-3 py-2 text-xs font-medium text-sky-900">
                      <input
                        type="checkbox"
                        checked={!!jobFactors[key as keyof JobFactors]}
                        onChange={e => setFactors({ ...jobFactors, [key]: e.target.checked || undefined })}
                        className="h-3.5 w-3.5"
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-5">
                  {[
                    ['commercialProtectionCost', 'Protection / materials', 'Blankets, floor cover, cartons'],
                    ['commercialLiabilityCost', 'Safety / liability / COI', 'COI, high-risk handling'],
                    ['commercialAdminCost', 'Admin / permit / security', 'Building desk, permits, escorts'],
                    ['commercialOtherDirectCost', 'Other direct cost', 'Custom vendor or disposal'],
                    ['commercialMarkupRate', 'Commercial markup %', 'Risk/coordination markup'],
                  ].map(([key, label, placeholder]) => (
                    <label key={key} className="block">
                      <span className="mb-1 block text-xs font-medium text-sky-900">{label}</span>
                      <input
                        type="number"
                        min={0}
                        step={key === 'commercialMarkupRate' ? 1 : 5}
                        value={Number(jobFactors[key as keyof JobFactors] || 0) || ''}
                        onChange={e => setFactor(key as keyof JobFactors, (e.target.value ? Number(e.target.value) : undefined) as never)}
                        className="crm-input bg-white"
                        placeholder={placeholder}
                      />
                    </label>
                  ))}
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-sky-900">Commercial Notes</span>
                  <textarea
                    rows={2}
                    value={jobFactors.commercialScopeNotes || ''}
                    onChange={e => setFactor('commercialScopeNotes', e.target.value || undefined)}
                    className="crm-input resize-none bg-white"
                    placeholder="Departments, workstations, server room, security desk, building rules, invoice contact, or unusual equipment."
                  />
                </label>
              </div>
            )}

            {/* ── ADD-ON SERVICES ── */}
            <div data-estimate-stage="handling" id="estimate-services" className="scroll-mt-16 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 space-y-3">
              <div>
                <div className="crm-label">Customer Move Plan</div>
                <div className="mt-0.5 text-[11px] text-[var(--app-muted)]">Start with the core move, then shape the complete transition around what this customer actually needs.</div>
              </div>

              <div className={`rounded-[8px] border p-3 ${
                consultativeMovePlan.estimateMode === 'firm'
                  ? 'border-emerald-200 bg-emerald-50'
                  : consultativeMovePlan.estimateMode === 'locked_scope'
                    ? 'border-amber-200 bg-amber-50'
                    : 'border-sky-200 bg-sky-50'
              }`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--app-muted)]">
                    {consultativeMovePlan.estimateMode === 'firm'
                      ? 'Firm estimate ready'
                      : consultativeMovePlan.estimateMode === 'locked_scope'
                        ? 'Lock the known scope now'
                        : 'Planning estimate'}
                  </div>
                  {lead.moveDateFlexible ? (
                    <span className="rounded-full border border-amber-300 bg-white px-2 py-1 text-[10px] font-semibold text-amber-900">
                      Date remains flexible
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs leading-5 text-[var(--app-ink)]">{consultativeMovePlan.estimateMessage}</p>
                {(consultativeMovePlan.knownNow.length > 0 || consultativeMovePlan.finalizeLater.length > 0) ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">Known and priceable now</div>
                      <div className="mt-1 space-y-1 text-[11px] leading-4 text-[var(--app-ink)]">
                        {consultativeMovePlan.knownNow.map(item => <div key={item}>✓ {item}</div>)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Finalize without restarting</div>
                      <div className="mt-1 space-y-1 text-[11px] leading-4 text-[var(--app-ink)]">
                        {consultativeMovePlan.finalizeLater.map(item => <div key={item}>○ {item}</div>)}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Closing / possession timing</span>
                  <select value={jobFactors.destinationTiming || ''} onChange={e => {
                    const destinationTiming = (e.target.value || undefined) as JobFactors['destinationTiming']
                    if (destinationTiming === 'same_day' && jobFactors.temporaryStorageNeeded) {
                      clearStorageScope(undefined, { destinationTiming })
                    } else {
                      setFactor('destinationTiming', destinationTiming)
                    }
                  }} className="crm-input bg-white text-xs">
                    <option value="">Ask customer</option>
                    <option value="same_day">Dates line up</option>
                    <option value="known_gap">Known gap</option>
                    <option value="unknown">New home/date unknown</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Packing preference</span>
                  <select value={jobFactors.packingPreference || ''} onChange={e => setFactor('packingPreference', (e.target.value || undefined) as never)} className="crm-input bg-white text-xs">
                    <option value="">Ask customer</option>
                    <option value="self">Self-pack</option>
                    <option value="partial_help">Help with selected rooms</option>
                    <option value="full_service">Full packing service</option>
                    <option value="undecided">Undecided</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Cleaning preference</span>
                  <select value={jobFactors.cleaningPreference || ''} onChange={e => setFactor('cleaningPreference', (e.target.value || undefined) as never)} className="crm-input bg-white text-xs">
                    <option value="">Ask customer</option>
                    <option value="none">No cleaning needed</option>
                    <option value="move_out">Move-out cleaning</option>
                    <option value="move_in">Move-in cleaning</option>
                    <option value="both">Both homes</option>
                    <option value="undecided">Undecided</option>
                  </select>
                </label>
              </div>

              {(jobFactors.destinationTiming === 'known_gap' || jobFactors.destinationTiming === 'unknown') && (
                <div className="grid gap-2 rounded-[7px] border border-indigo-200 bg-indigo-50 p-3 sm:grid-cols-3">
                  <label className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                    <input type="checkbox" checked={jobFactors.temporaryStorageNeeded === true} onChange={e => {
                      if (e.target.checked) setFactor('temporaryStorageNeeded', true)
                      else clearStorageScope()
                    }} />
                    Temporary storage
                  </label>
                  <label className="flex items-center gap-2 text-xs font-semibold text-indigo-900">
                    <input type="checkbox" checked={Boolean(jobFactors.storageDurationKnown)} onChange={e => setFactor('storageDurationKnown', e.target.checked)} />
                    End date is known
                  </label>
                  <label className="flex items-center gap-2 text-xs text-indigo-900">
                    <span>Model</span>
                    <input type="number" min={1} max={24} value={jobFactors.storageEstimatedMonths || 2} onChange={e => setFactor('storageEstimatedMonths', Math.max(1, Number(e.target.value || 2)))} className="crm-input w-16 bg-white text-xs" />
                    <span>month(s)</span>
                  </label>
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-5">
                {consultativeMovePlan.phases.map(phase => (
                  <div key={phase.id} className={`rounded-[7px] border p-2 ${
                    phase.status === 'included' ? 'border-emerald-200 bg-emerald-50' : phase.status === 'pending' ? 'border-amber-200 bg-amber-50' : 'border-[var(--app-line)] bg-white'
                  }`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--app-muted)]">{phase.label}</div>
                    <div className="mt-1 text-[10px] leading-4 text-[var(--app-ink)]">{phase.summary}</div>
                  </div>
                ))}
              </div>

              {consultativeMovePlan.questions.length > 0 && (
                <div className="rounded-[7px] border border-sky-200 bg-sky-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-sky-800">Ask naturally—one at a time</div>
                  <div className="mt-1.5 space-y-1 text-xs text-sky-950">
                    {consultativeMovePlan.questions.map(question => <div key={question}>• {question}</div>)}
                  </div>
                </div>
              )}

              {consultativeMovePlan.nudges.length > 0 ? (
                <div className="rounded-[7px] border border-violet-200 bg-violet-50 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-violet-800">CRM follow-through</div>
                  <div className="mt-1.5 space-y-1.5 text-xs text-violet-950">
                    {consultativeMovePlan.nudges.map(nudge => (
                      <div key={nudge.key}>
                        <span className="font-semibold">{nudge.label}</span>
                        <span className="text-violet-700"> · {nudge.trigger}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Service chips */}
              <div className="flex flex-wrap gap-2">
                {/* Moving — always active */}
                <div className="flex items-center gap-1.5 rounded-full bg-[#071421] px-3 py-1.5 text-xs font-semibold text-white">
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
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]'
                  }`}
                >
                  {packingLaborAdded || packingMaterialsAdded ? '✓' : '+'} Packing
                </button>

                {/* Unpacking — selected only after customer interest */}
                <button
                  type="button"
                  onClick={toggleUnpackingService}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    unpackingAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]'
                  }`}
                  title="Add only after the customer asks for unpacking help"
                >
                  {unpackingAdded ? '✓' : '+'} Unpacking
                </button>

                {/* Junk Removal */}
                <button
                  type="button"
                  onClick={toggleJunk}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    junkAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]'
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
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]'
                  }`}
                >
                  {valuationAdded ? '✓' : '+'} Protection · {formatMoney(protectionRecommendation.price)}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (cleaningAdded) {
                      onSetLineItems(quoteLineItems.filter(item => item.description !== cleaningLineDescription))
                    } else {
                      onSetLineItems([...quoteLineItems, {
                        description: cleaningLineDescription,
                        details: 'Cleaning scope and price to be confirmed with the customer',
                        amount: 0,
                      }])
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    cleaningAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]'
                  }`}
                >
                  {cleaningAdded ? '✓' : '+'} Cleaning
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (containerHandlingAdded) {
                      onSetLineItems(quoteLineItems.filter(item => item.description !== containerHandlingLineDescription))
                    } else {
                      onSetLineItems([...quoteLineItems, {
                        description: containerHandlingLineDescription,
                        details: 'Labor-only loading or unloading of customer-supplied storage container; truck not included',
                        amount: 0,
                      }])
                      setQuoteType('labor_only')
                    }
                  }}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    containerHandlingAdded
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                      : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[#071421] hover:text-[#071421]'
                  }`}
                >
                  {containerHandlingAdded ? '✓' : '+'} Storage Container Labor
                </button>

                {/* TV Box — auto-surfaces when ANY TV detected, $20/box, not in free boxes */}
                {tvBoxCount > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (tvBoxesAdded) {
                        onSetLineItems(quoteLineItems.filter(li => li.description !== tvBoxLineDescription))
                      } else {
                        onAddLineItem()
                        setTimeout(() => {
                          const idx = quoteLineItems.length
                          onUpdateLineItem(idx, 'description', tvBoxLineDescription)
                          onUpdateLineItem(idx, 'details', `${tvBoxCount} TV box${tvBoxCount > 1 ? 'es' : ''} — size-matched U-Haul boxes, not included in free boxes`)
                          onUpdateLineItem(idx, 'amount', String(tvBoxRevenue))
                        }, 50)
                      }
                    }}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      tvBoxesAdded
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500'
                    }`}
                    title={`${tvBoxCount} TV detected — ${formatMoney(tvBoxRevenue)} (U-Haul cost ${formatMoney(tvBoxCost)} + 10%)`}
                  >
                    {tvBoxesAdded ? '✓' : '📦'} TV Box{tvBoxCount > 1 ? `es (${tvBoxCount})` : ''} · {formatMoney(tvBoxRevenue)}
                  </button>
                )}

                {/* TV Dismount — only for wall-mounted TVs */}
                {wallMountedTvs.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (tvDismountAdded) {
                        onSetLineItems(quoteLineItems.filter(li => li.description !== tvDismountLineDescription))
                      } else {
                        onAddLineItem()
                        setTimeout(() => {
                          const idx = quoteLineItems.length
                          onUpdateLineItem(idx, 'description', tvDismountLineDescription)
                          onUpdateLineItem(idx, 'details', `${wallMountedTvs.length} TV${wallMountedTvs.length > 1 ? 's' : ''} — dismount at origin, remount at destination`)
                          onUpdateLineItem(idx, 'amount', String(tvDismountPrice))
                        }, 50)
                      }
                    }}
                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      tvDismountAdded
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-500'
                    }`}
                    title={`${wallMountedTvs.length} wall-mounted TV${wallMountedTvs.length > 1 ? 's' : ''} detected — $${tvDismountPrice}`}
                  >
                    {tvDismountAdded ? '✓' : '📺'} TV Dismount${wallMountedTvs.length > 1 ? ` (${wallMountedTvs.length})` : ''} · ${tvDismountPrice > 0 ? `$${tvDismountPrice}` : ''}
                  </button>
                )}
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
                  <div className="w-full max-w-md rounded-[16px] border border-[var(--app-line)] bg-white p-6 shadow-none">
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
                    <div className="font-semibold">Move Protection Plus</div>
                    <div className="text-emerald-700">Optional enhanced protection · recommendation adjusts to the move context · terms and declared-value limits apply</div>
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
            <div data-estimate-stage="lead" className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4 space-y-3">
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
                    if (!next) {
                      const hasStorageLeg = legs.some(leg => leg.type === 'storage' || leg.type === 'storage_delivery')
                      if (hasStorageLeg || quoteType === 'storage' || jobFactors.temporaryStorageNeeded) {
                        clearStorageScope()
                      } else {
                        setLegs([])
                        onLegsChange?.([])
                        if (conjointMode) onJobFactorsChange({ ...jobFactors, conjointMove: false })
                      }
                    }
                  }}
                  className={`rounded-full px-3 py-1 text-[11px] font-semibold transition-colors ${legsEnabled ? 'bg-[#071421] text-white' : 'bg-[var(--app-line)] text-[var(--app-muted)]'}`}
                >
                  {legsEnabled ? 'On' : 'Off'}
                </button>
              </div>

              {/* Conjoint Move quick-start */}
              {!legsEnabled && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={applyConjointTemplate}
                    className="rounded-full bg-purple-100 px-3 py-1 text-[11px] font-semibold text-purple-800 hover:bg-purple-200 transition-colors"
                  >
                    + Conjoint Move
                  </button>
                  <button
                    type="button"
                    onClick={applyStorageTemplate}
                    className="rounded-full bg-blue-100 px-3 py-1 text-[11px] font-semibold text-blue-800 hover:bg-blue-200 transition-colors"
                  >
                    + Storage / Staged Move
                  </button>
                  <span className="text-[10px] text-[var(--app-muted)]">Conjoint = separate households. Storage = same inventory across dates.</span>
                </div>
              )}

              {legsEnabled && conjointMode && (
                <div className="rounded-[8px] border border-purple-200 bg-purple-50 p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-700">Conjoint Move</span>
                    <button
                      type="button"
                      onClick={() => onJobFactorsChange({ ...jobFactors, conjointMove: false })}
                      className="ml-auto text-[10px] text-purple-500 hover:text-purple-800"
                    >
                      Remove template
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-purple-600">Person A name</div>
                      <input
                        value={jobFactors.personALabel || ''}
                        onChange={e => setFactor('personALabel', e.target.value || undefined)}
                        placeholder="e.g. Sam"
                        className="w-full rounded-[6px] border border-purple-200 bg-white px-2 py-1.5 text-[11px] text-[var(--app-ink)] outline-none focus:border-purple-400"
                      />
                    </div>
                    <div>
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-purple-600">Person B name</div>
                      <input
                        value={jobFactors.personBLabel || ''}
                        onChange={e => setFactor('personBLabel', e.target.value || undefined)}
                        placeholder="e.g. Michelle"
                        className="w-full rounded-[6px] border border-purple-200 bg-white px-2 py-1.5 text-[11px] text-[var(--app-ink)] outline-none focus:border-purple-400"
                      />
                    </div>
                  </div>
                  <div className="text-[10px] text-purple-600">
                    Leg 1 picks up {jobFactors.personALabel || 'Person A'} · Leg 2 picks up {jobFactors.personBLabel || 'Person B'} then delivers everything. Tag inventory items below with A or B.
                  </div>
                </div>
              )}

              {legsEnabled && (
                <div className="space-y-3">
                  {legs.map((leg, idx) => (
                    <div key={leg.id} className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                      {/* Leg header */}
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#071421] text-[9px] font-bold text-white shrink-0">{idx + 1}</span>
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

                      {conjointMode && idx < 2 ? (
                        <div className="rounded-[6px] border border-purple-200 bg-purple-50 px-2 py-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-purple-700">Auto load share</div>
                            <div className="text-[11px] font-semibold text-purple-900">
                              {idx === 0
                                ? `${conjointMetrics.personASharePct}% · ${conjointMetrics.personACubicFeet} cu ft`
                                : `${conjointMetrics.personBSharePct}% load · ${conjointMetrics.personBCubicFeet} cu ft`}
                            </div>
                          </div>
                          <div className="mt-1 text-[10px] text-purple-700">
                            {idx === 0
                              ? `Calculated from ${jobFactors.personALabel || 'Person A'}'s tagged inventory. No manual percentage needed.`
                              : `Second pickup only loads ${jobFactors.personBLabel || 'Person B'}'s items, then unloads the combined ${conjointMetrics.totalCubicFeet} cu ft at destination.`}
                          </div>
                        </div>
                      ) : (
                        <>
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
                        </>
                      )}

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
                    Conjoint load shares are calculated from tagged inventory. Manual shares are only for custom extra stops, storage splits, or delivery drops.
                  </div>
                </div>
              )}
            </div>

            {/* Branch Selector */}
            <div data-estimate-stage="plan">
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
                      ? 'rounded-full px-4 py-1.5 text-sm font-semibold bg-[#071421] text-white'
                      : 'rounded-full border border-slate-200 bg-white text-slate-500 px-4 py-1.5 text-sm hover:border-[#071421] transition'}
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
            <div data-estimate-stage="lead" className="flex items-center gap-4 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] px-4 py-3">
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
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors ${active ? 'bg-[#071421] text-white' : 'bg-white border border-[var(--app-line)] text-[var(--app-muted)] hover:border-[#071421]'}`}
                      >
                        {labels[t]}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Move Description + Internal Notes */}
            <div data-estimate-stage="lead" className="grid gap-4 sm:grid-cols-2">
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
            <div data-estimate-stage="inventory" id="estimate-inventory" className="scroll-mt-16 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
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
                {textParsedInventoryItems.length > 0 ? (
                  <div className="mt-3 border-l-2 border-[#C99700] bg-white px-3 py-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8a6800]">Inventory parsed from customer text · review required</div>
                    <p className="mt-1 text-xs leading-5 text-[var(--app-muted)]">
                      The system captured {textParsedInventoryItems.length} item{textParsedInventoryItems.length === 1 ? '' : 's'} automatically. Confirm the names, quantities, rooms and dimensions before relying on the estimate.
                    </p>
                    <div className="mt-2 text-xs font-medium text-[#071421]">
                      {textParsedInventoryItems.slice(0, 5).map(item => `${Math.max(1, Number(item.qty || 1))}× ${getInventoryDisplayLabel(item)}`).join(' · ')}
                      {textParsedInventoryItems.length > 5 ? ` · +${textParsedInventoryItems.length - 5} more` : ''}
                    </div>
                  </div>
                ) : null}
                {includedInventory.length > 0 && !customerInventoryConfirmed ? (
                  <button
                    type="button"
                    disabled={inventoryConfirmBusy}
                    onClick={() => {
                      setInventoryConfirmBusy(true)
                      void onConfirmInventory().finally(() => setInventoryConfirmBusy(false))
                    }}
                    className="mt-3 rounded-[6px] bg-[#071421] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
                  >
                    {inventoryConfirmBusy ? 'Saving confirmation…' : 'Customer confirmed this full inventory'}
                  </button>
                ) : null}
                <div className="mt-4 grid gap-3 sm:grid-cols-4">
                  <div className="crm-kpi">
                    <div className="crm-label">Pieces</div>
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
                  {(() => {
                    const mlsBeds = lead.supabaseListing?.beds || lead.supabaseListing?.bedrooms
                    const mlsBaths = lead.supabaseListing?.baths || lead.supabaseListing?.bathrooms
                    if (!mlsBeds && !mlsBaths) return null
                    return (
                      <div className="crm-kpi">
                        <div className="crm-label">Beds / Baths</div>
                        <div className="crm-value">{mlsBeds ?? '—'}bd · {mlsBaths ?? '—'}ba</div>
                        <div className="text-[9px] text-emerald-700 mt-0.5">from MLS</div>
                      </div>
                    )
                  })()}
                </div>
                {conjointMode && (() => {
                  const personAItems = effectiveConjointInventory.filter(i => i.included !== false && i.owner !== 'person_b')
                  const personBItems = effectiveConjointInventory.filter(i => i.included !== false && i.owner === 'person_b')
                  const aCuFt = Math.round(personAItems.reduce((s, i) => s + (i.cubicFeet || 0) * (i.qty || 1), 0))
                  const bCuFt = Math.round(personBItems.reduce((s, i) => s + (i.cubicFeet || 0) * (i.qty || 1), 0))
                  const totalCuFt = aCuFt + bCuFt
                  const TRUCK_CAP = 1600
                  const truckNeeded = totalCuFt > TRUCK_CAP ? 2 : 1
                  const pctA = totalCuFt > 0 ? Math.round((aCuFt / totalCuFt) * 100) : 50
                  const pctB = 100 - pctA
                  return (
                    <div className="mt-3 rounded-[8px] border border-purple-200 bg-purple-50 p-3 space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-purple-700">Conjoint Volume Split</div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
                          {jobFactors.personALabel || 'Person A'} · {aCuFt} cu ft ({pctA}%)
                        </span>
                        <span className="text-[var(--app-muted)]">+</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 font-semibold text-purple-800">
                          {jobFactors.personBLabel || 'Person B'} · {bCuFt} cu ft ({pctB}%)
                        </span>
                        <span className="ml-auto font-semibold text-[var(--app-ink)]">= {totalCuFt} cu ft</span>
                      </div>
                      <div className="h-2 rounded-full bg-blue-200 overflow-hidden">
                        <div className="h-full bg-purple-500 float-right" style={{ width: `${pctB}%` }} />
                      </div>
                      <div className={`rounded-[6px] px-2.5 py-1.5 text-[11px] font-semibold ${truckNeeded === 2 ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'}`}>
                        {truckNeeded === 2
                          ? `Two 26ft trucks needed — combined ${totalCuFt} cu ft exceeds single-truck capacity (${TRUCK_CAP} cu ft)`
                          : `One 26ft truck fits both loads — ${totalCuFt} cu ft of ${TRUCK_CAP} cu ft capacity used (${Math.round(totalCuFt / TRUCK_CAP * 100)}%)`
                        }
                      </div>
                      {personBItems.length === 0 && inventory.length > 0 && (
                        <div className="text-[10px] text-purple-600">Tag inventory items with A or B using the button on each item to see the volume split.</div>
                      )}
                      {(() => {
                        const personALabel = jobFactors.personALabel || 'Person A'
                        const personBLabel = jobFactors.personBLabel || 'Person B'
                        const ownerTabs: Array<{ id: 'person_a' | 'person_b' | 'combined'; label: string; tone: string }> = [
                          { id: 'person_a', label: personALabel, tone: 'blue' },
                          { id: 'person_b', label: personBLabel, tone: 'purple' },
                          { id: 'combined', label: 'Combined', tone: 'slate' },
                        ]
                        const scopedItems = activeConjointOwner === 'combined'
                          ? effectiveConjointInventory.filter(item => item.included !== false)
                          : effectiveConjointInventory.filter(item => item.included !== false && (activeConjointOwner === 'person_b' ? item.owner === 'person_b' : item.owner !== 'person_b'))
                        const scopedCuFt = Math.round(scopedItems.reduce((sum, item) => sum + (item.cubicFeet || 0) * (item.qty || 1), 0))
                        const selectedOwner = activeConjointOwner === 'person_b' ? 'person_b' : 'person_a'
                        const selectedLabel = selectedOwner === 'person_b' ? personBLabel : personALabel
                        const selectedAddress = selectedOwner === 'person_b'
                          ? legs[1]?.originAddress || 'Add Person B pickup address in Leg 2'
                          : legs[0]?.originAddress || originAddress || lead.originAddress || 'Add Person A pickup address in Leg 1'
                        const selectedMedia = mediaAssets.filter(asset => {
                          if (asset.removed || asset.kind !== 'image') return false
                          const label = (asset.partyLabel || '').trim().toLowerCase()
                          const notes = (asset.notes || '').toLowerCase()
                          const target = selectedLabel.toLowerCase()
                          return label === target || notes.includes(`conjoint upload — ${target}`) || notes.includes(`party b`) && selectedOwner === 'person_b'
                        })
                        const selectedReferencePhotos = selectedOwner === 'person_a' ? listingPhotos : []
                        const selectedLocalPhotos = conjointLocalPhotoUrls[selectedOwner] || []
                        const selectedPhotoUrls = [...selectedReferencePhotos.slice(0, 10), ...selectedMedia.map(asset => asset.url), ...selectedLocalPhotos].slice(0, 15)
                        const untaggedCount = effectiveConjointInventory.filter(item => item.included !== false && !item.owner).length
                        const commonPresets = INVENTORY_PRESETS.filter(preset =>
                          ['sofa-standard', 'queen-bed', 'dresser-med', 'desk-standard', 'dining-table-4', 'dining-chair', 'box-medium'].includes(preset.id)
                        )
                        return (
                          <div className="rounded-[8px] border border-purple-200 bg-white p-3">
                            <div className="flex flex-wrap items-center gap-2">
                              {ownerTabs.map(tab => (
                                <button
                                  key={tab.id}
                                  type="button"
                                  onClick={() => setActiveConjointOwner(tab.id)}
                                  className={`rounded-full px-3 py-1 text-[10px] font-semibold transition-colors ${
                                    activeConjointOwner === tab.id
                                      ? tab.tone === 'blue'
                                        ? 'bg-blue-700 text-white'
                                        : tab.tone === 'purple'
                                          ? 'bg-purple-700 text-white'
                                          : 'bg-slate-700 text-white'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  {tab.label}
                                </button>
                              ))}
                              <span className="ml-auto text-[10px] font-semibold text-slate-500">
                                {scopedItems.length} item{scopedItems.length === 1 ? '' : 's'} · {scopedCuFt} cu ft
                              </span>
                            </div>
                            {activeConjointOwner !== 'combined' ? (
                              <div className="mt-3 grid gap-2">
                                <div className="rounded-[6px] border border-slate-200 bg-slate-50 px-2.5 py-2">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Intake for {selectedLabel}</span>
                                    <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600">{selectedAddress}</span>
                                  </div>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => handleConjointMlsScan(selectedOwner, selectedAddress)}
                                      disabled={conjointMlsBusy === selectedOwner}
                                      className="rounded-[6px] bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
                                    >
                                      {conjointMlsBusy === selectedOwner ? '…' : 'MLS / listing'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleConjointSurveyRequest(selectedOwner, selectedAddress)}
                                      disabled={conjointSurveyBusy === selectedOwner}
                                      className="rounded-[6px] bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
                                    >
                                      {conjointSurveyBusy === selectedOwner ? '…' : 'Customer photos'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        conjointUploadOwnerRef.current = selectedOwner
                                        setConjointUploadOwner(selectedOwner)
                                        conjointUploadInputRef.current?.click()
                                      }}
                                      disabled={conjointUploadBusy}
                                      className="rounded-[6px] bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200 disabled:opacity-60"
                                    >
                                      {conjointUploadBusy && conjointUploadOwner === selectedOwner ? 'Uploading…' : 'Rep upload'}
                                    </button>
                                    <input
                                      ref={conjointUploadInputRef}
                                      type="file"
                                      accept="image/*,video/*"
                                      multiple
                                      className="hidden"
                                      onChange={e => {
                                        const files = Array.from(e.target.files || [])
                                        const owner = conjointUploadOwnerRef.current || conjointUploadOwner
                                        if (files.length && owner) void handleConjointRepUpload(owner, files)
                                        if (files.length && !owner) setConjointUploadNotice('Choose Sam or Sam’s Girlfriend first, then upload again.')
                                        e.target.value = ''
                                      }}
                                    />
                                  </div>
                                  {(conjointMlsNotice || conjointSurveyNotice || conjointUploadNotice) && (
                                    <div className="mt-1.5 rounded-[6px] border border-slate-200 bg-white px-2.5 py-2 text-[10px] text-slate-600">
                                      {conjointMlsNotice || conjointSurveyNotice || conjointUploadNotice}
                                    </div>
                                  )}
                                </div>
                                <div className="rounded-[6px] border border-slate-200 bg-white px-2.5 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Photos for {selectedLabel}</div>
                                    <div className="text-[10px] text-slate-500">{selectedPhotoUrls.length} photo{selectedPhotoUrls.length === 1 ? '' : 's'}</div>
                                  </div>
                                  {selectedPhotoUrls.length > 0 ? (
                                    <div className="mt-2 grid grid-cols-5 gap-1.5">
                                      {selectedPhotoUrls.map((photo, index) => (
                                        <button
                                          key={`${selectedOwner}-photo-${photo}-${index}`}
                                          type="button"
                                          onClick={() => setLightbox({ photos: selectedPhotoUrls, index })}
                                          className="overflow-hidden rounded-[6px] border border-slate-200 bg-slate-50"
                                        >
                                          <img src={photo} alt={`${selectedLabel} photo ${index + 1}`} className="h-14 w-full object-cover" />
                                        </button>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-2 rounded-[6px] border border-dashed border-slate-200 bg-slate-50 px-2.5 py-3 text-[10px] text-slate-500">
                                      No photos tied to {selectedLabel} yet. Use Customer photos or Rep upload on this tab.
                                    </div>
                                  )}
                                  {selectedOwner === 'person_a' && selectedReferencePhotos.length > 0 ? (
                                    <div className="mt-1.5 text-[10px] text-blue-700">MLS listing photos are treated as {selectedLabel}'s pickup reference.</div>
                                  ) : null}
                                </div>
                                <div className="rounded-[6px] border border-blue-100 bg-blue-50 px-2.5 py-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-[10px] font-semibold uppercase tracking-wide text-blue-700">Inventory for {selectedLabel}</div>
                                    <div className="text-[10px] font-semibold text-blue-700">{scopedItems.length} item{scopedItems.length === 1 ? '' : 's'} · {scopedCuFt} cu ft</div>
                                  </div>
                                  <div className="mt-1.5 text-[10px] leading-4 text-blue-800">
                                    Add quick items here, then use the source-of-truth inventory list below to remove items, move rooms, mark stays-behind, or switch owners.
                                  </div>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                                  <input
                                    value={conjointCustomItem}
                                    onChange={event => setConjointCustomItem(event.target.value)}
                                    className="crm-input h-9 py-1 text-xs"
                                    placeholder={`Add custom item for ${selectedLabel}`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => addConjointCustomItem(selectedOwner)}
                                    className="rounded-[6px] bg-[#071421] px-3 py-1.5 text-[10px] font-semibold text-white"
                                  >
                                    Add item
                                  </button>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {commonPresets.map(preset => (
                                    <button
                                      key={preset.id}
                                      type="button"
                                      onClick={() => addConjointPresetItem(preset.id, selectedOwner)}
                                      className="rounded-[6px] border border-[var(--app-line)] bg-white px-2 py-1 text-[10px] font-semibold text-[var(--app-muted)] hover:text-[var(--app-ink)]"
                                    >
                                      + {preset.label}
                                    </button>
                                  ))}
                                </div>
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() => assignUntaggedConjointItems(selectedOwner)}
                                    disabled={untaggedCount === 0}
                                    className="rounded-[6px] bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-700 disabled:opacity-40"
                                  >
                                    Assign {untaggedCount} untagged to {selectedLabel}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => appendConjointScopeNote(selectedOwner, 'customer photos / MLS scan still need review before final quote')}
                                    className="rounded-[6px] bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800"
                                  >
                                    Mark photos needed
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => appendConjointScopeNote(selectedOwner, 'possible add-on scope: junk removal / donation / extra disposal')}
                                    className="rounded-[6px] bg-rose-50 px-2.5 py-1 text-[10px] font-semibold text-rose-700"
                                  >
                                    Add junk scope note
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => appendConjointScopeNote(selectedOwner, 'packing / wrapping scope needs custom confirmation')}
                                    className="rounded-[6px] bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800"
                                  >
                                    Add packing note
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="mt-3 grid gap-2 text-[10px] text-slate-600 sm:grid-cols-2">
                                <div className="rounded-[6px] border border-slate-200 bg-slate-50 px-2.5 py-2">
                                  Use one combined quote when both pickups are part of one move day and one destination.
                                </div>
                                <div className="rounded-[6px] border border-slate-200 bg-slate-50 px-2.5 py-2">
                                  Use “another job” only for a separate move, commercial job, standalone junk run, or different booking date.
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
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
                          <div className="text-xs text-[var(--app-muted)]">{items.length} inventory lines · {roomCuFt} cu ft</div>
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
                                {conjointMode && (
                                  <button
                                    type="button"
                                    onClick={() => onUpdateInventoryItem(el.index, 'owner', el.item.owner === 'person_b' ? 'person_a' : 'person_b')}
                                    className={`rounded-[6px] px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                                      el.item.owner === 'person_b'
                                        ? 'bg-purple-100 text-purple-800'
                                        : 'bg-blue-100 text-blue-800'
                                    }`}
                                    title="Toggle which person this item belongs to"
                                  >
                                    {el.item.owner === 'person_b'
                                      ? (jobFactors.personBLabel ? jobFactors.personBLabel[0].toUpperCase() : 'B')
                                      : (jobFactors.personALabel ? jobFactors.personALabel[0].toUpperCase() : 'A')}
                                    {' '}— {el.item.owner === 'person_b' ? (jobFactors.personBLabel || 'Person B') : (jobFactors.personALabel || 'Person A')}
                                  </button>
                                )}
                                {el.item.status === 'needs_confirmation' ? (
                                  <button
                                    type="button"
                                    onClick={() => onUpdateInventoryItem(el.index, 'status', 'confirmed')}
                                    className="rounded-[6px] bg-[#071421] px-2.5 py-1 text-[10px] font-semibold text-white"
                                  >
                                    Confirm parsed item
                                  </button>
                                ) : null}
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
                            onChange={e => setQuickQty(e.target.value)}
                            onBlur={() => setQuickQty(String(Math.max(1, Number(quickQty) || 1)))}
                            className="crm-input w-14 py-1 text-right text-xs"
                            placeholder="Qty"
                          />
                        </div>
                        <div className="grid grid-cols-[1fr_80px_auto] gap-2">
                          <input
                            value={quickItem}
                            onChange={e => { setQuickItem(e.target.value); setQuickLookupNote(null) }}
                            onBlur={e => void lookupItemDimensions(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && addQuickItem()}
                            className="crm-input py-1 text-xs"
                            placeholder="Item name (e.g. Pet Étagère)"
                          />
                          <input
                            type="number"
                            min={0}
                            value={quickCuFt}
                            onChange={e => setQuickCuFt(e.target.value)}
                            className="crm-input py-1 text-right text-xs"
                            placeholder={quickLookupLoading ? '…' : 'cu ft'}
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
                        {quickLookupNote ? (
                          <p className="text-[10px] text-emerald-700">✓ {quickLookupNote}</p>
                        ) : (
                          <p className="text-[10px] text-[var(--app-muted)]">{quickLookupLoading ? '🔍 Looking up dimensions…' : 'Type any item — AI will estimate cu ft if not in our library.'}</p>
                        )}
                      </div>
                    </div>

                    {/* ✨ Paste inventory list — AI bulk import */}
                    <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">✨ Paste Inventory List</div>
                        {pastePreview && (
                          <button type="button" onClick={() => { setPastePreview(null); setPasteText(''); setPasteError(null) }}
                            className="text-[10px] text-[var(--app-muted)] hover:text-[var(--app-ink)]">Clear</button>
                        )}
                      </div>
                      {!pastePreview ? (
                        <>
                          <textarea
                            value={pasteText}
                            onChange={e => { setPasteText(e.target.value); setPasteError(null) }}
                            placeholder={'Paste a customer message, transcript, or list — e.g. "King bed, 2 nightstands, dresser, 65\" TV, sectional, dining table with 6 chairs, 20 boxes"'}
                            rows={3}
                            className="crm-input resize-none text-xs"
                          />
                          {pasteError && <p className="text-[10px] text-rose-600">{pasteError}</p>}
                          <button type="button" onClick={() => void parseInventoryFromText()}
                            disabled={pasteLoading || !pasteText.trim()}
                            className="crm-button-dark w-full text-xs disabled:opacity-50">
                            {pasteLoading ? '✨ Analyzing…' : '✨ Parse & Pre-fill Inventory'}
                          </button>
                          <p className="text-[10px] text-[var(--app-muted)]">AI matches items to our library, estimates cu ft for unknowns, pre-fills everything automatically.</p>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <div className="max-h-44 overflow-y-auto space-y-1 rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] p-2">
                            {pastePreview.map((item, i) => (
                              <div key={i} className="flex items-center justify-between text-[11px]">
                                <span className="font-medium text-[var(--app-ink)]">
                                  {(item.qty ?? 1) > 1 ? `${item.qty}× ` : ''}{item.name}
                                  {item.room && item.room !== 'Unassigned' && (
                                    <span className="ml-1 font-normal text-[var(--app-muted)]">· {item.room}</span>
                                  )}
                                </span>
                                <span className={`text-[10px] font-semibold ${(item.cubicFeet ?? 0) === 0 ? 'text-amber-600' : 'text-emerald-700'}`}>
                                  {(item.cubicFeet ?? 0) > 0 ? `${item.cubicFeet} cu ft` : 'Needs size/photo'}
                                  {(item as InventoryItem & { _source?: string })._source === 'preset' ? ' ✓' : (item as InventoryItem & { _source?: string })._source === 'ai_lookup' ? ' ~AI' : ''}
                                </span>
                              </div>
                            ))}
                          </div>
                          <p className="text-[10px] text-[var(--app-muted)]">
                            {pastePreview.filter(i => (i as InventoryItem & { _source?: string })._source === 'preset').length} from library ·{' '}
                            {pastePreview.filter(i => (i as InventoryItem & { _source?: string })._source === 'ai_lookup').length} AI estimated
                            {pastePreview.filter(i => i.cubicFeet === 0).length > 0 && ` · ${pastePreview.filter(i => i.cubicFeet === 0).length} need verification`}
                          </p>
                          <button type="button" onClick={addAllParsed}
                            className="crm-button-dark w-full text-xs">
                            Add All {pastePreview.length} Items to Inventory →
                          </button>
                        </div>
                      )}
                    </div>
                </div>
              </div>

              <div className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
                <div className="crm-label">{conjointMode ? `${jobFactors.personALabel || 'Primary pickup'} MLS Listing Photos` : 'Listing Photos'}</div>
                {conjointMode ? (
                  <div className="mt-1 text-[10px] text-[var(--app-muted)]">These listing photos are tied to the primary pickup. Use each party tab for separate uploaded photos and inventory.</div>
                ) : null}
                {listingPhotos.length > 0 ? (
                  <>
                    <button type="button" onClick={() => setLightbox({ photos: listingPhotos, index: activePhotoIndex })}
                      className="mt-3 w-full overflow-hidden rounded-[8px] border border-[var(--app-line)] cursor-zoom-in"
                    >
                      <img src={listingPhotos[activePhotoIndex]} alt="MLS reference" className="h-40 w-full object-cover" />
                    </button>
                    <div className="mt-3 grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                      {listingPhotos.map((photo, index) => (
                        <button key={`${photo}-${index}`}
                          onClick={() => { onSetActivePhotoIndex(index); setLightbox({ photos: listingPhotos, index }) }}
                          className={`overflow-hidden rounded-[6px] border cursor-zoom-in ${activePhotoIndex === index ? 'border-[var(--app-ink)]' : 'border-[var(--app-line)]'}`}
                        >
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
              {!conjointMode && (customerPhotos?.length ?? 0) > 0 && (
                <div className="rounded-[8px] border border-emerald-200 bg-emerald-50 p-4">
                  <div className="crm-label text-emerald-800">Customer Photos <span className="ml-1 font-normal normal-case text-emerald-600">({customerPhotos!.length})</span></div>
                  <div className="mt-2 text-[10px] text-emerald-700">Photos uploaded by the customer — use these to verify the AI inventory is correct.</div>
                  <div className="mt-3 grid grid-cols-4 gap-1.5 max-h-64 overflow-y-auto pr-0.5">
                    {customerPhotos!.map((photo, index) => (
                      <button
                        key={`customer-${index}`}
                        type="button"
                        onClick={() => setLightbox({ photos: customerPhotos!, index })}
                        className="overflow-hidden rounded-[6px] border border-emerald-200 hover:border-emerald-400 transition-colors cursor-zoom-in"
                      >
                        <img src={photo} alt={`Customer photo ${index + 1}`} className="h-14 w-full object-cover" />
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 text-[10px] text-emerald-600">Click any photo to enlarge — use arrow keys to browse.</div>
                </div>
              )}
            </div>

            {/* ── JOB FACTORS ── */}
            <div data-estimate-stage="handling" id="estimate-operations" className="scroll-mt-16 rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-4">
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

              {/* Multi-option quote builder — shows all viable options, click to configure */}
              {(needsTwoTrucks || flags?.twoTripZone) && flags?.twoTripComparison && (
                <div className="mb-3 rounded-[8px] border border-sky-200 bg-sky-50 px-4 py-3">
                  <div className="text-sm font-semibold text-sky-800">
                    🚚 {needsTwoTrucks ? 'Volume needs 2 trucks — pick an option to quote' : '2-trip zone — 3 options available'}
                  </div>
                  <p className="mt-0.5 text-[10px] text-sky-700">Click any option to set the quote configuration automatically.</p>
                  <div className="mt-2 grid grid-cols-3 gap-2">

                    {/* Option A — 2 trucks, 4 movers */}
                    <button
                      type="button"
                      onClick={() => {
                        setFactors({ ...jobFactors, truckCountOverride: 2, crewSizeOverride: 4 })
                      }}
                      className="rounded-[6px] border-2 border-sky-300 bg-white p-2.5 text-left hover:border-sky-500 transition"
                    >
                      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-sky-700">Option A — 2 Trucks</div>
                      <div className="mt-0.5 text-base font-bold text-[var(--app-ink)]">{formatMoney(flags.multiTruckOption?.totalAmount ?? quoteModalTotals.subtotal)}</div>
                      <div className="mt-0.5 text-[10px] text-sky-700">
                        4 movers · {flags.multiTruckOption?.totalHours ?? pricingBreakdown?.totalHours}h
                      </div>
                      <div className="mt-1 text-[9px] text-slate-400">{flags.twoTripComparison.twoTruckSpecification} · both load in parallel — fastest</div>
                    </button>

                    {/* Option B — 1 truck, 3 movers, 2 trips (RECOMMENDED for local) */}
                    <button
                      type="button"
                      onClick={() => {
                        setFactors({ ...jobFactors, truckCountOverride: 1, crewSizeOverride: 3 })
                        if (!conditionalClauseEnabled) {
                          setConditionalClauseEnabled(true)
                          const savings = flags.twoTripComparison!.oneTripSavingsVsTwoTrip
                          setConditionalClauseText(
                            `This quote is based on 1 truck, 3 movers, 2 trips. If all items fit in a single trip, your total adjusts to approximately ${formatMoney(flags.twoTripComparison!.oneTripAmount)} — saving you ${formatMoney(savings > 0 ? savings : 0)}. You will only be charged for trips actually made.`
                          )
                        }
                      }}
                      className="rounded-[6px] border-2 border-emerald-300 bg-white p-2.5 text-left hover:border-emerald-500 transition"
                    >
                      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700">Option B ★ Recommended</div>
                      <div className="mt-0.5 text-base font-bold text-[var(--app-ink)]">{formatMoney(flags.twoTripComparison.totalAmount)}</div>
                      <div className="mt-0.5 text-[10px] text-emerald-700">
                        3 movers · {flags.twoTripComparison.totalHours}h · {flags.twoTripComparison.oneTruckSpecification}, 2 trips
                      </div>
                      <div className="mt-1 text-[9px] text-slate-400">
                        {flags.twoTripComparison.savings > 0
                          ? `Saves client ${formatMoney(flags.twoTripComparison.savings)} vs 2 trucks`
                          : 'More time but lower hourly rate'}
                        {' · auto-fills conditional clause'}
                      </div>
                    </button>

                    {/* Option C — 1 truck, 3 movers, 1 trip (optimistic) */}
                    <button
                      type="button"
                      onClick={() => {
                        setFactors({ ...jobFactors, truckCountOverride: 1, crewSizeOverride: 3 })
                        if (!conditionalClauseEnabled) {
                          setConditionalClauseEnabled(true)
                          setConditionalClauseText(
                            `This quote assumes all items fit in a single trip with 1 truck (26ft). If a second trip is required, the additional charge will be approximately ${formatMoney(flags.twoTripComparison!.totalAmount - flags.twoTripComparison!.oneTripAmount)} — based on our hourly rate for the extra drive and load time. This will be confirmed on-site before proceeding.`
                          )
                        }
                      }}
                      className="rounded-[6px] border border-slate-200 bg-white p-2.5 text-left hover:border-slate-400 transition"
                    >
                      <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500">Option C — 1 Trip</div>
                      <div className="mt-0.5 text-base font-bold text-[var(--app-ink)]">{formatMoney(flags.twoTripComparison.oneTripAmount)}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        3 movers · {flags.twoTripComparison.oneTripHours}h · {flags.twoTripComparison.oneTruckSpecification}, 1 trip
                      </div>
                      <div className="mt-1 text-[9px] text-slate-400">Optimistic — conditional clause added if 2nd trip needed</div>
                    </button>

                  </div>
                  <div className="mt-1 text-[10px] text-sky-700">Load basis: {flags.twoTripComparison.inventoryBasis}. Confirm the included inventory before sending.</div>
                  <div className="mt-1.5 text-[10px] text-sky-700">
                    {needsTwoTrucks
                      ? 'Volume exceeds 1 truck safe-load limit. Option B is recommended for local moves — 2nd trip is often cheaper than 2 trucks.'
                      : 'Local move: all 3 options are viable. Option B is the balanced pick.'}
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
                  <div className="mt-2 flex flex-wrap gap-2">
                    {specialtyServiceRecommendations.map(item => {
                      const description = `${item.label} — Specialty Handling`
                      const added = quoteLineItems.some(line => line.description === description)
                      return <button
                        key={item.key}
                        type="button"
                        disabled={added}
                        onClick={() => addSpecialtyService(item)}
                        title={`Internal planning allowance ${formatMoney(item.internalAllowance)} · 20% specialty markup`}
                        className="rounded-[6px] border border-sky-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-sky-900 disabled:opacity-50"
                      >
                        {added ? '✓ Added' : '+ Add allowance'} · {item.label} {formatMoney(item.sellingAllocation)}
                      </button>
                    })}
                  </div>
                  <div className="mt-2 text-[10px] text-sky-700">These are planning allowances, not ordinary move labour. Replace with the confirmed subcontractor/equipment price before a binding quote.</div>
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

                <div className={`space-y-2 rounded-[8px] border px-4 py-3 lg:col-span-1 ${
                  accessAssessment.status === 'clear'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : accessAssessment.status === 'high_risk'
                      ? 'border-rose-200 bg-rose-50 text-rose-800'
                      : 'border-amber-200 bg-amber-50 text-amber-800'
                }`}>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em]">Access Intelligence</div>
                  <div className="text-sm font-semibold">
                    {accessAssessment.label}{accessAssessment.extraMinutes > 0 ? ` · +${accessAssessment.extraMinutes} min` : ''}
                  </div>
                  <div className="text-xs leading-relaxed">{accessAssessment.summary}</div>
                </div>

                <details open={estimateView === 'guided' ? true : undefined} className="space-y-3 rounded-[8px] border-2 border-[#C99700]/50 bg-amber-50 p-4 lg:col-span-3">
                  <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3">
                    <div><div className="text-xs font-bold uppercase tracking-[0.14em] text-amber-900">Hidden Inventory Check</div><p className="mt-1 text-xs text-amber-800">Every area needs its own factual answer. Silence and a general inventory confirmation do not count.</p></div>
                    <div className={`rounded-full px-3 py-1 text-xs font-bold ${blockingReadiness.length === 0 ? 'bg-emerald-600 text-white' : 'bg-white text-amber-900'}`}>{blockingReadiness.length === 0 ? 'QUOTE READY' : `${quoteReadyAssessment.inventoryConfidence}% inventory confidence`}</div>
                  </summary>
                  <div className="mt-3 grid gap-3 lg:grid-cols-2">
                    {HIDDEN_INVENTORY_AREAS.map(area => {
                      const value = jobFactors.hiddenInventoryCoverage?.[area.key]
                      return <div key={area.key} className="rounded-[8px] border border-amber-200 bg-white p-3">
                        <div className="text-xs font-bold text-[var(--app-ink)]">{area.label}</div>
                        <p className="mt-1 text-[10px] leading-4 text-[var(--app-muted)]">{area.prompt}</p>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                          {([
                            ['customer_confirmed_empty', '✓ Customer says empty'],
                            ['not_applicable', '✓ No such area'],
                            ['customer_confirmed', 'Items confirmed'],
                            ['observed', 'Seen in evidence'],
                            ['estimated', 'Estimated range'],
                            ['unknown', 'Still unverified'],
                          ] as Array<[MoveEvidenceState, string]>).map(([state, label]) => (
                            <button
                              key={state}
                              type="button"
                              onClick={() => setHiddenCoverage(area.key, state)}
                              className={`rounded-[6px] border px-2 py-1.5 text-left text-[10px] font-semibold ${value?.state === state
                                ? state === 'unknown' ? 'border-amber-500 bg-amber-100 text-amber-950' : 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-[var(--app-line)] bg-white text-[var(--app-muted)] hover:border-[var(--app-ink)]'}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <input value={value?.note || ''} onChange={event => onJobFactorsChange({ ...jobFactors, hiddenInventoryCoverage: { ...(jobFactors.hiddenInventoryCoverage || {}), [area.key]: { ...value, state: value?.state || 'unknown', note: event.target.value, updatedAt: new Date().toISOString(), updatedBy: currentUser?.name || 'Sales' } } })} placeholder="What is there, why empty, or estimate basis" className="crm-input mt-2 w-full py-1.5 text-xs"/>
                        {value?.state === 'estimated' && area.key !== 'boxes' ? <input type="number" min="0" value={value.estimatedCubicFeet ?? ''} onChange={event => onJobFactorsChange({ ...jobFactors, hiddenInventoryCoverage: { ...(jobFactors.hiddenInventoryCoverage || {}), [area.key]: { ...value, estimatedCubicFeet: event.target.value ? Number(event.target.value) : undefined } } })} placeholder="Estimated cubic feet" className="crm-input mt-2 w-full py-1.5 text-xs"/> : null}
                      </div>
                    })}
                  </div>
                  {blockingReadiness.length > 0 && <div className="rounded-[6px] border border-amber-300 bg-white px-3 py-2 text-xs text-amber-900"><strong>Fixed price remains locked:</strong> {blockingReadiness.slice(0, 4).map(item => item.detail).join(' · ')}{blockingReadiness.length > 4 ? ` · +${blockingReadiness.length - 4} more` : ''}</div>}
                </details>

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
                    const count = suggestTruckCount(cf, effectiveInventoryMetrics.totalWeightLbs, route?.category === 'long-distance' || quoteType === 'long_distance' ? 'long-distance' : lead.moveType)
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
                  {(pricingBreakdown?.moveIntelligence?.fixedPriceReadiness === 'manual_review' || jobFactors.moveIntelligenceApprovedAt) && (
                    <div className="rounded-[6px] border border-amber-200 bg-amber-50 p-3">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(jobFactors.moveIntelligenceApprovedAt)}
                          onChange={event => setFactors({
                            ...jobFactors,
                            moveIntelligenceApprovedAt: event.target.checked ? new Date().toISOString() : undefined,
                            moveIntelligenceApprovalReason: event.target.checked ? (jobFactors.specialtyNotes || 'Operational handling and path review completed.') : undefined,
                          })}
                          className="mt-0.5 h-3.5 w-3.5 rounded"
                        />
                        <span className="text-[10px] leading-4 text-amber-800">Operations reviewed the specialty handling plan and approves fixed-price treatment. Unresolved access questions still need answers.</span>
                      </label>
                    </div>
                  )}
                </div>
                  )
                })()}
              </div>
            </div>

            {/* Line Items — grouped by service */}
            <div data-estimate-stage="plan" id="estimate-price" className="scroll-mt-16">
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
                      cleaningLineDescription,
                      containerHandlingLineDescription,
                    ])
                    const movingItems = quoteLineItems
                      .map((item, index) => ({ item, index }))
                      .filter(({ item }) => !serviceDescriptions.has(item.description) && !isProtectionLine(item.description))
                    if (movingItems.length === 0) return null
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-[#071421]" />
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
                      .filter(({ item }) => isProtectionLine(item.description))
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

                  {/* ── Cleaning / container handling items ── */}
                  {(cleaningAdded || containerHandlingAdded) && (() => {
                    const additionalItems = quoteLineItems
                      .map((item, index) => ({ item, index }))
                      .filter(({ item }) => item.description === cleaningLineDescription || item.description === containerHandlingLineDescription)
                    return (
                      <div>
                        <div className="mb-2 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                          <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">Additional Services</span>
                        </div>
                        <div className="space-y-2">
                          {additionalItems.map(({ item, index }) => (
                            <div key={`${item.description}-${index}`} className="grid gap-2 rounded-[8px] border border-sky-200 bg-sky-50 p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_130px_36px]">
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

            <div data-estimate-stage="review" className="space-y-4">
              <div className="rounded-[12px] border border-[var(--app-line)] bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <div className="crm-label">Customer scope review</div>
                    <h3 className="mt-1 text-xl font-semibold text-[var(--app-ink)]">Review exactly what the customer will receive.</h3>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--app-muted)]">The customer view is built from the same addresses, inventory, access, handling, and move plan captured in these stages.</p>
                  </div>
                  <div className={`rounded-full px-3 py-1.5 text-xs font-bold ${blockingReadiness.length ? 'bg-amber-100 text-amber-900' : 'bg-emerald-600 text-white'}`}>
                    {blockingReadiness.length ? `${blockingReadiness.length} confirmation${blockingReadiness.length === 1 ? '' : 's'} left` : 'READY TO PREVIEW'}
                  </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {workflowStages.filter(stage => stage.id !== 'review').map(stage => (
                    <button key={stage.id} type="button" onClick={() => goToStage(stage.id)} className="rounded-[8px] border border-[var(--app-line)] bg-[var(--app-bg)] p-3 text-left hover:border-[var(--app-ink)]">
                      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-[var(--app-ink)]"><span>{stage.label}</span><span>{stage.status === 'complete' ? '✓' : stage.issueCount}</span></div>
                      <div className="mt-1 text-[10px] leading-4 text-[var(--app-muted)]">{stage.description}</div>
                    </button>
                  ))}
                </div>
                {blockingReadiness.length > 0 ? (
                  <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3">
                    <div className="text-xs font-semibold text-amber-950">Still needs confirmation</div>
                    <div className="mt-2 grid gap-1 text-xs text-amber-900 sm:grid-cols-2">{blockingReadiness.map(item => <div key={`${item.label}-${item.detail}`}>• {item.label}</div>)}</div>
                  </div>
                ) : null}
                {sendGuardOpen && (blockingReadiness.length > 0 || warningReadiness.length > 0) ? (
                  <div className="mt-4 rounded-[8px] border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                    <div className="font-semibold">This is not a final confirmed scope yet.</div>
                    <p className="mt-1 leading-5">Return to the highlighted stages, or deliberately preview it as provisional so the customer sees what still needs confirmation.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => {
                        setSendGuardOpen(false)
                        const firstIncomplete = workflowStages.find(stage => stage.id !== 'review' && stage.status !== 'complete')
                        if (firstIncomplete) goToStage(firstIncomplete.id)
                      }} className="rounded-[6px] border border-amber-300 bg-white px-3 py-1.5 font-semibold">Complete scope</button>
                      <button type="button" onClick={() => void handleProvisionalSend()} disabled={quoteModalBusy || !quote} className="rounded-[6px] bg-[#071421] px-3 py-1.5 font-semibold text-white disabled:opacity-50">Preview provisional quote</button>
                    </div>
                  </div>
                ) : null}
                <div className="mt-5 rounded-[10px] bg-[#071421] p-4 text-white">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-white/60">Customer total</div>
                  <div className="mt-1 text-3xl font-bold">{formatMoney(quoteModalTotals.total)}</div>
                  <div className="mt-1 text-xs text-white/65">Flat-price scope preview · deposit {formatMoney(quoteModalTotals.deposit)}</div>
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <button type="button" onClick={() => void handlePreviewSend()} disabled={quoteModalBusy || routeBusy || !quote} className="flex-1 rounded-[8px] bg-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{estimateView === 'simple' && (blockingReadiness.length > 0 || warningReadiness.length > 0) ? 'Preview provisional estimate →' : 'Preview customer view →'}</button>
                    <button type="button" onClick={() => void onSaveDraft({ quoteType, customerScope: captureCustomerScope() })} disabled={quoteModalBusy || !quote} className="rounded-[8px] border border-white/25 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">Save draft</button>
                  </div>
                </div>
              </div>
            </div>

            {estimateView === 'guided' ? <div className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-[var(--app-line)] bg-white/95 px-1 py-3 backdrop-blur">
              <button type="button" disabled={activeStageIndex === 0} onClick={() => goToStage(nextEstimateWorkflowStage(workflowStages, activeStage, -1))} className="rounded-[8px] border border-[var(--app-line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--app-ink)] disabled:opacity-30">← Back</button>
              <div className="hidden text-center text-[10px] text-[var(--app-muted)] sm:block">Changes stay in the same draft. Moving between stages does not duplicate or resend anything.</div>
              {activeStageIndex < workflowStages.length - 1 ? (
                <button type="button" onClick={() => goToStage(nextEstimateWorkflowStage(workflowStages, activeStage, 1))} className="rounded-[8px] bg-[#071421] px-4 py-2 text-sm font-semibold text-white">Next: {workflowStages[activeStageIndex + 1]?.label} →</button>
              ) : (
                <span className="text-xs font-semibold text-[var(--app-muted)]">Final review</span>
              )}
            </div> : null}
          </div>

          {/* Sidebar */}
          <aside data-estimate-stage="plan" className="border-t border-[var(--app-line)] bg-[var(--app-bg)] p-4 md:p-6 xl:border-l xl:border-t-0 space-y-6">

            {routeBusy && <div className="rounded-[8px] border border-[var(--app-line)] bg-white px-3 py-4">
              <div className="crm-label">Contribution Pricing</div>
              <div className="mt-2 text-xs text-[var(--app-muted)]">Calculating the confirmed route before updating fulfillment costs and price…</div>
            </div>}
            {!routeBusy && contributionPlan.fixedFulfillmentCost > 0 && <details className="rounded-[8px] border border-[var(--app-line)] bg-white" open>
              <summary className="cursor-pointer list-none px-3 py-3">
                <div className="crm-label">Contribution Pricing</div>
                <div className="mt-1 text-xs text-[var(--app-muted)]">Build the one customer price backwards from complete fulfillment economics.</div>
              </summary>
              <div className="border-t border-[var(--app-line)] px-3 py-3 text-xs">
                <div className="space-y-3">
                  {([
                    { key: 'core_move', label: '1 · Core move fulfillment' },
                    { key: 'evidence_required', label: '2 · Required by inventory / route' },
                    { key: 'customer_selected', label: '3 · Customer-selected services' },
                  ] as const).map(group => {
                    const groupCosts = contributionPlan.costs.filter(cost => cost.key !== 'contingency' && cost.classification === group.key)
                    if (groupCosts.length === 0) return null
                    return <div key={group.key}>
                      <div className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--app-muted)]">{group.label}</div>
                      <div className="space-y-1.5">
                        {groupCosts.map(cost => <div key={cost.key} className="flex items-start justify-between gap-3">
                          <span className="text-[var(--app-muted)]">{cost.label}{cost.sellingAllocation ? <span className="block text-[9px]">selling allocation {formatMoney(cost.sellingAllocation)} · add-on contribution {formatMoney(cost.sellingAllocation - cost.amount)}</span> : null}</span>
                          <span className="font-semibold">{formatMoney(cost.amount)}</span>
                        </div>)}
                      </div>
                    </div>
                  })}
                  {contributionPlan.pricingGaps.length > 0 ? <div className="rounded border border-rose-200 bg-rose-50 p-2 text-rose-800">
                    <div className="font-semibold">Specialty pricing required</div>
                    {contributionPlan.pricingGaps.map(gap => <div key={gap.key} className="mt-1"><strong>{gap.label}:</strong> {gap.reason}</div>)}
                  </div> : null}
                  <details className="rounded border border-[var(--app-line)] bg-slate-50">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-2 py-2"><span className="font-semibold text-[var(--app-ink)]">Live-job contingency &amp; payment cost <span className="ml-1 text-[10px] text-[var(--app-muted)]">▾</span></span><span className="font-semibold">{formatMoney(contributionPlan.executionContingencyTotal)}</span></summary>
                    <div className="space-y-1.5 border-t border-[var(--app-line)] px-2 py-2">
                      <div className="flex justify-between gap-3"><span className="text-[var(--app-muted)]">Operational contingency ({Math.round(contributionPlan.operationalContingencyRate * 100)}%)</span><span>{formatMoney(contributionPlan.costs.find(cost => cost.key === 'contingency')?.amount || 0)}</span></div>
                      {contributionPlan.reserves.map(reserve => <div key={reserve.key} className="flex justify-between gap-3"><span className="text-[var(--app-muted)]">{reserve.label} ({Math.round(reserve.rate * 100)}%)</span><span>{formatMoney(reserve.amount)}</span></div>)}
                      <div className="pt-1 text-[9px] leading-4 text-[var(--app-muted)]">Only costs attributable to this live job appear here. Marketing, commission, claims overhead and coordination are absorbed by the margin target—not deducted twice.</div>
                    </div>
                  </details>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <div className="rounded bg-slate-50 p-2"><div className="text-[9px] uppercase text-[var(--app-muted)]">Recommended</div><div className="text-base font-bold">{formatMoney(contributionPlan.recommendedPrice)}</div></div>
                  <div className="rounded bg-amber-50 p-2"><div className="text-[9px] uppercase text-amber-700">Authorized floor</div><div className="text-base font-bold text-amber-900">{formatMoney(contributionPlan.minimumAuthorizedPrice)}</div></div>
                </div>
                <div className="mt-2 rounded bg-slate-50 p-2">Current expected contribution: <strong>{formatMoney(contributionPlan.expectedContribution)} ({contributionPlan.contributionMarginPct}%)</strong></div>
                {quoteModalTotals.subtotal < contributionPlan.minimumAuthorizedPrice && <div className="mt-2 rounded bg-rose-50 p-2 font-semibold text-rose-800">Current price is below the authorized contribution floor.</div>}
                {quoteModalTotals.subtotal !== contributionPlan.recommendedPrice && <button type="button" onClick={() => {
                  const next = [...quoteLineItems]
                  const otherRevenue = next.slice(1).reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0)), 0)
                  if (next[0]) next[0] = { ...next[0], amount: Math.max(0, contributionPlan.recommendedPrice - otherRevenue) }
                  onSetLineItems(next)
                }} className="crm-button-dark mt-3 w-full justify-center text-xs">Apply recommended bundled price</button>}
              </div>
            </details>}

            <details className="rounded-[8px] border border-[var(--app-line)] bg-white" open={serviceProfitabilityPlan.status !== 'healthy'}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3">
                <div>
                  <div className="crm-label">Service & Margin Check</div>
                  <div className="mt-1 text-xs text-[var(--app-muted)]">
                    {serviceProfitabilityPlan.packages.length} service{serviceProfitabilityPlan.packages.length === 1 ? '' : 's'} · {serviceProfitabilityPlan.grossMarginPct}% projected margin
                  </div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ${
                  serviceProfitabilityPlan.status === 'healthy'
                    ? 'bg-emerald-100 text-emerald-800'
                    : serviceProfitabilityPlan.status === 'watch'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-rose-100 text-rose-800'
                }`}>
                  {serviceProfitabilityPlan.status}
                </span>
              </summary>
              <div className="border-t border-[var(--app-line)] px-3 py-3 text-xs">
                <div className="space-y-2">
                  {serviceProfitabilityPlan.packages.map(item => (
                    <div key={item.id} className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--app-ink)]">{item.label}</div>
                        <div className="text-[10px] uppercase tracking-wide text-[var(--app-muted)]">
                          {item.category.replace('_', ' ')} · est. cost {formatMoney(item.allocatedDirectCost)} · {item.grossMarginPct}% margin
                        </div>
                      </div>
                      <span className={item.needsReview ? 'font-semibold text-rose-700' : 'font-semibold text-[var(--app-ink)]'}>
                        {formatMoney(item.revenue)}
                      </span>
                    </div>
                  ))}
                  {serviceProfitabilityPlan.packages.length === 0 ? (
                    <div className="text-[var(--app-muted)]">Add the services included in this job.</div>
                  ) : null}
                </div>
                {serviceProfitabilityPlan.protections.length > 0 ? (
                  <div className="mt-3 space-y-1 rounded-[7px] bg-amber-50 p-2.5 text-amber-900">
                    {serviceProfitabilityPlan.protections.map(item => <div key={item}>• {item}</div>)}
                  </div>
                ) : (
                  <div className="mt-3 rounded-[7px] bg-emerald-50 p-2.5 text-emerald-900">Scope and margin checks are clear.</div>
                )}
              </div>
            </details>

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

                  {quoteIsCustomerFacing && quote && (
                    <div className="px-3 py-2.5 bg-emerald-50 text-emerald-900">
                      <div className="text-[10px] font-bold uppercase tracking-[0.1em]">
                        {quoteHasUnsavedPricingRevision ? 'Unsaved pricing revision' : 'Saved customer quote'}
                      </div>
                      <div className="mt-1 font-semibold">
                        {quote.number || quote.id} · {savedQuoteStatusLabel}
                      </div>
                      <div className="mt-1 text-[11px] leading-4 text-emerald-800">
                        {quoteHasUnsavedPricingRevision
                          ? 'Pricing fields have been edited. Saving will update the customer-facing quote; closing without saving keeps the sent numbers.'
                          : 'Showing the sent numbers. Opening or saving notes will not recalculate or overwrite this quote.'}
                      </div>
                    </div>
                  )}

                  {quoteIsCustomerFacing && !quoteHasUnsavedPricingRevision && quote && (
                    <div className="px-3 py-2.5 space-y-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--app-muted)]">Saved Quote Lines</div>
                      {savedQuoteLineItems.length > 0 ? (
                        savedQuoteLineItems.map((item, index) => (
                          <div key={`${item.description}-${index}`} className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="font-semibold text-[var(--app-ink)]">{item.description || 'Line item'}</div>
                              {item.details ? <div className="mt-0.5 text-[10px] leading-4 text-[var(--app-muted)]">{item.details}</div> : null}
                            </div>
                            <div className="shrink-0 font-semibold text-[var(--app-ink)]">{formatMoney(Number(item.amount || 0))}</div>
                          </div>
                        ))
                      ) : (
                        <div className="text-[var(--app-muted)]">No saved line items on this quote.</div>
                      )}
                    </div>
                  )}

                  {/* Per-leg route summary when multi-stop is on */}
                  {showLivePricingBreakdown && legsEnabled && legs.length > 0 && (
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
                              {r
                                ? `${r.distanceKm} km · ${r.driveHours}h`
                                : (leg.distanceKm && leg.originAddress && leg.destAddress)
                                  ? `${leg.distanceKm} km · ${leg.driveHours}h`
                                  : '—'}
                            </span>
                          </div>
                        )
                      })}
                      <div className="flex justify-between text-[10px] font-semibold text-purple-700 border-t border-purple-100 pt-1 mt-1">
                        <span>Total route</span>
                        <span>
                          {legs.reduce((s, l) => s + (legRoutes[l.id]?.distanceKm || ((l.originAddress && l.destAddress) ? l.distanceKm : 0) || 0), 0)} km ·{' '}
                          {legs.reduce((s, l) => s + (legRoutes[l.id]?.driveHours || ((l.originAddress && l.destAddress) ? l.driveHours : 0) || 0), 0)}h drive
                        </span>
                      </div>
                    </div>
                  )}

                  {showLivePricingBreakdown && pricingBreakdown.operationalTimeBudget && (() => {
                    const budget = pricingBreakdown.operationalTimeBudget
                    return (
                      <div className="px-3 py-3 bg-[#071421] text-white space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#C99700]">Operational time budget · shadow mode</span>
                          <span className="text-sm font-bold">{budget.totalCrewClockTime}h plan</span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-white/75">
                          <span>Productive work</span><span className="text-right">{budget.workingTime}h</span>
                          <span>Access routes</span><span className="text-right">{budget.accessTime}h</span>
                          <span>Services</span><span className="text-right">{budget.serviceTime}h</span>
                          <span>Transportation</span><span className="text-right">{budget.transportationTime}h</span>
                          <span>Operational allowance</span><span className="text-right">{budget.allowanceTime}h</span>
                        </div>
                        <div className="text-[10px] leading-4 text-white/55">Planning blocks are rounded for scheduling. Access intelligence is visible here but does not change the customer price yet.</div>
                        {budget.stops.map(stop => (
                          <div key={stop.stopId} className="rounded-md border border-white/10 px-2 py-1.5 text-[10px] text-white/70">
                            <div className="flex justify-between font-semibold text-white"><span>{stop.label}</span><span>{stop.totalHours}h</span></div>
                            <div className="mt-0.5">Handling {stop.handlingHours}h · access {stop.accessHours}h · services {stop.serviceHours}h · allowance {stop.allowanceHours}h</div>
                          </div>
                        ))}
                        {budget.manualReviewReasons.length > 0 && <div className="rounded-md bg-rose-500/15 px-2 py-1.5 text-[10px] text-rose-100">Manual review: {budget.manualReviewReasons.join(' ')}</div>}
                      </div>
                    )
                  })()}

                  {/* BASE LABOR */}
                  {showLivePricingBreakdown && <div className="px-3 py-2.5 space-y-1">
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
                  </div>}

                  {/* OUTER — TRAVEL */}
                  {showLivePricingBreakdown && <div className="px-3 py-2.5 space-y-1">
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
                        <span>{a.hours > 0 ? `+${a.hours}h / +${Math.round(a.hours * 60)} min` : 'flagged'}</span>
                      </div>
                    ))}
                  </div>}

                  {/* INNER — ON-SITE SCOPE */}
                  {showLivePricingBreakdown && (pricingBreakdown.disassemblyItems.length > 0 || pricingBreakdown.specialtyItemFlags.length > 0 || pricingBreakdown.adjustmentBreakdown.some(a => a.category === 'disassembly' || a.category === 'specialty' || a.category === 'packing')) && (
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

                  {showLivePricingBreakdown && (() => {
                    const visibleAdjustmentHours = pricingBreakdown.adjustmentBreakdown.reduce((sum, item) => sum + item.hours, 0)
                    const visibleHours =
                      pricingBreakdown.loadHours +
                      pricingBreakdown.unloadHours +
                      pricingBreakdown.driveHours +
                      visibleAdjustmentHours +
                      pricingBreakdown.bufferHours
                    const undisplayedHours = Math.round(Math.max(0, pricingBreakdown.totalHours - visibleHours) * 4) / 4
                    if (undisplayedHours < 0.25) return null
                    return (
                      <div className="px-3 py-2.5 space-y-1">
                        <div className="flex justify-between text-[var(--app-muted)]">
                          <span className="uppercase tracking-wide text-[10px]">Other pricing adjustments</span>
                          <span>+{undisplayedHours}h</span>
                        </div>
                        <div className="text-[10px] leading-4 text-[var(--app-muted)]">
                          Includes multi-trip handling, minimums, route rounding, or operational scope not shown in the simple categories above.
                        </div>
                      </div>
                    )
                  })()}

                  {/* BUFFERS */}
                  {showLivePricingBreakdown && <div className="px-3 py-2.5 space-y-1">
                    <div className="flex justify-between text-[var(--app-muted)]">
                      <span className="uppercase tracking-wide text-[10px]">Buffers</span>
                      <span>+{pricingBreakdown.bufferHours}h</span>
                    </div>
                  </div>}

                  {/* TOTAL — hourly for local, flat-rate guidance for long-distance */}
                  <div className="px-3 py-3 bg-[#071421] text-white space-y-1">
                    {quoteIsCustomerFacing && quote ? (
                      <>
                        <div className="flex justify-between font-semibold">
                          <span>
                            {savedQuoteCrewSize || pricingBreakdown.crewSize} movers · {savedQuoteTruckCount || pricingBreakdown.truckCount} truck{(savedQuoteTruckCount || pricingBreakdown.truckCount) > 1 ? 's' : ''}
                          </span>
                          <span>{quoteHasUnsavedPricingRevision ? (savedQuoteHours > 0 ? `${savedQuoteHours}h` : 'Revision') : 'Saved'}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-[#C99700]">
                          <span>{quoteHasUnsavedPricingRevision ? 'Revision estimate' : 'Saved estimate'}</span>
                          <span>{formatMoney(quoteHasUnsavedPricingRevision ? quoteModalTotals.subtotal : (savedQuoteSubtotal || quoteModalTotals.subtotal))}</span>
                        </div>
                        {(quoteHasUnsavedPricingRevision ? quoteModalTotals.total : savedQuoteTotal) > 0 && (
                          <div className="flex justify-between text-[11px] text-white/70">
                            <span>Incl. HST</span>
                            <span>{formatMoney(quoteHasUnsavedPricingRevision ? quoteModalTotals.total : savedQuoteTotal)}</span>
                          </div>
                        )}
                      </>
                    ) : (route?.category === 'long-distance' || quoteType === 'long_distance') ? (
                      <>
                        <div className="flex justify-between font-semibold">
                          <span>{pricingBreakdown.crewSize} movers · {pricingBreakdown.truckCount} truck{pricingBreakdown.truckCount > 1 ? 's' : ''} · U-Haul one-way</span>
                          <span>{pricingBreakdown.loadHours + (pricingBreakdown.unloadHours || 0)}h labour</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-[#C99700]">
                          <span>Estimate</span>
                          <span className="text-xs font-normal text-white/70">Use Live Margin below ↓</span>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between font-semibold">
                          <span>{pricingBreakdown.crewSize} movers · {pricingBreakdown.truckCount} truck{pricingBreakdown.truckCount > 1 ? 's' : ''} · ${pricingBreakdown.crewRatePerHour}/hr</span>
                          <span>{routeBusy ? '…' : `${pricingBreakdown.totalHours}h`}</span>
                        </div>
                        <div className="flex justify-between text-sm font-bold text-[#C99700]">
                          <span>Estimate</span>
                          {routeBusy
                            ? <span className="text-xs font-normal text-white/60 animate-pulse">Calculating route…</span>
                            : <span>{formatMoney(pricingBreakdown.totalHours * pricingBreakdown.crewRatePerHour)}</span>
                          }
                        </div>
                      </>
                    )}
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

            {/* U-Haul Job Cost Calculator — local/medium only; long-distance uses the panel below */}
            {pricingBreakdown && route?.category !== 'long-distance' && quoteType !== 'long_distance' && (() => {
              const oneWayKm = distanceKm || route?.distanceKm || 0
              const truckCount = pricingBreakdown.truckCount || 1
              const tripStrategy = (pricingBreakdown.tripStrategy || 'single_truck') as TripStrategy
              const totalCubicFeet = pricingBreakdown.totalCubicFeet || effectiveInventoryMetrics.totalCubicFeet || 0
              const truckSize = truckSizeFromCubicFeet(totalCubicFeet)
              const defaultBlankets = DEFAULT_BLANKET_BAGS[truckSize] ?? 6
              const blanketBags = uhaulBlankets ?? (defaultBlankets * truckCount)
              // Hours depend on strategy — 1 truck 2 trips takes longer than 2 trucks 1 trip
              const estimatedHoursForStrategy = (() => {
                const activeS = uhaulSelectedStrategy ?? tripStrategy
                if (activeS === 'single_truck_two_trips') {
                  // Use twoTripComparison hours if available (pricing engine already calculates this correctly)
                  return flags?.twoTripComparison?.totalHours || pricingBreakdown.totalHours || 3
                }
                // For 2 trucks: the standard totalHours is already calculated for this strategy
                return pricingBreakdown.totalHours || 3
              })()
              const estimatedHours = estimatedHoursForStrategy
              const crewSize = pricingBreakdown.crewSize || 3
              const revenue = quoteModalTotals.subtotal || 0
              // TV box cost added to miscBuffer so it reduces gross profit correctly
              const effectiveMiscBuffer = uhaulMisc + tvBoxCost

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
                crewSize, estimatedHours, miscBuffer: effectiveMiscBuffer, revenue,
              })
              const commercialDirectCost = lead.moveType === 'commercial'
                ? Number(pricingBreakdown.internalCostEstimate.commercialDirectCost || 0)
                : 0
              const adjustedTotalCost = Math.round((cost.totalCost + commercialDirectCost) * 100) / 100
              const adjustedGrossProfit = Math.round((revenue - adjustedTotalCost) * 100) / 100
              const adjustedGrossMarginPct = revenue > 0 ? Math.round((adjustedGrossProfit / revenue) * 1000) / 10 : 0

              // Only show trip comparison when the system has detected a multi-truck or two-trip move
              // No trip comparison for long-distance — 2 trucks always go together, no return trips possible
              // Show comparison whenever system detected 2+ trucks or 2 trips — even if route is 0km
              // Use a fallback distance of 15km when route hasn't resolved yet
              const comparisonKm = oneWayKm > 0 ? oneWayKm : 15
              const showComparison = oneWayKm < 200 &&
                (tripStrategy === 'two_trucks' || tripStrategy === 'single_truck_two_trips' || tripStrategy === 'three_trucks')
              const comparison = showComparison
                ? compareStrategies(
                    { truckSize, oneWayDistanceKm: comparisonKm, uhaulPickupKm: pickupKm, gasPrice: uhaulGasPrice, includeStraightDrop: uhaulStraightDrop, crewSize, estimatedHours, miscBuffer: uhaulMisc, revenue },
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
                      {conjointInventoryPending ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                          Pending {conjointPendingLabel} inventory
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${adjustedGrossMarginPct >= 55 ? 'text-emerald-700' : adjustedGrossMarginPct >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>
                        {formatMoney(adjustedGrossProfit)} · {adjustedGrossMarginPct.toFixed(1)}%
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
                          {uhaulDepotName ? (
                            <div className="text-[10px] text-[var(--app-muted)] truncate max-w-[180px]" title={uhaulDepotName}>
                              📍 {uhaulDepotName} · {pickupKm > 0 ? `${pickupKm}km` : '?km'}
                            </div>
                          ) : (
                            <button type="button"
                              onClick={() => {
                                setUhaulDepotLookupDone(false)  // allow retry
                              }}
                              className="text-[10px] text-[var(--app-accent)] hover:underline"
                            >
                              {uhaulDepotLookupDone ? '🔄 Retry depot lookup' : '⏳ Finding nearest U-Haul…'}
                            </button>
                          )}
                        </div>
                        {/* Manual pickup distance when auto-lookup fails */}
                        {uhaulDepotLookupDone && !uhaulDepotName && (
                          <div className="flex items-center gap-2 mb-1.5 rounded bg-amber-50 border border-amber-200 px-2 py-1.5">
                            <span className="text-[10px] text-amber-700 shrink-0">U-Haul depot not auto-found. Enter km from depot to origin:</span>
                            <input
                              type="number" min={0} step={1}
                              value={uhaulPickupKm ?? ''}
                              onChange={e => setUhaulPickupKm(e.target.value ? Number(e.target.value) : null)}
                              placeholder="e.g. 5"
                              className="crm-input text-xs w-16 py-0.5"
                            />
                          </div>
                        )}
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
                            <span className="text-[var(--app-muted)]">SafeMove ({activeTruckCount}×)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.safeMoveInsurance)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Blankets ({blanketBags} bags × $6)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.blankets)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Stretch wrap ({activeTruckCount}× @ $25)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.stretchWrap)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">HST 13% (excl. fuel)</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.truckHST)}</span>
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

                      {/* Miscellaneous + packing cost when added */}
                      <div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">📦 Miscellaneous</div>
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-[var(--app-muted)]">Food + crew gas buffer</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(cost.miscCost)}</span>
                          </div>
                          {packingLaborAdded && flags?.packingDayEstimate && (
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--app-muted)]">Packing day cost ({flags.packingDayEstimate.crewSize} packers · {flags.packingDayEstimate.hours}h)</span>
                              <span className="text-[var(--app-ink)]">{formatMoney(flags.packingDayEstimate.amountBeforeHst)}</span>
                            </div>
                          )}
                          {tvBoxesAdded && tvBoxCost > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--app-muted)]">TV box cost ({tvBoxCount}× U-Haul · {formatMoney(tvBoxCost)} cost · charge {formatMoney(tvBoxRevenue)})</span>
                              <span className="text-[var(--app-ink)]">{formatMoney(tvBoxCost)}</span>
                            </div>
                          )}
                          {commercialDirectCost > 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-[var(--app-muted)]">Commercial direct costs</span>
                              <span className="text-[var(--app-ink)]">{formatMoney(commercialDirectCost)}</span>
                            </div>
                          )}
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
                          <span className="text-[var(--app-ink)]">{formatMoney(adjustedTotalCost)}</span>
                        </div>
                        <div className={`flex justify-between text-sm font-bold pt-0.5 ${adjustedGrossMarginPct >= 55 ? 'text-emerald-700' : adjustedGrossMarginPct >= 40 ? 'text-amber-700' : 'text-rose-700'}`}>
                          <span>Gross profit</span>
                          <span>{formatMoney(adjustedGrossProfit)} ({adjustedGrossMarginPct.toFixed(1)}%)</span>
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
                                  onClick={() => selectTruckStrategy(strategy)}
                                  className={`rounded-[6px] border px-2.5 py-2 text-left transition ${
                                    isActive
                                      ? 'border-[#071421] bg-[#071421]/5 ring-1 ring-[#071421]/20'
                                      : 'border-[var(--app-line)] hover:border-[var(--app-muted)]'
                                  }`}
                                >
                                  <div className="text-[10px] font-semibold text-[var(--app-ink)]">{label}</div>
                                  <div className="text-sm font-bold text-[var(--app-ink)] mt-0.5">{formatMoney(data.truckTotal)}</div>
                                  {/* Gross profit for this strategy */}
                                  {revenue > 0 && (() => {
                                    // Use origin→dest drive only (not total billable which includes yard travel)
                                    const oneWayDriveH = route?.originToDestination?.driveHours || (pricingBreakdown.driveHours / 2)
                                    const baseLabourH = pricingBreakdown.loadHours + pricingBreakdown.unloadHours + pricingBreakdown.penaltyHours
                                    const stratLabour = Math.round(crewSize * (strategy === 'single_truck_two_trips'
                                      ? (baseLabourH + oneWayDriveH * 2 + pricingBreakdown.bufferHours)  // two trips = two one-way drives + labor
                                      : (baseLabourH + oneWayDriveH + pricingBreakdown.bufferHours)       // one trip = one drive
                                    ) * 25 * 100) / 100
                                    const stratCost = Math.round((data.truckTotal + stratLabour + uhaulMisc) * 100) / 100
                                    const stratProfit = Math.round((revenue - stratCost) * 100) / 100
                                    const stratMargin = revenue > 0 ? Math.round(stratProfit / revenue * 1000) / 10 : 0
                                    const mColor = stratMargin >= 55 ? 'text-emerald-700' : stratMargin >= 40 ? 'text-amber-700' : 'text-rose-700'
                                    return <div className={`text-[10px] font-semibold mt-0.5 ${mColor}`}>{formatMoney(stratProfit)} · {stratMargin.toFixed(1)}% margin</div>
                                  })()}
                                  {/* Timing */}
                                  <div className="mt-1 space-y-0.5">
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
                                    {isActive && <span className="text-[#071421] font-semibold">● Active</span>}
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


            {/* ── JOB PLAN (Logistics + Scope merged) ── */}
            {pricingBreakdown && (() => {
              const totalH = pricingBreakdown.totalHours
              const trucks = pricingBreakdown.truckCount
              const needsPacking = jobFactors.packingStatus === 'not-started' || jobFactors.packingStatus === 'partial'
              const hasStorage = legsEnabled && legs.some(l => l.type === 'storage' || l.type === 'storage_delivery')
              // Only split into D1/D2 when move genuinely can't finish same day
              // 9am start: 9 + totalH > 21 (10pm cutoff) = needs Day 2
              // Storage moves always split by definition
              const genuinelyTwoDay = (9 + totalH) > 21 || hasStorage
              const isBigMove = genuinelyTwoDay

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


            {/* ── Multi-Leg Cost Overview (when multi-stop is on) ── */}
            {legsEnabled && legs.length > 1 && (
              <div className="border border-[var(--app-line)] rounded-[10px] overflow-hidden">
                <div className="px-3.5 py-2.5 bg-[var(--app-surface)] flex items-center justify-between">
                  <span className="text-xs font-semibold text-[var(--app-ink)]">Internal Multi-Stop Cost</span>
                  <span className="text-[10px] text-[var(--app-muted)]">{legs.length} legs</span>
                </div>
                <div className="px-3.5 pb-3.5 pt-1 bg-white space-y-2">
                  {legs.map((leg, i) => {
                    const legHasAddresses = !!(leg.originAddress && leg.destAddress)
                    const legKm = legRoutes[leg.id]?.distanceKm || (legHasAddresses ? leg.distanceKm : 0) || 0
                    const legDriveH = legRoutes[leg.id]?.driveHours || (legHasAddresses ? leg.driveHours : 0) || 0
                    const isLDLeg = legKm > 200 || legDriveH > 2.5
                    const legLoadH = pricingBreakdown ? pricingBreakdown.loadHours / legs.length : 3
                    const legUnloadH = pricingBreakdown ? pricingBreakdown.unloadHours / legs.length : 2
                    const legCrewH  = isLDLeg
                      ? Math.round((legLoadH + legDriveH + legUnloadH + legDriveH) * 4) / 4
                      : Math.round((legLoadH + legDriveH + legUnloadH) * 4) / 4
                    const legLabor  = Math.round((pricingBreakdown?.crewSize || 3) * legCrewH * 25 * 100) / 100
                    const effectiveCostCubicFeet = conjointMode
                      ? (conjointMetrics.totalCubicFeet || pricingBreakdown?.totalCubicFeet || 0)
                      : (pricingBreakdown?.totalCubicFeet || 0)
                    const legTruckAmt = isLDLeg
                      ? calcLongDistanceUHaul(legKm, truckSizeFromCubicFeet(effectiveCostCubicFeet), pricingBreakdown?.truckCount || 1).internalCost
                      : Math.round((UHAUL_DAILY_RATES[truckSizeFromCubicFeet(effectiveCostCubicFeet)] ?? 49.99) * (pricingBreakdown?.truckCount || 1) * 100) / 100
                    const legTotal  = Math.round((legTruckAmt + legLabor + 15) * 100) / 100
                    const typeTag   = leg.type === 'storage' ? 'House→Storage' : leg.type === 'storage_delivery' ? 'Storage→Dest' : isLDLeg ? 'Long-distance' : 'Local'
                    return (
                      <div key={leg.id} className="rounded-[6px] border border-[var(--app-line)] p-2.5 space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-semibold text-[var(--app-ink)]">
                            Leg {i+1}: {leg.label || typeTag}
                          </div>
                          <span className={`text-[9px] rounded-full px-2 py-0.5 font-semibold ${isLDLeg ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{typeTag}</span>
                        </div>
                        {[
                          [`Truck${isLDLeg ? ' (one-way est.)' : ' + mileage'}`, legTruckAmt],
                          [`Labour (${legCrewH}h)`, legLabor],
                          [`Misc`, 15],
                        ].map(([label, val]) => (
                          <div key={String(label)} className="flex justify-between text-[10px]">
                            <span className="text-[var(--app-muted)]">{label}</span>
                            <span className="text-[var(--app-ink)]">{formatMoney(Number(val))}</span>
                          </div>
                        ))}
                        <div className="flex justify-between text-xs font-semibold border-t border-[var(--app-line)] pt-1">
                          <span>Leg {i+1} cost</span><span>{formatMoney(legTotal)}</span>
                        </div>
                      </div>
                    )
                  })}
                  <div className="flex justify-between text-xs font-bold border-t-2 border-[var(--app-line)] pt-2">
                    <span>Internal ops cost estimate</span>
                    <span>{formatMoney(legs.reduce((sum, leg, i) => {
                      const _legHasAddresses = !!(leg.originAddress && leg.destAddress)
                      const legKm = legRoutes[leg.id]?.distanceKm || (_legHasAddresses ? leg.distanceKm : 0) || 0
                      const legDriveH = legRoutes[leg.id]?.driveHours || (_legHasAddresses ? leg.driveHours : 0) || 0
                      const isLDLeg = legKm > 200 || legDriveH > 2.5
                      const legLoadH = pricingBreakdown ? pricingBreakdown.loadHours / legs.length : 3
                      const legUnloadH = pricingBreakdown ? pricingBreakdown.unloadHours / legs.length : 2
                      const legCrewH = isLDLeg ? Math.round((legLoadH + legDriveH + legUnloadH + legDriveH) * 4) / 4 : Math.round((legLoadH + legDriveH + legUnloadH) * 4) / 4
                      const legLabor = Math.round((pricingBreakdown?.crewSize || 3) * legCrewH * 25 * 100) / 100
                      const effectiveCostCubicFeet = conjointMode
                        ? (conjointMetrics.totalCubicFeet || pricingBreakdown?.totalCubicFeet || 0)
                        : (pricingBreakdown?.totalCubicFeet || 0)
                      const legTruckAmt = isLDLeg ? calcLongDistanceUHaul(legKm, truckSizeFromCubicFeet(effectiveCostCubicFeet), pricingBreakdown?.truckCount || 1).internalCost : Math.round((UHAUL_DAILY_RATES[truckSizeFromCubicFeet(effectiveCostCubicFeet)] ?? 49.99) * (pricingBreakdown?.truckCount || 1) * 100) / 100
                      return sum + legTruckAmt + legLabor + 15
                    }, 0))}</span>
                  </div>
                  <div className="text-[9px] text-[var(--app-muted)]">Internal truck, labor, and misc cost only. Customer subtotal remains the main quote total above.</div>
                </div>
              </div>
            )}

            {/* ── Conjoint Move Logistics Panel ── */}
            {conjointMode && legsEnabled && legs.length >= 2 && (() => {
              const plannedLegs = legs.map(leg => {
                const hasAddresses = !!(leg.originAddress && leg.destAddress)
                return {
                  ...leg,
                  distanceKm: legRoutes[leg.id]?.distanceKm ?? (hasAddresses ? leg.distanceKm : undefined),
                  driveHours: legRoutes[leg.id]?.driveHours ?? (hasAddresses ? leg.driveHours : undefined),
                }
              })
              const personAItems = effectiveConjointInventory.filter(item => item.included !== false && item.owner !== 'person_b')
              const personBItems = effectiveConjointInventory.filter(item => item.included !== false && item.owner === 'person_b')
              const personAVolume = Math.round(personAItems.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0))
              const personBVolume = Math.round(personBItems.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0))
              const personALabel = jobFactors.personALabel || 'Person A'
              const personBLabel = jobFactors.personBLabel || 'Person B'
              const routeDriveHours = plannedLegs.reduce((sum, leg) => sum + Number(leg.driveHours || leg.billableDriveHours || leg.operationalDriveHours || 0), 0)
              const routeAwareTotalHours = Math.round(Math.max(
                Number(pricingBreakdown?.totalHours || 0),
                Number(pricingBreakdown?.loadHours || 0) + Number(pricingBreakdown?.unloadHours || 0) + routeDriveHours
              ) * 4) / 4
              const plan = deriveMoveLogisticsPlan({
                legs: plannedLegs,
                inventory: effectiveConjointInventory,
                totalCubicFeet: conjointMetrics.totalCubicFeet || effectiveInventoryMetrics.totalCubicFeet,
                loadHours: pricingBreakdown?.loadHours,
                unloadHours: pricingBreakdown?.unloadHours,
                totalHours: routeAwareTotalHours,
                crewSize: pricingBreakdown?.crewSize || 3,
                startTime: quote?.moveTime || '09:00',
                destinationKeysTime: jobFactors.destinationKeysTime,
                earliestLoadTime: jobFactors.earliestLoadTime,
                latestFinishTime: jobFactors.latestFinishTime,
                pickupContexts: [
                  {
                    id: 'person_a',
                    label: personALabel,
                    cubicFeet: personAVolume,
                    itemCount: personAItems.length,
                    address: plannedLegs[0]?.originAddress || originAddress || lead.originAddress,
                    inventoryPending: personAVolume <= 0,
                  },
                  {
                    id: 'person_b',
                    label: personBLabel,
                    cubicFeet: personBVolume,
                    itemCount: personBItems.length,
                    address: plannedLegs[1]?.originAddress || plannedLegs[0]?.destAddress,
                    accessNotes: [
                      jobFactors.personBOriginFloors ? `${jobFactors.personBOriginFloors} floors` : '',
                      jobFactors.personBOriginHasElevator ? 'elevator' : '',
                      jobFactors.personBOriginParkingOk === false ? 'parking risk' : '',
                    ].filter(Boolean).join(' · '),
                    inventoryPending: personBVolume <= 0,
                  },
                ],
              })
              const totalKm = plannedLegs.reduce((sum, leg) => sum + Math.round(Number(leg.distanceKm || leg.billableDistanceKm || 0)), 0)
              const routeSegments = plannedLegs.map((leg, index) => {
                const fromLabel = index === 0 ? personALabel : index === 1 ? personBLabel : (leg.label || `Stop ${index + 1}`)
                const toLabel = index === plannedLegs.length - 1 ? 'Final destination' : index === 0 ? personBLabel : (plannedLegs[index + 1]?.label || `Stop ${index + 2}`)
                const km = Math.round(Number(leg.distanceKm || leg.billableDistanceKm || leg.operationalDistanceKm || 0))
                const hours = Math.round(Number(leg.driveHours || leg.billableDriveHours || leg.operationalDriveHours || 0) * 4) / 4
                return { id: leg.id || String(index), fromLabel, toLabel, km, hours }
              }).filter(segment => segment.km > 0 || segment.hours > 0)
              const selectedOperatingPlan = jobFactors.preferredOperatingPlan === 'two_trucks_parallel'
                ? 'two_truck_parallel'
                : jobFactors.preferredOperatingPlan === 'split_day_storage'
                  ? 'split_day'
                  : jobFactors.preferredOperatingPlan

              return (
                <div className="border border-purple-200 rounded-[10px] overflow-hidden">
                  <div className="px-3.5 py-2.5 bg-purple-50 flex items-center justify-between">
                    <span className="text-xs font-semibold text-purple-800">Conjoint Move Logistics</span>
                    <span className="text-[10px] text-purple-600">{pricingBreakdown?.crewSize || 3} movers · {plan.truckCount} truck{plan.truckCount > 1 ? 's' : ''} · {totalKm > 0 ? `${totalKm} km total` : 'add addresses for distance'}</span>
                  </div>
                  <div className="bg-white px-3.5 py-3 space-y-3">
                    <div className={`rounded-[8px] px-3 py-2.5 text-[11px] font-semibold ${
                      plan.recommendation === 'split_day'
                        ? 'bg-rose-100 text-rose-800'
                        : plan.recommendation === 'two_truck_parallel' || plan.recommendation === 'needs_route_data'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {plan.label} — {plan.totalCubicFeet.toLocaleString()} cu ft, {plan.capacityUsedPct}% of one 26ft truck, ~{plan.estimatedHours}h window, finish around {plan.finishTime}.
                    </div>
                    {routeSegments.length > 0 && (
                      <div className="rounded-[6px] border border-[var(--app-line)] px-3 py-2 text-[10px]">
                        <div className="mb-1.5 font-semibold uppercase tracking-wide text-[var(--app-muted)]">Route legs</div>
                        <div className="space-y-1">
                          {routeSegments.map(segment => (
                            <div key={segment.id} className="flex items-center justify-between gap-3">
                              <span className="min-w-0 truncate text-[var(--app-ink)]">{segment.fromLabel} → {segment.toLabel}</span>
                              <span className="shrink-0 text-[var(--app-muted)]">{segment.km > 0 ? `${segment.km} km` : 'km TBD'} · {segment.hours > 0 ? `${segment.hours}h drive` : 'drive TBD'}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {plan.salesTalkingPoints.length > 0 && (
                      <div className="rounded-[6px] border border-[var(--app-line)] bg-[var(--app-bg)] px-3 py-2 text-[10px] text-[var(--app-muted)] space-y-1">
                        {plan.salesTalkingPoints.map((point, i) => (
                          <div key={i}>• {point}</div>
                        ))}
                      </div>
                    )}
                    {plan.riskNotes.length > 0 && (
                      <div className="rounded-[6px] border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800 space-y-1">
                        {plan.riskNotes.map((note, i) => (
                          <div key={i}>• {note}</div>
                        ))}
                      </div>
                    )}
                    {(plan.constraintFit.destinationReadyTime || plan.constraintFit.latestFinishTime || plan.constraintFit.status !== 'clear') && (
                      <div className={`rounded-[8px] border px-3 py-2 text-[10px] ${
                        plan.constraintFit.status === 'runs_late' || plan.constraintFit.status === 'needs_review'
                          ? 'border-rose-200 bg-rose-50 text-rose-800'
                          : plan.constraintFit.status === 'adjust_start'
                            ? 'border-amber-200 bg-amber-50 text-amber-800'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      }`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">Timing intelligence</span>
                          {plan.constraintFit.recommendedStartTime && (
                            <button
                              type="button"
                              onClick={() => applyTimelineStartTime(
                                plan.constraintFit.recommendedStartTime,
                                `Timeline start adjusted: ${plan.constraintFit.note}`
                              )}
                              className="rounded-full bg-white/80 px-2 py-0.5 font-semibold hover:bg-white"
                            >
                              Apply {plan.constraintFit.recommendedStartTime}
                            </button>
                          )}
                        </div>
                        <div className="mt-1">{plan.constraintFit.note}</div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[9px] opacity-80">
                          {plan.constraintFit.destinationReadyTime && <span>Keys: {plan.constraintFit.destinationReadyTime}</span>}
                          {plan.constraintFit.finalArrivalTime && <span>Arrive destination: {plan.constraintFit.finalArrivalTime}</span>}
                          {plan.constraintFit.finishTime && <span>Finish: {plan.constraintFit.finishTime}</span>}
                          {plan.constraintFit.latestFinishTime && <span>Latest finish: {plan.constraintFit.latestFinishTime}</span>}
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Operating options</div>
                      <div className="grid gap-2">
                        {plan.options.map(option => {
                          const optionNeedsInventory = conjointInventoryPending
                          const optionCanBeApplied = option.viable && !optionNeedsInventory
                          return (
                            <div
                              key={option.id}
                              className={`rounded-[8px] border px-3 py-2 ${
                                optionCanBeApplied
                                  ? option.id === (selectedOperatingPlan || (plan.recommendation === 'two_truck_parallel' ? 'two_truck_parallel' : plan.recommendation))
                                    ? 'border-emerald-300 bg-emerald-50'
                                    : 'border-[var(--app-line)] bg-white'
                                  : optionNeedsInventory
                                    ? 'border-amber-200 bg-amber-50 opacity-90'
                                    : 'border-slate-200 bg-slate-50 opacity-75'
                              }`}
                            >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="text-[11px] font-semibold text-[var(--app-ink)]">{option.label}</div>
                                <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">
                                  {option.truckCount} truck{option.truckCount === 1 ? '' : 's'} · {option.crewCount} crew{option.crewCount === 1 ? '' : 's'} · {option.dayCount} day{option.dayCount === 1 ? '' : 's'}
                                </div>
                              </div>
                              <div className="text-right">
                                <div className="text-[11px] font-bold text-[var(--app-ink)]">~{option.estimatedHours}h</div>
                                <div className="text-[9px] text-[var(--app-muted)]">{option.finishTime}</div>
                              </div>
                            </div>
                            <div className="mt-1.5 text-[10px] leading-4 text-[var(--app-muted)]">{option.summary}</div>
                            <div className={`mt-1 text-[10px] font-semibold ${
                              optionNeedsInventory ? 'text-amber-700' : option.viable ? 'text-emerald-700' : 'text-slate-500'
                            }`}>
                              {optionNeedsInventory
                                ? `Inventory needed before this plan can be locked. ${option.tradeoff}`
                                : option.viable ? option.tradeoff : `Not ideal: ${option.tradeoff}`}
                            </div>
                            <div className="mt-2 flex items-center justify-between gap-2">
                              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                                {selectedOperatingPlan === option.id ? 'Applied' : optionNeedsInventory ? 'Inventory needed' : option.viable ? 'Available' : 'Review first'}
                              </span>
                              <button
                                type="button"
                                onClick={() => applyLogisticsOption(option)}
                                disabled={!optionCanBeApplied}
                                className={`rounded-[6px] px-2.5 py-1 text-[10px] font-semibold transition-colors ${
                                  selectedOperatingPlan === option.id
                                    ? 'bg-emerald-600 text-white'
                                    : optionCanBeApplied
                                      ? 'bg-[#071421] text-white hover:opacity-90'
                                      : 'bg-slate-200 text-slate-500'
                                } disabled:cursor-not-allowed`}
                              >
                                {selectedOperatingPlan === option.id ? 'Applied' : 'Use plan'}
                              </button>
                            </div>
                          </div>
                          )
                        })}
                      </div>
                    </div>
                    {/* Day timeline */}
                    <div>
                      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--app-muted)]">Day-of-Move Timeline</div>
                      <div className="space-y-1.5">
                        {plan.phases.map((phase, i) => {
                          const label = phase.label
                            .replace('first pickup', `${personALabel}'s`)
                            .replace('First pickup', `${personALabel}`)
                            .replace('second pickup', `${personBLabel}'s`)
                            .replace('Second pickup', `${personBLabel}`)
                          return (
                            <div key={i} className="flex items-start gap-2.5 text-[11px]">
                              <div className="flex items-center gap-1.5 shrink-0 w-[72px]">
                                <div className={`h-2 w-2 rounded-full shrink-0 ${i === 0 ? 'bg-slate-400' : i === plan.phases.length - 1 ? 'bg-emerald-500' : 'bg-purple-400'}`} />
                                <span className="font-mono font-semibold text-[var(--app-ink)]">{phase.time}</span>
                              </div>
                              <div className="min-w-0">
                                <span className="font-medium text-[var(--app-ink)]">{label}</span>
                                {phase.note && <span className="ml-1.5 text-[10px] text-[var(--app-muted)]">{phase.note}</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    {/* Load split */}
                    {(plan.volumeSplit.personA.cubicFeet > 0 || plan.volumeSplit.personB.cubicFeet > 0) && (
                      <div className="rounded-[6px] border border-[var(--app-line)] p-2 space-y-1 text-[10px]">
                        <div className="font-semibold text-[var(--app-muted)] uppercase tracking-wide">Volume by person</div>
                        <div className="flex justify-between">
                          <span className="text-blue-700">{personALabel}</span>
                          <span className="font-semibold">{plan.volumeSplit.personA.cubicFeet} cu ft · {plan.volumeSplit.personA.itemCount} items</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-purple-700">{personBLabel}</span>
                          <span className="font-semibold">{plan.volumeSplit.personB.cubicFeet} cu ft · {plan.volumeSplit.personB.itemCount} items</span>
                        </div>
                        <div className="flex justify-between border-t border-[var(--app-line)] pt-1 font-semibold">
                          <span>Combined</span>
                          <span>{plan.totalCubicFeet} cu ft</span>
                        </div>
                      </div>
                    )}
                    <div className="text-[9px] text-[var(--app-muted)]">Timeline uses saved start time from quote. Driving times update when leg addresses are set.</div>
                  </div>
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
                  <div className="text-xs text-[var(--app-muted)]">Deposit ({quoteModalTotals.total > 0 ? Math.round((quoteModalTotals.deposit / quoteModalTotals.total) * 100) : 30}%)</div>
                  <div className="mt-1 text-lg font-medium text-[var(--app-ink)]">{formatMoney(quoteModalTotals.deposit)}</div>
                </div>
              </div>
              <div className="mt-4 space-y-3">
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold text-[var(--app-ink)]">Estimate Readiness Workspace</div>
                      <div className="mt-0.5 text-[10px] text-[var(--app-muted)]">Evidence → confirmed scope → logistics → fixed-price promise</div>
                    </div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">
                      {readinessItems.filter(item => item.ready).length}/{readinessItems.length} ready
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {evidenceSources.length > 0
                      ? evidenceSources.map(source => <span key={source} className="rounded-full bg-sky-50 px-2 py-1 text-[9px] font-semibold text-sky-700">{source}</span>)
                      : <span className="rounded-full bg-rose-50 px-2 py-1 text-[9px] font-semibold text-rose-700">No evidence source</span>}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
                    <div className="rounded-[6px] bg-emerald-50 px-2 py-1.5"><div className="text-sm font-semibold text-emerald-800">{includedInventory.length - unresolvedInventoryItems.length}</div><div className="text-[8px] uppercase tracking-wide text-emerald-700">Moving / confirmed</div></div>
                    <div className="rounded-[6px] bg-amber-50 px-2 py-1.5"><div className="text-sm font-semibold text-amber-800">{unresolvedInventoryItems.length}</div><div className="text-[8px] uppercase tracking-wide text-amber-700">Decision pending</div></div>
                    <div className="rounded-[6px] bg-slate-100 px-2 py-1.5"><div className="text-sm font-semibold text-slate-700">{excludedInventoryCount}</div><div className="text-[8px] uppercase tracking-wide text-slate-600">Staying / excluded</div></div>
                  </div>
                  <div className="mt-3 space-y-3">
                    {([
                      ['evidence', '1 · Evidence collected'],
                      ['inventory', '2 · Inventory reconciled'],
                      ['logistics', '3 · Route & access'],
                      ['commercial', '4 · Commercial promise'],
                    ] as const).map(([category, heading]) => {
                      const categoryItems = readinessItems.filter(item => item.category === category)
                      const categoryReady = categoryItems.filter(item => item.ready).length
                      return (
                        <div key={category} className="rounded-[7px] bg-[var(--app-bg)] p-2.5">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--app-muted)]">{heading}</span>
                            <span className="text-[9px] font-semibold text-[var(--app-muted)]">{categoryReady}/{categoryItems.length}</span>
                          </div>
                          <div className="space-y-1.5">
                            {categoryItems.map(item => (
                              <div key={item.label} className="flex items-start justify-between gap-2 text-[11px]" title={item.ready ? undefined : item.detail}>
                                <span className={item.ready ? 'text-[var(--app-ink)]' : item.critical ? 'text-rose-700' : 'text-amber-700'}>{item.label}</span>
                                <span className={`shrink-0 font-semibold ${item.ready ? 'text-emerald-700' : item.critical ? 'text-rose-700' : 'text-amber-700'}`}>
                                  {item.ready ? '✓' : item.critical ? 'Required' : 'Confirm'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
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
              {/* Long-Distance Live Margin — same card style as local, no blue */}
              {(route?.category === 'long-distance' || quoteType === 'long_distance') && (() => {
                const uhaulPerTruck = Math.round(Number(uhaulInputPerTruck || 0) * 100) / 100
                const ldTruckCount = pricingBreakdown?.truckCount || 1
                const ldDistKm = route?.distanceKm || 0
                const ldTruckSize = truckSizeFromCubicFeet(pricingBreakdown?.totalCubicFeet || 0)
                const fuelPer100km = UHAUL_FUEL_L_PER_100KM[ldTruckSize] ?? 23.5
                // One-way drive: use originToDestination (actual route), NOT pricingBreakdown.driveHours which is round-trip
                const ldDriveOneWay   = route?.originToDestination?.driveHours
                  || (pricingBreakdown?.driveHours ? Math.round(pricingBreakdown.driveHours / 2 * 4) / 4 : 0)
                  || Math.round(ldDistKm / 100)
                const ldLoadHours     = pricingBreakdown?.loadHours || 3
                const ldUnloadHours   = pricingBreakdown?.unloadHours || 2.5
                const ldCrewSize      = pricingBreakdown?.crewSize || 3

                // For very long distance (>1000km) crew flies back — don't charge return drive hours
                // Flight cost estimate per person: scales with distance
                const crewFliesBack = ldDistKm > 1000
                const flightCostPerPerson = ldDistKm > 3500 ? 500 : ldDistKm > 2000 ? 400 : ldDistKm > 1500 ? 350 : 280
                const ldCrewReturnCost = crewFliesBack
                  ? Math.round(ldCrewSize * flightCostPerPerson * 100) / 100   // flights home
                  : Math.round(ldDistKm * 0.15 * 100) / 100                    // gas if driving back

                // Labour: load + drive there + unload + return drive ONLY if crew drives back
                const ldTotalLaborH   = crewFliesBack
                  ? Math.round((ldLoadHours + ldDriveOneWay + ldUnloadHours) * 4) / 4   // no return drive
                  : Math.round((ldLoadHours + ldDriveOneWay + ldUnloadHours + ldDriveOneWay) * 4) / 4
                const ldLabor         = Math.round(ldCrewSize * ldTotalLaborH * 25 * 100) / 100

                const ldFuel          = Math.round((ldDistKm / 100) * fuelPer100km * uhaulGasPrice * ldTruckCount * 100) / 100
                const ldInsurance     = Math.round(20 * 3 * ldTruckCount * 100) / 100
                const ldBlankets      = Math.round((DEFAULT_BLANKET_BAGS[ldTruckSize] ?? 6) * ldTruckCount * UHAUL_BLANKET_BAG_COST * 100) / 100
                const ldStretchWrap   = 25 * ldTruckCount
                const ldSubtotalHST   = Math.round((uhaulPerTruck * ldTruckCount + ldInsurance + ldBlankets + ldStretchWrap) * 0.13 * 100) / 100
                const ldTruckTotal    = uhaulPerTruck > 0 ? Math.round((uhaulPerTruck * ldTruckCount + ldFuel + ldInsurance + ldBlankets + ldStretchWrap + ldSubtotalHST) * 100) / 100 : 0
                const ldTotalCost     = uhaulPerTruck > 0 ? Math.round((ldTruckTotal + ldCrewReturnCost + ldLabor) * 100) / 100 : 0
                const ldRevenue       = quoteModalTotals.subtotal || 0
                const ldGrossProfit   = ldTotalCost > 0 ? Math.round((ldRevenue - ldTotalCost) * 100) / 100 : 0
                const ldMarginPct     = ldRevenue > 0 && ldTotalCost > 0 ? Math.round((ldGrossProfit / ldRevenue) * 1000) / 10 : 0
                const ldFloor         = ldTotalCost > 0 ? Math.round(ldTotalCost / 0.60 * 100) / 100 : 0
                const ldTarget        = ldTotalCost > 0 ? Math.round(ldTotalCost / 0.50 * 100) / 100 : 0
                const profitColor     = ldMarginPct >= 45 ? 'text-emerald-700' : ldMarginPct >= 30 ? 'text-amber-700' : 'text-rose-700'
                // Google search — reliable way to find current U-Haul pricing
                const originQ = originCity || originAddress?.split(',')[0] || ''
                const destQ   = destCity || destAddress?.split(',')[0] || ''
                const uhaulUrl = `https://www.google.com/search?q=uhaul+one+way+26ft+truck+${encodeURIComponent(originQ)}+to+${encodeURIComponent(destQ)}`

                return (
                  <div className="border border-[var(--app-line)] rounded-[10px] overflow-hidden">
                    {/* Header */}
                    <button type="button" onClick={() => setUhaulOpen(o => !o)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 bg-[var(--app-surface)] hover:bg-[var(--app-line)]/40 transition text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-[var(--app-ink)]">Live Margin</span>
                        <span className="text-[10px] text-[var(--app-muted)]">Long distance · {ldDistKm}km one-way</span>
                        {conjointInventoryPending ? (
                          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-semibold text-amber-700 ring-1 ring-amber-200">
                            Pending {conjointPendingLabel} inventory
                          </span>
                        ) : null}
                      </div>
                      <div className="flex items-center gap-2">
                        {ldTotalCost > 0
                          ? <span className={`text-xs font-bold ${profitColor}`}>{formatMoney(ldGrossProfit)} · {ldMarginPct.toFixed(1)}%</span>
                          : <span className="text-[10px] text-amber-700">Enter U-Haul price to see margin</span>
                        }
                        <span className="text-[var(--app-muted)] text-[10px]">{uhaulOpen ? '▲' : '▼'}</span>
                      </div>
                    </button>

                    {uhaulOpen && (
                      <div className="px-3.5 pb-3.5 pt-2 bg-white space-y-3">

                        {/* U-Haul price input */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)]">🚛 U-Haul One-Way Quote (per truck)</div>
                            <a href={uhaulUrl} target="_blank" rel="noopener noreferrer"
                              className="text-[10px] font-semibold text-[var(--app-accent)] hover:underline"
                            >Check price on Google →</a>
                          </div>
                          <div className="relative">
                            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-[var(--app-muted)]">$</span>
                            <input type="number" min={0} step={50} value={uhaulInputPerTruck}
                              onChange={e => {
                            const v = e.target.value
                            setUhaulInputPerTruck(v)
                            setUhaulInputIsEstimate(false)
                            const num = Number(v)
                            if (num > 0) onUhaulPriceChange?.(num)
                          }}
                              placeholder="Enter from uhaul.com" className="crm-input pl-5 w-full text-sm font-semibold"
                            />
                          </div>
                          {uhaulInputIsEstimate && <div className="text-[9px] text-amber-700 mt-0.5">Auto-estimated · verify on uhaul.com (weekday rates ~50% cheaper than weekends)</div>}
                        </div>

                        {/* Itemized cost breakdown */}
                        {uhaulPerTruck > 0 && (
                          <>
                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">🚛 U-Haul Job Cost</div>
                              <div className="space-y-1">
                                {[
                                  [`${ldTruckCount}× one-way rental`, uhaulPerTruck * ldTruckCount],
                                  [`Fuel (~${Math.round(ldDistKm * fuelPer100km / 100)}L @ $${uhaulGasPrice.toFixed(2)}/L)`, ldFuel],
                                  [`SafeMove (3 days × ${ldTruckCount})`, ldInsurance],
                                  [`Blankets + stretch wrap`, ldBlankets + ldStretchWrap],
                                  [`HST 13% (excl. fuel)`, ldSubtotalHST],
                                ].map(([label, val]) => (
                                  <div key={String(label)} className="flex justify-between text-xs">
                                    <span className="text-[var(--app-muted)]">{label}</span>
                                    <span className="font-medium text-[var(--app-ink)]">{formatMoney(Number(val))}</span>
                                  </div>
                                ))}
                                <div className="flex justify-between text-xs font-semibold border-t border-[var(--app-line)] pt-1.5">
                                  <span>U-Haul total</span>
                                  <span>{formatMoney(ldTruckTotal)}</span>
                                </div>
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">
                                👷 Labour {crewFliesBack ? '(load + drive + unload only — crew flies back)' : '(full day on clock)'}
                              </div>
                              <div className="text-[10px] text-[var(--app-muted)]">
                                Load {ldLoadHours}h + Drive {ldDriveOneWay}h + Unload {ldUnloadHours}h
                                {crewFliesBack ? ` = ${ldTotalLaborH}h (no return drive — crew flies)` : ` + Return ${ldDriveOneWay}h = ${ldTotalLaborH}h`}
                              </div>
                              <div className="flex justify-between text-xs mt-1 font-semibold">
                                <span>{ldCrewSize} movers × {ldTotalLaborH}h @ $25/hr</span>
                                <span>{formatMoney(ldLabor)}</span>
                              </div>
                            </div>

                            <div>
                              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--app-muted)] mb-1.5">📦 Miscellaneous</div>
                              <div className="space-y-1">
                                <div className="flex justify-between text-xs">
                                  <span className="text-[var(--app-muted)]">
                                    {crewFliesBack
                                      ? `Crew flights home (${ldCrewSize} × ~$${flightCostPerPerson})`
                                      : `Crew vehicle gas return (~${ldDistKm} km)`}
                                  </span>
                                  <span className="font-medium text-[var(--app-ink)]">{formatMoney(ldCrewReturnCost)}</span>
                                </div>
                              </div>
                            </div>

                            <div className="border-t border-[var(--app-line)] pt-2 space-y-1">
                              <div className="flex justify-between text-xs"><span className="text-[var(--app-muted)]">Revenue (pre-tax)</span><span>{formatMoney(ldRevenue)}</span></div>
                              <div className="flex justify-between text-xs"><span className="text-[var(--app-muted)]">Total cost</span><span>{formatMoney(ldTotalCost)}</span></div>
                              <div className={`flex justify-between text-sm font-bold pt-0.5 ${profitColor}`}>
                                <span>Gross profit</span>
                                <span>{formatMoney(ldGrossProfit)} ({ldMarginPct.toFixed(1)}%)</span>
                              </div>
                            </div>

                            {ldTotalCost > 0 && (() => {
                              const ldCeiling   = Math.round(ldTotalCost / 0.40 * 100) / 100  // 60% margin
                              const ldFloorPx   = Math.round(ldTotalCost / 0.60 * 100) / 100  // 40% margin
                              const ldSelected  = Math.round(ldTotalCost / (1 - ldMarginTarget / 100) * 100) / 100
                              const ldSelectedHST = Math.round(ldSelected * 1.13 * 100) / 100
                              const selMargin   = ldMarginTarget
                              const marginColor = selMargin >= 55 ? 'text-emerald-700' : selMargin >= 40 ? 'text-amber-700' : 'text-rose-600'
                              return (
                                <div className="border-t border-[var(--app-line)] pt-3 space-y-3">
                                  <div className="flex items-center justify-between text-[10px] text-[var(--app-muted)]">
                                    <span>40% · {formatMoney(ldFloorPx)}</span>
                                    <span className="font-semibold text-[var(--app-ink)] text-xs">Price range</span>
                                    <span>60% · {formatMoney(ldCeiling)}</span>
                                  </div>
                                  <input
                                    type="range"
                                    min={40} max={60} step={1}
                                    value={ldMarginTarget}
                                    onChange={e => setLdMarginTarget(Number(e.target.value))}
                                    className="w-full accent-[#071421] h-1.5 cursor-pointer"
                                  />
                                  <div className="flex items-center justify-between">
                                    <div>
                                      <div className={`text-base font-bold ${marginColor}`}>{formatMoney(ldSelected)} + HST</div>
                                      <div className="text-[10px] text-[var(--app-muted)]">{formatMoney(ldSelectedHST)} total to customer · <span className={`font-semibold ${marginColor}`}>{selMargin}% margin</span></div>
                                    </div>
                                    <div className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selMargin >= 55 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : selMargin >= 40 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-rose-50 text-rose-600 border border-rose-200'}`}>
                                      {selMargin}%
                                    </div>
                                  </div>
                                  <button type="button"
                                    onClick={() => {
                                      onSetLineItems([{ description: 'Long-Distance Moving Service — All Inclusive', details: `U-Haul one-way · ${ldTruckCount} truck${ldTruckCount === 1 ? '' : 's'} · ${ldDistKm} km · loading, transport, unloading · packing assistance + free boxes included`, amount: ldSelected }])
                                      setOverrideInput(String(ldSelected)); setOverrideApplied(true); setBookTodayActive(false); setTenPctActive(false)
                                    }}
                                    className={`w-full rounded-[6px] px-3 py-2.5 text-[11px] font-semibold text-white transition ${selMargin >= 40 ? 'bg-[#071421] hover:bg-[#071421]/90' : 'bg-rose-500 hover:bg-rose-600'}`}
                                  >Apply — {formatMoney(ldSelected)} + HST ({selMargin}% margin)</button>
                                </div>
                              )
                            })()}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}

              {/* Discounts & Deals */}
              <div className="mt-4 space-y-2">

                {/* Price Override */}
                {overrideApplied && (
                  <div className="rounded-[8px] border border-amber-300 bg-amber-50 px-3 py-3 text-xs text-[var(--app-ink)]">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">Customer price override active</div>
                        <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                          Agreed customer total: {formatMoney(overridePricing.total)} including HST
                          {overrideTaxMode === 'plus_hst' ? ` · entered as ${formatMoney(overridePricing.subtotal)} + HST` : ' · entered as all-in'}
                        </div>
                        {pricingBreakdown ? (
                          <div className="mt-1 text-[11px] text-[var(--app-muted)]">
                            Current operating model: {pricingBreakdown.crewSize} movers · {pricingBreakdown.truckCount} truck{pricingBreakdown.truckCount === 1 ? '' : 's'} · about {pricingBreakdown.totalHours}h · {formatMoney(pricingBreakdown.totalHours * pricingBreakdown.crewRatePerHour)} calculated labour
                          </div>
                        ) : null}
                      </div>
                    <button
                      type="button"
                      onClick={() => {
                        setOverrideApplied(false)
                        setOverrideInput('')
                      }}
                        className="shrink-0 text-[10px] underline"
                    >
                      Clear
                    </button>
                    </div>
                  </div>
                )}

                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="text-xs font-semibold text-[var(--app-ink)]">Price Override</div>
                  <div className="text-[10px] leading-4 text-[var(--app-muted)]">
                    Choose what the amount means before entering it. There is no assumed default: the CRM will calculate HST exactly once and show the final customer total before you apply it.
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => { setOverrideTaxMode('plus_hst'); setOverrideApplied(false); setApprovedOverrideAmount(null) }} className={`rounded-[7px] border px-3 py-2 text-left ${overrideTaxMode === 'plus_hst' ? 'border-[#071421] bg-[#071421] text-white' : 'border-[var(--app-line)] bg-white text-[var(--app-ink)]'}`}>
                      <span className="block text-[11px] font-semibold">Price + HST</span>
                      <span className={`mt-0.5 block text-[9px] ${overrideTaxMode === 'plus_hst' ? 'text-white/65' : 'text-[var(--app-muted)]'}`}>Example: $1,600 becomes $1,808 total</span>
                    </button>
                    <button type="button" onClick={() => { setOverrideTaxMode('hst_included'); setOverrideApplied(false); setApprovedOverrideAmount(null) }} className={`rounded-[7px] border px-3 py-2 text-left ${overrideTaxMode === 'hst_included' ? 'border-[#071421] bg-[#071421] text-white' : 'border-[var(--app-line)] bg-white text-[var(--app-ink)]'}`}>
                      <span className="block text-[11px] font-semibold">HST included / all-in</span>
                      <span className={`mt-0.5 block text-[9px] ${overrideTaxMode === 'hst_included' ? 'text-white/65' : 'text-[var(--app-muted)]'}`}>Example: $1,600 stays $1,600 total</span>
                    </button>
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
                        placeholder={overrideTaxMode === 'plus_hst' ? 'e.g. 1600 + HST' : 'e.g. 1600 all-in'}
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
                      {!overrideTaxMode
                        ? <span className="font-semibold text-amber-700">Choose “Price + HST” or “HST included / all-in” above before applying this amount.</span>
                        : overrideTaxMode === 'plus_hst'
                        ? <><span className="font-semibold text-[var(--app-ink)]">{formatMoney(overridePricing.subtotal)} + {formatMoney(overridePricing.hst)} HST = {formatMoney(overridePricing.total)} customer total</span>.</>
                        : <>Customer total <span className="font-semibold text-[var(--app-ink)]">{formatMoney(overridePricing.total)}</span> = {formatMoney(overridePricing.subtotal)} pre-tax + {formatMoney(overridePricing.hst)} HST. Tax will not be added again.</>}
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
                      !overrideTaxMode ||
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
                      ...(route?.category === 'long-distance' || quoteType === 'long_distance' ? [
                        { label: 'Packing assist + free boxes', desc: 'Packing Assistance + Free Boxes (Long Distance)', details: 'Full packing assistance included — all boxes provided at no extra charge. Baked into the all-inclusive rate.' },
                      ] : []),
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
                      {blockingReadiness.length > 0 ? 'Scope follow-up needed' : 'Review before sending'}
                    </div>
                    <div className="mt-2 leading-5">
                      {blockingReadiness.length > 0
                        ? `${blockingReadiness.length} scope item${blockingReadiness.length === 1 ? '' : 's'} still need confirmation. You can send the estimate now as provisional and continue the conversation.`
                        : `${warningReadiness.length} non-blocking item${warningReadiness.length === 1 ? '' : 's'} should be reviewed.`}
                    </div>
                    <details className="mt-2 rounded-[6px] bg-white/70 px-2.5 py-2">
                      <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide">View missing details</summary>
                      <div className="mt-2 space-y-1 text-[11px] leading-4">{[...blockingReadiness, ...warningReadiness].slice(0, 6).map(item => <div key={`${item.label}-${item.detail}`}>• {item.label}</div>)}{blockingReadiness.length + warningReadiness.length > 6 ? <div>• +{blockingReadiness.length + warningReadiness.length - 6} more</div> : null}</div>
                    </details>
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
                        Send quote now — scope pending
                      </button>
                      <button
                        type="button"
                        onClick={() => void onSaveDraft({ quoteType, customerScope: captureCustomerScope() })}
                        disabled={quoteModalBusy || !quote}
                        className="rounded-[6px] border border-[var(--app-line)] bg-white px-2.5 py-1 text-[10px] font-semibold text-[var(--app-ink)] hover:border-[var(--app-ink)] disabled:opacity-50"
                      >
                        Save draft
                      </button>
                    </div>
                  </div>
                )}
                {liveMarginSummary && liveMarginSummary.liveMargin < 50 && liveMarginSummary.actualRevenue > 0 && !marginGateAck && (
                  <div className={`rounded-[8px] border px-3 py-3 ${
                    conjointInventoryPending
                      ? 'border-amber-200 bg-amber-50'
                      : liveMarginSummary.liveMargin < 40 ? 'border-rose-300 bg-rose-50' : 'border-amber-200 bg-amber-50'
                  }`}>
                    <div className={`text-xs font-bold ${
                      conjointInventoryPending
                        ? 'text-amber-800'
                        : liveMarginSummary.liveMargin < 40 ? 'text-rose-800' : 'text-amber-800'
                    }`}>
                      {conjointInventoryPending
                        ? `Pricing provisional — waiting on ${conjointPendingLabel} inventory`
                        : liveMarginSummary.liveMargin < 40 ? 'Low margin — manager review required' : 'Below target margin'}
                    </div>
                    <div className={`mt-1 text-[11px] ${
                      conjointInventoryPending
                        ? 'text-amber-700'
                        : liveMarginSummary.liveMargin < 40 ? 'text-rose-700' : 'text-amber-700'
                    }`}>
                      {conjointInventoryPending
                        ? `Current margin is ${liveMarginSummary.liveMargin.toFixed(1)}% from known inventory only. Add MLS/photos/manual list for ${conjointPendingLabel}; price, trucks, timing, and margin will recalculate automatically.`
                        : `This quote is at ${liveMarginSummary.liveMargin.toFixed(1)}% margin. Target is 65%+. Revenue ${formatMoney(liveMarginSummary.actualRevenue)} — Costs ${formatMoney(liveMarginSummary.totalCost)} — Profit ${formatMoney(liveMarginSummary.liveProfit)}.`}
                    </div>
                    <button
                      type="button"
                      onClick={() => setMarginGateAck(true)}
                      className={`mt-2 w-full rounded-[6px] px-3 py-1.5 text-[11px] font-semibold ${
                        conjointInventoryPending
                          ? 'bg-amber-700 text-white hover:bg-amber-800'
                          : liveMarginSummary.liveMargin < 40 ? 'bg-rose-700 text-white hover:bg-rose-800' : 'bg-amber-700 text-white hover:bg-amber-800'
                      }`}
                    >
                      {conjointInventoryPending ? 'Continue with current inventory' : 'I understand — send anyway'}
                    </button>
                  </div>
                )}
                <button onClick={() => estimateView === 'simple' ? void handlePreviewSend() : goToStage('review')} disabled={quoteModalBusy || routeBusy || !quote || (contributionPlan.isMajorMove && quoteModalTotals.subtotal < contributionPlan.minimumAuthorizedPrice && !marginGateAck) || (conjointInventoryPending && !marginGateAck) || (!conjointInventoryPending && liveMarginSummary !== null && liveMarginSummary.liveMargin < 50 && liveMarginSummary.actualRevenue > 0 && !marginGateAck)} className="w-full justify-center rounded-[8px] bg-[var(--app-accent)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-60 transition-opacity">
                  {routeBusy ? 'Calculating route…' : quoteModalBusy ? 'Saving...' : estimateView === 'simple' ? 'Preview & send quote →' : 'Review customer scope →'}
                </button>
                <button onClick={() => void onSaveDraft({ conditionalClause: conditionalClauseEnabled ? conditionalClauseText : undefined, quoteType, customerScope: captureCustomerScope() })} disabled={quoteModalBusy || !quote} className="crm-button-dark w-full justify-center disabled:opacity-60">
                  Save Draft
                </button>

                {/* Conditional Truck Clause */}
                <div className="rounded-[8px] border border-[var(--app-line)] bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs font-semibold text-[var(--app-ink)]">Conditional Clause</div>
                    <button type="button"
                      onClick={() => {
                        const next = !conditionalClauseEnabled
                        setConditionalClauseEnabled(next)
                        if (next && !conditionalClauseText) {
                          const truckCount = pricingBreakdown?.truckCount || 1
                          const clauseCubicFeet = conjointMode
                            ? (conjointMetrics.totalCubicFeet || pricingBreakdown?.totalCubicFeet || 0)
                            : (pricingBreakdown?.totalCubicFeet || 0)
                          const extraTruck = UHAUL_DAILY_RATES[truckSizeFromCubicFeet(clauseCubicFeet)] ?? 49.99
                          setConditionalClauseText(`Estimate based on ${truckCount} × 26ft truck. If a 2nd truck is required on move day (e.g. basement or garage items exceed capacity), additional cost: ~$${Math.round((extraTruck * 1.13 + 150) / 10) * 10} (truck + mileage, +HST). You will be contacted before any 2nd truck is dispatched.`)
                        }
                      }}
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold transition ${conditionalClauseEnabled ? 'bg-amber-600 text-white' : 'bg-[var(--app-line)] text-[var(--app-muted)]'}`}
                    >
                      {conditionalClauseEnabled ? 'On' : 'Off'}
                    </button>
                  </div>
                  {conditionalClauseEnabled && (
                    <>
                      <textarea
                        value={conditionalClauseText}
                        onChange={e => setConditionalClauseText(e.target.value)}
                        rows={3}
                        className="crm-input w-full text-xs resize-none"
                        placeholder="Conditional clause shown on customer quote..."
                      />
                      <div className="text-[10px] text-[var(--app-muted)]">Shown on customer quote below the price. Save Draft to persist.</div>
                    </>
                  )}
                </div>
                {/* Inventory verification quick-link */}
                {(() => {
                  const token = lead.surveyToken && lead.surveyToken !== 'set' ? lead.surveyToken : null
                  const url = token ? `${typeof window !== 'undefined' ? window.location.origin : 'https://go.quote2move.com'}/survey/${token}` : null
                  if (url) {
                    return (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(url)}
                          className="flex-1 rounded-[8px] border border-[var(--app-line)] py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                        >
                          🔗 Copy Inventory Link
                        </button>
                        <a href={url} target="_blank" rel="noopener noreferrer"
                          className="rounded-[8px] border border-[var(--app-line)] px-3 py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                        >
                          Preview
                        </a>
                      </div>
                    )
                  }
                  return (
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await fetch(`/api/sales/leads/${lead.id}/survey`, {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          credentials: 'include', body: JSON.stringify({ skipSms: true }),
                        })
                        const d = await res.json() as { surveyUrl?: string }
                        if (d.surveyUrl) void navigator.clipboard.writeText(d.surveyUrl)
                      }}
                      className="w-full rounded-[8px] border border-[var(--app-line)] py-2 text-xs font-medium text-[var(--app-muted)] hover:border-[var(--app-ink)] hover:text-[var(--app-ink)] transition"
                    >
                      🔗 Send Inventory Verification Link
                    </button>
                  )
                })()}
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
      {lightbox && (
        <PhotoLightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onNavigate={index => setLightbox(lb => lb ? { ...lb, index } : null)}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}
