import type {
  CRMLead,
  CRMQuote,
  JobFactors,
  JobPenalty,
  PricingBreakdown,
  CRMClient,
  FollowUpLog,
  InventoryItem,
  EstimateRouteContext,
  QuoteLineItem,
  QuoteStatus,
  SalesDashboardSummary,
  SalesLeadStage,
} from './types'

export const SALES_LEAD_STAGES: Array<{ id: SalesLeadStage; label: string }> = [
  { id: 'new', label: 'New Lead' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'estimate_scheduled', label: 'Estimate Scheduled' },
  { id: 'estimate_completed', label: 'Estimate Done' },
  { id: 'pricing', label: 'Building Quote' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'nurture', label: 'Shopping Around' },
  { id: 'booked', label: 'Booked' },
  { id: 'lost', label: 'Lost' },
]

export const LOST_REASONS: Array<{ id: string; label: string }> = [
  { id: 'price', label: 'Price — Too Expensive' },
  { id: 'timing', label: 'Timing — Not Ready Yet' },
  { id: 'competitor', label: 'Went with Competitor' },
  { id: 'no_response', label: 'No Response / Ghost' },
  { id: 'not_a_fit', label: 'Not a Fit' },
  { id: 'cancelled_move', label: 'Cancelled Move' },
]

export const LEAD_CONTEXT_FLAGS: Array<{ id: string; label: string }> = [
  { id: 'comparing_quotes', label: 'Comparing Quotes' },
  { id: 'waiting_house_sale', label: 'Waiting on House Sale' },
  { id: 'move_date_uncertain', label: 'Move Date Uncertain' },
  { id: 'budget_concern', label: 'Budget Concern' },
  { id: 'ready_to_book', label: 'Ready to Book' },
  { id: 'need_storage', label: 'Needs Storage' },
]

export const DEPOSIT_METHODS = ['E-Transfer', 'Credit Card', 'Cash', 'Cheque', 'Other']

export const QUOTE_STATUSES: Array<{ id: QuoteStatus; label: string }> = [
  { id: 'draft', label: 'Draft' },
  { id: 'sent', label: 'Sent' },
  { id: 'viewed', label: 'Viewed' },
  { id: 'accepted', label: 'Accepted' },
  { id: 'declined', label: 'Declined' },
  { id: 'invoiced', label: 'Invoiced' },
]

export function uid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}`
}

export function formatMoney(value: number) {
  return `$${Number(value || 0).toLocaleString('en-CA', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export const SALES_TIME_ZONE = 'America/Toronto'

export function dateStamp(value: Date = new Date(), timeZone = SALES_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value)

  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value

  if (!year || !month || !day) {
    return value.toISOString().slice(0, 10)
  }

  return `${year}-${month}-${day}`
}

export function formatDate(value?: string) {
  if (!value) return '—'
  try {
    return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleDateString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return value
  }
}

export function formatDateTime(value?: string) {
  if (!value) return '—'
  try {
    return new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleString('en-CA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return value
  }
}

export function genQuoteNumber(clientName: string) {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const initials = clientName
    .split(' ')
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 3)
  return `QT-${y}-${m}${d}-${initials || 'CLI'}`
}

export function validUntil(quote: CRMQuote) {
  if (!quote.createdAt) return '—'
  const base = new Date(`${quote.createdAt}T12:00:00`)
  base.setDate(base.getDate() + (quote.validDays || 30))
  return formatDate(base.toISOString().slice(0, 10))
}

export function calculateLeadScore(lead: CRMLead) {
  let score = 0
  if (lead.source === 'referral') score += 25
  else if (lead.source === 'google') score += 20
  else if (lead.source === 'direct_mail') score += 15
  else if (lead.source === 'repeat') score += 30

  if (lead.stage === 'quoted') score += 20
  else if (lead.stage === 'booked') score += 40
  else if (lead.stage === 'pricing') score += 15
  else if (lead.stage === 'nurture') score += 8
  else if (lead.stage === 'contacted') score += 10

  if ((lead.inventory || []).length > 0) score += 10
  if (lead.phone) score += 5
  if (lead.quoteId) score += 15

  const daysSince = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince < 3) score += 10
  else if (daysSince > 14) score -= 10

  return Math.max(0, Math.min(100, score))
}

export function normalizeLead(lead: CRMLead): CRMLead {
  return {
    ...lead,
    stage: lead.stage || 'new',
    callLogs: Array.isArray(lead.callLogs) ? lead.callLogs : [],
    inventory: Array.isArray(lead.inventory) ? lead.inventory : [],
    totalItems: lead.totalItems ?? lead.inventory?.length ?? 0,
    totalCubicFeet: lead.totalCubicFeet ?? 0,
    totalWeightLbs: lead.totalWeightLbs ?? 0,
    createdAt: lead.createdAt || new Date().toISOString().slice(0, 10),
    leadScore: lead.leadScore ?? calculateLeadScore(lead),
  }
}

export function normalizeClient(client: CRMClient): CRMClient {
  return {
    ...client,
    createdAt: client.createdAt || new Date().toISOString().slice(0, 10),
  }
}

export function normalizeQuote(quote: CRMQuote): CRMQuote {
  return {
    ...quote,
    status: quote.status || 'draft',
    lineItems: Array.isArray(quote.lineItems) ? quote.lineItems : [],
    crewSize: Number(quote.crewSize || 0) || undefined,
    estimatedHours: Number(quote.estimatedHours || 0) || undefined,
    truckCount: Number(quote.truckCount || 0) || undefined,
    estimatedWeightLbs: Number(quote.estimatedWeightLbs || 0) || undefined,
    longDistanceDistanceKm: Number(quote.longDistanceDistanceKm || 0) || undefined,
    longDistanceTruckCost: Number(quote.longDistanceTruckCost || 0) || undefined,
    longDistanceGasCost: Number(quote.longDistanceGasCost || 0) || undefined,
    longDistanceInsuranceCost: Number(quote.longDistanceInsuranceCost || 0) || undefined,
    longDistanceMiscCost: Number(quote.longDistanceMiscCost || 0) || undefined,
    longDistanceMarkupRate: Number(quote.longDistanceMarkupRate || 0) || undefined,
    discountAmount: Number(quote.discountAmount || 0),
    discountLabel: quote.discountLabel || '',
    subtotal: Number(quote.subtotal || 0),
    hst: Number(quote.hst || 0),
    total: Number(quote.total || 0),
    deposit: Number(quote.deposit || 0),
    balance: Number(quote.balance || 0),
    validDays: quote.validDays || 30,
    createdAt: quote.createdAt || new Date().toISOString().slice(0, 10),
  }
}

// Base crew rates for 1-truck jobs (customer-facing $/hr)
const LOCAL_CREW_RATES: Record<number, number> = {
  1: 100,
  2: 160,
  3: 225,
  4: 270,
  5: 325,
  6: 375,
}

// Truck-aware combined rates: key = `${crewSize}-${truckCount}`
// 2-truck jobs get a built-in volume discount vs raw base × multiplier
// because the customer is paying for speed/efficiency, not just headcount
const LOCAL_CREW_RATES_TRUCK_AWARE: Record<string, number> = {
  '1-1': 100,
  '2-1': 160,
  '3-1': 225,
  '4-1': 270,   // rare — 4 movers, 1 large truck
  '4-2': 350,   // standard 2-truck job — built-in efficiency discount
  '5-2': 395,
  '6-2': 445,
  '6-3': 530,
  '7-3': 580,
  '8-3': 630,
}

const LABOR_ONLY_CREW_RATES: Record<number, number> = {
  1: 100,
  2: 120,
  3: 150,
  4: 200,
  5: 250,
  6: 300,
}

const PACKING_CREW_RATES: Record<number, number> = {
  1: 90,
  2: 150,
  3: 150,
  4: 200,
  5: 250,
  6: 300,
}

function roundQuarterHour(value: number) {
  return Math.round(Math.max(0, value) * 4) / 4
}

function roundCurrency(value: number) {
  return Math.round(Number(value || 0) * 100) / 100
}

export function getCrewRate(
  crewSize: number,
  moveType?: CRMLead['moveType'] | CRMQuote['moveType'],
  truckCount?: number
) {
  const normalizedCrew = Math.max(1, Math.min(8, Math.round(crewSize || 3)))
  const normalizedTrucks = Math.max(1, Math.round(truckCount || 1))

  // For standard local moves, use the truck-aware table so 2-truck jobs get
  // the built-in efficiency discount (e.g. 4 movers + 2 trucks = $350/hr, not $405)
  if (!moveType || moveType === 'residential' || moveType === 'commercial' || moveType === 'senior' || moveType === 'long-distance') {
    const key = `${normalizedCrew}-${normalizedTrucks}`
    if (LOCAL_CREW_RATES_TRUCK_AWARE[key] !== undefined) {
      return LOCAL_CREW_RATES_TRUCK_AWARE[key]
    }
    // Fallback: base rate × truck multiplier for unlisted combos
    const baseRate = LOCAL_CREW_RATES[normalizedCrew] || LOCAL_CREW_RATES[6] + (normalizedCrew - 6) * 50
    return Math.round(baseRate * getTruckRateMultiplier(normalizedTrucks))
  }

  const rateTable =
    moveType === 'labor-only'
      ? LABOR_ONLY_CREW_RATES
      : moveType === 'packing'
        ? PACKING_CREW_RATES
        : LOCAL_CREW_RATES
  if (rateTable[normalizedCrew]) return rateTable[normalizedCrew]
  if (normalizedCrew > 4) {
    return (rateTable[4] || rateTable[3]) + (normalizedCrew - 4) * 60
  }
  return rateTable[3]
}

export function getDefaultDepositRate(moveType?: CRMLead['moveType'] | CRMQuote['moveType']) {
  return moveType === 'long-distance' ? 0.4 : 0.2
}

export function suggestCrewSize(totalWeightLbs: number, totalCubicFeet: number, includedInventory: InventoryItem[]) {
  const heavyKeywords = [
    'sectional',
    'piano',
    'safe',
    'pool table',
    'treadmill',
    'elliptical',
    'dresser',
    'wardrobe',
    'china cabinet',
    'hutch',
    'sofa',
    'couch',
    'king bed',
  ]

  const oversizedCount = includedInventory.reduce((count, item) => {
    const name = (item.name || item.item || '').toLowerCase()
    return heavyKeywords.some(keyword => name.includes(keyword)) ? count + Math.max(1, Number(item.qty || 1)) : count
  }, 0)

  if (totalWeightLbs >= 6500 || totalCubicFeet >= 1400 || oversizedCount >= 10) return 4
  if (totalWeightLbs >= 2200 || totalCubicFeet >= 550 || oversizedCount >= 4) return 3
  if (totalWeightLbs >= 700 || totalCubicFeet >= 180) return 2
  return 1
}

// 26ft box truck: 1,600–1,800 cu ft actual (U-Haul lists 1,682 cu ft)
// Local: 1,600 cu ft practical limit (less tight packing, items stay accessible)
// Long-distance: 1,800 cu ft (everything wrapped + stacked, maximum efficiency)
// Payload: 10,000–12,859 lbs actual; use 10,000 as safe operational limit
const TRUCK_CAPACITY_CF = 1600
const LD_TRUCK_CAPACITY_CF = 1800
const TRUCK_PAYLOAD_LBS = 10000
const TWO_TRIP_ZONE_CF = 1000
const EXTRA_TRUCK_RATE_MULTIPLIER = 1.5
const THREE_TRUCK_RATE_MULTIPLIER = 2.05
const LABOR_COST_PER_MOVER_HOUR = 20
const TRUCK_DAILY_COST = 50          // rental/depreciation per truck per day
const TRUCK_OPS_COST_PER_KM = 1.1   // fuel + wear at ~$1.10 CAD/km per truck

// Items that almost always require disassembly/reassembly — auto-detected from inventory scan
// NOTE: wardrobes are excluded — they are typically built-in and stay with the property
const DISASSEMBLY_KEYWORDS = [
  'bed frame',
  'bunk bed',
  'crib',
  'dining table',
  'desk',
  'china cabinet',
  'hutch',
  'trampoline',
]

function getTruckRateMultiplier(truckCount: number) {
  if (truckCount >= 3) return THREE_TRUCK_RATE_MULTIPLIER
  if (truckCount === 2) return EXTRA_TRUCK_RATE_MULTIPLIER
  return 1
}

function estimateRequiredTrucks(totalCubicFeet: number, totalWeightLbs: number) {
  const byVolume = Math.max(1, Math.ceil((totalCubicFeet || 0) / TRUCK_CAPACITY_CF))
  const byWeight = totalWeightLbs > 0 ? Math.max(1, Math.ceil(totalWeightLbs / TRUCK_PAYLOAD_LBS)) : 1
  return Math.max(byVolume, byWeight)
}

export function suggestDisassemblyCount(inventory: InventoryItem[]): number {
  return inventory.reduce((count, item) => {
    const name = (item.name || item.item || '').toLowerCase()
    if (item.included === false) return count
    return DISASSEMBLY_KEYWORDS.some(keyword => name.includes(keyword))
      ? count + Math.max(1, Number(item.qty || 1))
      : count
  }, 0)
}

export function suggestTruckCount(totalCubicFeet: number, totalWeightLbs = 0, moveType?: CRMLead['moveType']) {
  if (moveType === 'long-distance') {
    // Long-distance trucks are packed more efficiently — 26ft truck handles ~1,700 cu ft
    const byVolume = Math.max(1, Math.ceil((totalCubicFeet || 0) / LD_TRUCK_CAPACITY_CF))
    const byWeight = totalWeightLbs > 0 ? Math.max(1, Math.ceil(totalWeightLbs / TRUCK_PAYLOAD_LBS)) : 1
    return Math.max(1, Math.max(byVolume, byWeight))
  }
  return Math.max(1, estimateRequiredTrucks(totalCubicFeet, totalWeightLbs))
}

export function computeJobPenalties(factors: JobFactors): {
  penalties: JobPenalty[]
  extraHours: number
  extraCubicFeet: number
} {
  const penalties: JobPenalty[] = []

  // Origin access
  const originFloors = factors.originFloors || 1
  if (originFloors >= 2 && !factors.originHasElevator) {
    penalties.push({
      label: `Origin – ${originFloors}-storey, stairs (no elevator)`,
      hours: (originFloors - 1) * 0.35,
      category: 'access',
    })
  }
  if (factors.originHasElevator && !factors.originElevatorReserved) {
    penalties.push({ label: 'Origin – elevator not reserved (shared, wait time)', hours: 0.75, category: 'access' })
  }
  if (factors.originParkingOk === false) {
    penalties.push({ label: 'Origin – limited truck access (no direct parking)', hours: 0.75, category: 'access' })
  }

  // Destination access
  const destFloors = factors.destFloors || 1
  if (destFloors >= 2 && !factors.destHasElevator) {
    penalties.push({
      label: `Destination – ${destFloors}-storey, stairs (no elevator)`,
      hours: (destFloors - 1) * 0.35,
      category: 'access',
    })
  }
  if (factors.destHasElevator && !factors.destElevatorReserved) {
    penalties.push({ label: 'Destination – elevator not reserved (shared, wait time)', hours: 0.75, category: 'access' })
  }
  if (factors.destParkingOk === false) {
    penalties.push({ label: 'Destination – limited truck access', hours: 0.75, category: 'access' })
  }

  // Packing status
  if (factors.packingStatus === 'partial') {
    penalties.push({ label: 'Partial packing – crew packing assist needed', hours: 1.5, category: 'packing' })
  } else if (factors.packingStatus === 'not-started') {
    penalties.push({ label: 'Full pack – customer has not started packing', hours: 3.5, category: 'packing' })
  }

  // Specialty items
  if (factors.hasPiano) {
    penalties.push({ label: 'Piano – specialty wrapping and handling', hours: 1.5, category: 'specialty' })
  }
  if (factors.hasSafe) {
    penalties.push({ label: 'Heavy safe – dolly required, specialty handling', hours: 0.75, category: 'specialty' })
  }

  // Disassembly / reassembly
  const disassemblyCount = factors.disassemblyItemCount || 0
  if (disassemblyCount > 0) {
    penalties.push({
      label: `Disassembly + reassembly – ${disassemblyCount} furniture assembly item${disassemblyCount > 1 ? 's' : ''}`,
      hours: Math.round(disassemblyCount * 0.33 * 4) / 4,
      category: 'disassembly',
      details: ['Beds, dining tables, hutches, desks, trampolines, similar freestanding assemblies'],
    })
  }

  // Hidden inventory — adds cubic feet (no direct hour penalty, feeds back into labor calc)
  const extraCubicFeet =
    (factors.garageCubicFeet || 0) +
    (factors.basementCubicFeet || 0) +
    (factors.shedCubicFeet || 0) +
    (factors.estimatedBoxes || 0) * 1.5

  if ((factors.garageCubicFeet || 0) > 0) {
    penalties.push({ label: `Garage – ${factors.garageCubicFeet} cu ft (not in MLS photos)`, hours: 0, category: 'hidden_inventory' })
  }
  if ((factors.basementCubicFeet || 0) > 0) {
    penalties.push({ label: `Basement – ${factors.basementCubicFeet} cu ft (not in MLS photos)`, hours: 0, category: 'hidden_inventory' })
  }
  if ((factors.shedCubicFeet || 0) > 0) {
    penalties.push({ label: `Shed – ${factors.shedCubicFeet} cu ft (not in MLS photos)`, hours: 0, category: 'hidden_inventory' })
  }
  if ((factors.estimatedBoxes || 0) > 0) {
    penalties.push({
      label: `${factors.estimatedBoxes} boxes (~${Math.round((factors.estimatedBoxes || 0) * 1.5)} cu ft) – customer estimate`,
      hours: 0,
      category: 'hidden_inventory',
    })
  }

  // Items we do NOT move — flag only
  if (factors.hasHotTub) {
    penalties.push({ label: '⚠ Hot tub flagged – Saturn Star does not move hot tubs', hours: 0, isFlagOnly: true, category: 'warning' })
  }
  if (factors.hasPoolTable) {
    penalties.push({ label: '⚠ Pool table flagged – Saturn Star does not move pool tables', hours: 0, isFlagOnly: true, category: 'warning' })
  }

  const extraHours = penalties.filter(p => !p.isFlagOnly).reduce((sum, p) => sum + p.hours, 0)
  return { penalties, extraHours, extraCubicFeet }
}

export function normalizeFollowUp(log: FollowUpLog): FollowUpLog {
  const stamp = log.createdAt || log.date || new Date().toISOString()
  return {
    ...log,
    createdAt: stamp,
    date: log.date || stamp,
    type: log.type || 'note',
  }
}

export function syncLeadFromQuoteStatus(lead: CRMLead, quote: CRMQuote): CRMLead {
  const nextStage =
    quote.status === 'accepted' || quote.status === 'invoiced'
      ? 'booked'
      : quote.status === 'declined'
        ? lead.stage === 'booked'
          ? 'booked'
          : 'lost'
        : quote.status === 'sent' || quote.status === 'viewed'
          ? 'quoted'
          : quote.status === 'draft'
            ? lead.stage === 'booked'
              ? 'booked'
              : lead.stage === 'lost'
                ? 'lost'
                : 'pricing'
          : lead.stage === 'booked'
            ? 'booked'
            : lead.stage === 'lost'
              ? 'lost'
              : 'contacted'

  return normalizeLead({
    ...lead,
    quoteId: quote.id,
    stage: nextStage,
  })
}

// Full-service residential move labor rates (lbs per man-hour)
// Load = wrap furniture + carry out + stack in truck
// Unload = carry in + unwrap + place in rooms (~1.5× faster than loading)
// Calibrated: 3 movers load a 1,400 cu ft house in ~5h, unload in ~3.5h
const LOAD_RATE_LBS_PER_MAN_HOUR = 260
const UNLOAD_RATE_LBS_PER_MAN_HOUR = 380
const LOAD_RATE_CF_PER_MAN_HOUR = 100   // cubic feet fallback when no weight data
const UNLOAD_RATE_CF_PER_MAN_HOUR = 150 // cubic feet fallback: unloading

export function estimateLeadQuote(
  lead: CRMLead,
  overrides?: Partial<
    Pick<
      CRMQuote,
      | 'crewSize'
      | 'estimatedHours'
      | 'truckCount'
      | 'estimatedWeightLbs'
      | 'longDistanceDistanceKm'
      | 'longDistanceTruckCost'
      | 'longDistanceGasCost'
      | 'longDistanceInsuranceCost'
      | 'longDistanceMiscCost'
      | 'longDistanceMarkupRate'
    >
  > & {
    driveHours?: number
    quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
    distanceKm?: number
    routeContext?: EstimateRouteContext
  },
  factors?: JobFactors
) {
  const resolvedQuoteType = overrides?.quoteType || lead.quoteType
  const isLongDistance = resolvedQuoteType === 'long_distance' || lead.moveType === 'long-distance'
  const isLaborOnly = resolvedQuoteType === 'labor_only' || resolvedQuoteType === 'storage' || lead.moveType === 'labor-only'
  const isPacking = resolvedQuoteType === 'packing_only' || lead.moveType === 'packing'
  const metrics = deriveInventoryMetrics(lead.inventory || [])
  const routeContext = overrides?.routeContext
  const routeCategory = routeContext?.routeCategory || (isLongDistance ? 'long-distance' : 'local')
  const pricingStatus = routeContext?.pricingStatus || 'ready'
  const missingRequirements = routeContext?.missingRequirements || []
  const missingDestination = pricingStatus === 'provisional' || missingRequirements.length > 0

  const autoDisassemblyCount = suggestDisassemblyCount(lead.inventory || [])

  // Detect which specific items need disassembly — listed by name for scope of work display
  const disassemblyItemNames = (lead.inventory || [])
    .filter(item => item.included !== false)
    .flatMap(item => {
      const name = (item.name || item.item || '').toLowerCase()
      if (!DISASSEMBLY_KEYWORDS.some(kw => name.includes(kw))) return []
      const qty = Math.max(1, Number(item.qty || 1))
      const displayName = item.name || item.item || ''
      return qty > 1 ? [`${qty}× ${displayName}`] : [displayName]
    })

  // Specialty items that ARE being moved (not flagged as "do not move")
  const specialtyItemFlags: string[] = []
  if (factors?.hasPiano ?? lead.jobFactors?.hasPiano) specialtyItemFlags.push('Upright Piano')
  if (factors?.hasSafe ?? lead.jobFactors?.hasSafe) specialtyItemFlags.push('Heavy Safe')

  const rawFactors = factors ?? lead.jobFactors
  const activeFactors: JobFactors | undefined = rawFactors
    ? {
        ...rawFactors,
        // Only auto-fill disassemblyItemCount if rep hasn't set it explicitly
        disassemblyItemCount: rawFactors.disassemblyItemCount ?? autoDisassemblyCount,
      }
    : autoDisassemblyCount > 0
      ? { disassemblyItemCount: autoDisassemblyCount }
      : undefined
  const { penalties, extraHours, extraCubicFeet } = activeFactors
    ? computeJobPenalties(activeFactors)
    : { penalties: [], extraHours: 0, extraCubicFeet: 0 }

  const baseCubicFeet = lead.totalCubicFeet || metrics.totalCubicFeet
  const totalCubicFeet = baseCubicFeet + extraCubicFeet
  const totalWeightLbs = Number(overrides?.estimatedWeightLbs || lead.totalWeightLbs || metrics.totalWeightLbs)
  const suggestedCrew = Number(overrides?.crewSize || suggestCrewSize(totalWeightLbs, totalCubicFeet, metrics.includedInventory))
  const suggestedTruckCount = suggestTruckCount(totalCubicFeet, totalWeightLbs, lead.moveType)
  const truckCount = Number(overrides?.truckCount || activeFactors?.truckCountOverride || suggestedTruckCount)
  const threeTruckReview = truckCount >= 3
  const crewMinimum = truckCount >= 3 ? 6 : truckCount === 2 ? 4 : 1
  const crewSizeOverride = activeFactors?.crewSizeOverride
  const crewSize = crewSizeOverride
    ? Math.max(crewSizeOverride, crewMinimum)  // honour override but never below truck minimum
    : overrides?.crewSize ? suggestedCrew : Math.max(suggestedCrew, crewMinimum)
  // Truck-aware rate: 2-truck jobs use LOCAL_CREW_RATES_TRUCK_AWARE which builds in
  // the efficiency discount (e.g. 4 movers + 2 trucks = $350/hr, not $270 × 1.5 = $405)
  const crewRate = getCrewRate(crewSize, lead.moveType, truckCount)
  const baseCrewRate = crewRate  // kept for cost estimate calculations
  const truckRateMultiplier = getTruckRateMultiplier(truckCount)  // kept for display only
  const longDistanceTruckCost = Number(overrides?.longDistanceTruckCost || 0)
  const longDistanceGasCost = Number(overrides?.longDistanceGasCost || 0)
  const longDistanceInsuranceCost = Number(overrides?.longDistanceInsuranceCost || 0)
  const longDistanceMiscCost = Number(overrides?.longDistanceMiscCost || 0)
  const longDistanceMarkupRate = Number(overrides?.longDistanceMarkupRate || 0)
  const originToDestHours = roundQuarterHour(
    routeContext?.originToDestinationHours ?? overrides?.driveHours ?? (isLongDistance ? 1.5 : 0.75)
  )
  const yardToOriginHours = roundQuarterHour(isLaborOnly ? 0 : routeContext?.yardToOriginHours ?? 0)
  const returnTripHours = roundQuarterHour(
    routeContext?.returnTripHours ??
      (routeCategory === 'long-distance' && !missingDestination ? originToDestHours : 0)
  )
  const billableDriveHours = roundQuarterHour(
    routeContext?.billableDriveHours ??
      (missingDestination
        ? 0
        : routeCategory === 'long-distance'
          ? originToDestHours + returnTripHours
          : isLaborOnly
            ? 0.5
            : yardToOriginHours + originToDestHours)
  )
  const operationalDriveHours = roundQuarterHour(
    routeContext?.operationalDriveHours ??
      (missingDestination
        ? 0
        : routeCategory === 'long-distance'
          ? yardToOriginHours + originToDestHours + returnTripHours
          : isLaborOnly
            ? 0.5
            : yardToOriginHours + originToDestHours)
  )
  const billableDistanceKm = routeContext?.billableDistanceKm ?? overrides?.distanceKm
  const operationalDistanceKm = routeContext?.operationalDistanceKm ?? billableDistanceKm
  const forcedSingleTruckTwoTrips =
    !missingDestination &&
    !isLongDistance &&
    !isPacking &&
    !isLaborOnly &&
    truckCount === 1 &&
    suggestedTruckCount >= 2
  const additionalTripDriveHours = forcedSingleTruckTwoTrips ? roundQuarterHour(returnTripHours + originToDestHours) : 0
  const additionalTripDistanceKm = forcedSingleTruckTwoTrips
    ? (routeContext?.returnTripDistanceKm || 0) + (routeContext?.originToDestinationDistanceKm || 0)
    : 0

  const loadHours =
    totalWeightLbs > 0
      ? totalWeightLbs / LOAD_RATE_LBS_PER_MAN_HOUR / Math.max(1, crewSize)
      : totalCubicFeet > 0
        ? totalCubicFeet / (LOAD_RATE_CF_PER_MAN_HOUR * Math.max(1, crewSize))
        : isLongDistance ? 4 : crewSize >= 3 ? 2.5 : 2

  const unloadHours =
    totalWeightLbs > 0
      ? totalWeightLbs / UNLOAD_RATE_LBS_PER_MAN_HOUR / Math.max(1, crewSize)
      : totalCubicFeet > 0
        ? totalCubicFeet / (UNLOAD_RATE_CF_PER_MAN_HOUR * Math.max(1, crewSize))
        : loadHours * 0.65

  const secondTripHandlingHours = forcedSingleTruckTwoTrips
    ? roundQuarterHour(loadHours * 0.5 + unloadHours * 0.4)
    : 0
  const rawLaborHours = loadHours + unloadHours
  const effectiveBillableDriveHours = roundQuarterHour(billableDriveHours + additionalTripDriveHours)
  const effectiveOperationalDriveHours = roundQuarterHour(operationalDriveHours + additionalTripDriveHours)
  const baseHours = roundQuarterHour(rawLaborHours + secondTripHandlingHours + effectiveBillableDriveHours)
  const preBufferHours = roundQuarterHour(baseHours + extraHours)
  const driveBufferHours = roundQuarterHour(routeCategory === 'long-distance' ? 0 : effectiveBillableDriveHours * 0.1)
  // Long-distance: no buffer — it's a planned full-day job, experienced crew, no padding needed
  const loadUnloadBufferHours = routeCategory === 'long-distance' ? 0 : roundQuarterHour((rawLaborHours + secondTripHandlingHours + extraHours) * 0.1)
  const bufferHours = roundQuarterHour(driveBufferHours + loadUnloadBufferHours)
  const estimatedHours = Math.max(3, Number(overrides?.estimatedHours || roundQuarterHour(preBufferHours + bufferHours)))
  const operationalPreBufferHours = roundQuarterHour(rawLaborHours + secondTripHandlingHours + effectiveOperationalDriveHours + extraHours)
  const operationalHours = roundQuarterHour(operationalPreBufferHours + loadUnloadBufferHours + (routeCategory === 'long-distance' ? 0 : driveBufferHours))
  const laborAmount = roundCurrency(estimatedHours * crewRate)
  const longDistanceOperationalBase = longDistanceTruckCost + longDistanceGasCost + longDistanceInsuranceCost + longDistanceMiscCost
  const longDistanceMarkupAmount = isLongDistance ? roundCurrency(longDistanceOperationalBase * (longDistanceMarkupRate / 100)) : 0
  const extraTruckAmount = 0
  const tripStrategy: PricingBreakdown['tripStrategy'] =
    truckCount >= 3 ? 'three_trucks' : forcedSingleTruckTwoTrips ? 'single_truck_two_trips' : truckCount === 2 ? 'two_trucks' : 'single_truck'

  let twoTripComparison: {
    crewSize: number
    totalHours: number
    totalAmount: number
    savings: number
    extraHours: number
    note: string
  } | null = null

  let multiTruckOption: PricingBreakdown['intelligenceFlags']['multiTruckOption'] = null

  if (!missingDestination && !isLongDistance && !isPacking && !isLaborOnly && (truckCount >= 2 || totalCubicFeet >= TWO_TRIP_ZONE_CF)) {
    const tripCrewSize = Math.max(3, Math.min(crewSize, 4))
    const oneTruckRate = roundCurrency(getCrewRate(tripCrewSize, lead.moveType))
    const reloadFactor = totalCubicFeet > TRUCK_CAPACITY_CF ? 0.5 : 0.35
    const secondTripHandlingHours = roundQuarterHour(loadHours * reloadFactor + unloadHours * reloadFactor * 0.85)
    const extraTripDriveHours = roundQuarterHour(originToDestHours * 2)
    const twoTripBaseHours = roundQuarterHour(rawLaborHours + billableDriveHours + secondTripHandlingHours + extraTripDriveHours + extraHours)
    const twoTripDriveBuffer = roundQuarterHour(extraTripDriveHours * 0.1)
    const twoTripLoadBuffer = roundQuarterHour((rawLaborHours + secondTripHandlingHours + extraHours) * 0.1)
    const twoTripHours = Math.max(3, roundQuarterHour(twoTripBaseHours + twoTripDriveBuffer + twoTripLoadBuffer))
    const twoTripAmount = roundCurrency(twoTripHours * oneTruckRate)
    const multiTruckAmount = laborAmount + longDistanceOperationalBase + longDistanceMarkupAmount
    const savings = roundCurrency(multiTruckAmount - twoTripAmount)
    twoTripComparison = {
      crewSize: tripCrewSize,
      totalHours: twoTripHours,
      totalAmount: twoTripAmount,
      savings,
      extraHours: roundQuarterHour(extraTripDriveHours + secondTripHandlingHours),
      note: savings > 0
        ? `1 truck, 2 trips saves ~${formatMoney(savings)} but adds ~${roundQuarterHour(extraTripDriveHours + secondTripHandlingHours)}h`
        : '2 trucks is more cost-effective for this load',
    }

    multiTruckOption = {
      totalHours: estimatedHours,
      totalAmount: laborAmount,
      truckCount,
      note: `${truckCount} trucks reduces repeat travel but carries a higher hourly rate`,
    }
  }

  const packingCrewSize = Math.max(2, Math.min(crewSize, 3))
  const packingCrewRate = PACKING_CREW_RATES[packingCrewSize] || PACKING_CREW_RATES[3]
  const packingHours = Math.max(3, roundQuarterHour(rawLaborHours))
  const packingDayAmount = roundCurrency(packingHours * packingCrewRate)
  const packingDayEstimate = {
    crewSize: packingCrewSize,
    hours: packingHours,
    amountBeforeHst: packingDayAmount,
    total: roundCurrency(packingDayAmount * 1.13),
    note: `${packingCrewSize} packers · ~${packingHours}h · separate day before move`,
  }

  const twoDayMoveEstimate = estimatedHours >= 14 ? {
    day1Hours: Math.max(3, roundQuarterHour(loadHours + yardToOriginHours + originToDestHours + loadHours * 0.1)),
    day2Hours: Math.max(3, roundQuarterHour(unloadHours + returnTripHours + unloadHours * 0.1)),
    note: 'Split load day / unload day — reduces crew fatigue and damage risk on large jobs',
  } : null

  const adjustmentCategories: Array<{ category: 'access' | 'disassembly' | 'specialty' | 'packing' | 'hidden_inventory'; label: string }> = [
    { category: 'access', label: 'Access & parking' },
    { category: 'disassembly', label: 'Disassembly / reassembly' },
    { category: 'specialty', label: 'Specialty handling' },
    { category: 'packing', label: 'Packing readiness' },
    { category: 'hidden_inventory', label: 'Hidden inventory' },
  ]
  const adjustmentBreakdown = adjustmentCategories
    .map(entry => ({
      category: entry.category,
      label: entry.label,
      hours: roundQuarterHour(
        penalties
          .filter(penalty => penalty.category === entry.category && !penalty.isFlagOnly)
          .reduce((sum, penalty) => sum + penalty.hours, 0)
      ),
    }))
    .filter(entry => entry.hours > 0 || (entry.category === 'hidden_inventory' && extraCubicFeet > 0))

  const effectiveBillableDistanceKm = roundCurrency((billableDistanceKm || 0) + additionalTripDistanceKm)
  const effectiveOperationalDistanceKm = roundCurrency((operationalDistanceKm || 0) + additionalTripDistanceKm)
  const laborCost = roundCurrency(crewSize * operationalHours * LABOR_COST_PER_MOVER_HOUR)
  const truckDailyCost = roundCurrency(truckCount * TRUCK_DAILY_COST)
  const truckFuelMileageCost = roundCurrency((effectiveOperationalDistanceKm || 0) * truckCount * TRUCK_OPS_COST_PER_KM)
  const truckOpsCost = roundCurrency(truckDailyCost + truckFuelMileageCost)
  const directCost = roundCurrency(laborCost + truckOpsCost)
  const grossProfit = roundCurrency(laborAmount - directCost)
  const grossMarginPct = laborAmount > 0 ? Math.round((grossProfit / laborAmount) * 1000) / 10 : 0

  const intelligenceFlags = {
    twoTruckRequired: truckCount >= 2,
    twoTripZone: !isLongDistance && !isPacking && !isLaborOnly && totalCubicFeet >= TWO_TRIP_ZONE_CF && totalCubicFeet < TRUCK_CAPACITY_CF,
    threeTruckReview,
    threeHourMinApplied: roundQuarterHour(preBufferHours + bufferHours) < 3,
    fullDayFlag: estimatedHours >= 14,
    missingDestination,
    twoTripComparison,
    multiTruckOption,
    packingDayEstimate,
    twoDayMoveEstimate,
  }

  const roundedLoad = roundQuarterHour(loadHours)
  const roundedUnload = roundQuarterHour(unloadHours)
  const phaseDetail =
    totalWeightLbs > 0
      ? `${totalWeightLbs} lbs · ${crewSize} movers · ~${roundedLoad}h loading + ${effectiveBillableDriveHours}h drive + ~${roundedUnload}h unloading (${estimatedHours}h total)`
      : totalCubicFeet > 0
        ? `${totalCubicFeet} cu ft · ${crewSize} movers · ~${roundedLoad}h loading + ${effectiveBillableDriveHours}h drive + ~${roundedUnload}h unloading (${estimatedHours}h total)`
        : `${crewSize} movers · ${estimatedHours}h estimated service`

  const inclusions: string[] = []
  inclusions.push(`${crewSize} professional mover${crewSize > 1 ? 's' : ''}`)
  inclusions.push(`${truckCount} truck${truckCount > 1 ? 's' : ''}`)
  if (!isLaborOnly && !isPacking) {
    inclusions.push('furniture wrapping & padding')
    inclusions.push('disassembly & reassembly')
  }
  if (isPacking) {
    inclusions.push('professional packing service')
    inclusions.push('all packing materials')
  }
  if (missingDestination) {
    inclusions.push('travel pending final destination confirmation')
  } else if (isLongDistance) {
    inclusions.push(`round-trip travel from customer origin (${effectiveBillableDriveHours}h drive covered)`)
  } else if (!isLaborOnly) {
    inclusions.push(forcedSingleTruckTwoTrips ? 'extra return trip included in local pricing' : 'yard-to-home travel covered')
  }
  inclusions.push('fully insured')

  const moveServiceTitle = isPacking
    ? 'Professional Packing Service'
    : resolvedQuoteType === 'storage'
    ? 'Storage Load/Unload Service'
    : isLaborOnly
    ? 'Labor-Only Moving Crew'
    : isLongDistance
    ? 'Long-Distance Moving Service'
    : 'Full-Service Moving'

  const totalServiceAmount = laborAmount + extraTruckAmount + longDistanceOperationalBase + longDistanceMarkupAmount

  const lineItems: QuoteLineItem[] = [
    {
      description: moveServiceTitle,
      details: inclusions.join(' · '),
      amount: totalServiceAmount,
    },
  ]

  if (missingDestination) {
    lineItems.push({
      description: 'Travel & destination handling pending',
      details: missingRequirements.length
        ? `Provisional quote — ${missingRequirements.join(' · ')}`
        : 'Destination route still needed to finalize drive time and unloading scope',
      amount: 0,
    })
  }

  const pricingBreakdown: PricingBreakdown = {
    loadHours: roundQuarterHour(loadHours),
    driveHours: effectiveBillableDriveHours,
    operationalDriveHours: effectiveOperationalDriveHours,
    unloadHours: roundQuarterHour(unloadHours),
    baseHours,
    penaltyHours: extraHours,
    driveBufferHours,
    loadUnloadBufferHours,
    bufferHours,
    totalHours: estimatedHours,
    operationalHours,
    crewSize,
    crewRatePerHour: crewRate,
    truckCount,
    truckRateMultiplier,
    tripStrategy,
    pricingStatus,
    routeCategory,
    billableDistanceKm: effectiveBillableDistanceKm,
    operationalDistanceKm: effectiveOperationalDistanceKm,
    baseCubicFeet,
    extraCubicFeet,
    totalCubicFeet,
    disassemblyItems: disassemblyItemNames,
    specialtyItemFlags,
    penalties,
    adjustmentBreakdown,
    internalCostEstimate: {
      laborCost,
      truckDailyCost,
      truckFuelMileageCost,
      truckOpsCost,
      totalCost: directCost,
      grossProfit,
      grossMarginPct,
      computedRevenue: laborAmount,
    },
    intelligenceFlags,
  }

  return {
    ...computeQuoteTotals(lineItems, getDefaultDepositRate(lead.moveType)),
    crewSize,
    estimatedHours,
    truckCount,
    estimatedWeightLbs: totalWeightLbs || undefined,
    longDistanceDistanceKm: Number(overrides?.longDistanceDistanceKm || 0) || undefined,
    longDistanceTruckCost: longDistanceTruckCost || undefined,
    longDistanceGasCost: longDistanceGasCost || undefined,
    longDistanceInsuranceCost: longDistanceInsuranceCost || undefined,
    longDistanceMiscCost: longDistanceMiscCost || undefined,
    longDistanceMarkupRate: longDistanceMarkupRate || undefined,
    suggestedCrewRate: crewRate,
    pricingBreakdown,
  }
}

export function computeQuoteTotals(lineItems: QuoteLineItem[], depositRate = 0.4, discountAmount = 0) {
  const normalizedItems = lineItems.map(item => ({
    description: item.description || 'Custom line item',
    details: item.details || '',
    amount: Number(item.amount || 0),
  }))
  const baseSubtotal = normalizedItems.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const subtotal = Math.max(0, baseSubtotal - Number(discountAmount || 0))
  const hst = Math.round(subtotal * 0.13 * 100) / 100
  const total = Math.round((subtotal + hst) * 100) / 100
  const deposit = Math.round(total * depositRate * 100) / 100
  const balance = Math.round((total - deposit) * 100) / 100

  return { lineItems: normalizedItems, subtotal, hst, total, deposit, balance }
}

export function deriveInventoryMetrics(inventory: InventoryItem[]) {
  const normalized = inventory
    .map(item => ({
      ...item,
      name: item.name || item.item || '',
      qty: Number(item.qty || 0),
      cubicFeet: Number(item.cubicFeet || 0),
      weightLbs: Number(item.weightLbs || 0),
      included: item.included !== false,
      exclusionReason: item.exclusionReason || '',
    }))
    .filter(item => item.name || item.qty || item.cubicFeet || item.weightLbs)

  const includedInventory = normalized.filter(item => item.included !== false)
  const totalItems = includedInventory.reduce((sum, item) => sum + Math.max(1, item.qty || 1), 0)
  const totalCubicFeet = includedInventory.reduce((sum, item) => sum + (item.qty || 1) * Number(item.cubicFeet || 0), 0)
  const totalWeightLbs = includedInventory.reduce((sum, item) => sum + (item.qty || 1) * Number(item.weightLbs || 0), 0)

  return {
    inventory: normalized,
    includedInventory,
    totalItems,
    totalCubicFeet: Math.round(totalCubicFeet),
    totalWeightLbs: Math.round(totalWeightLbs),
  }
}

export function buildSalesSummary(leads: CRMLead[], quotes: CRMQuote[]): SalesDashboardSummary {
  const today = dateStamp()
  const activeLeads = leads.filter(lead => !['booked', 'lost'].includes(lead.stage))
  const quotedLeads = leads.filter(lead => lead.stage === 'quoted')
  const bookedLeads = leads.filter(lead => lead.stage === 'booked')
  const leadsDueToday = activeLeads.filter(lead => lead.followUpDate && lead.followUpDate <= today).length
  const overdueLeads = activeLeads.filter(lead => lead.followUpDate && lead.followUpDate < today).length
  const quotedPipelineValue = quotedLeads.reduce((sum, lead) => {
    const quote = quotes.find(item => item.id === lead.quoteId)
    if (quote) return sum + quote.total
    return sum
  }, 0)
  const bookedRevenue = bookedLeads.reduce((sum, lead) => {
    const quote = quotes.find(item => item.id === lead.quoteId)
    if (quote) return sum + quote.total
    return sum
  }, 0)

  return {
    totalLeads: leads.length,
    leadsDueToday,
    overdueLeads,
    quotedLeads: quotedLeads.length,
    bookedLeads: bookedLeads.length,
    quotedPipelineValue,
    bookedRevenue,
    totalOpenQuotes: quotes.filter(quote => ['sent', 'viewed'].includes(quote.status)).length,
  }
}

export function getClientMap(clients: CRMClient[]) {
  return new Map(clients.map(client => [client.id, client]))
}

export function getQuoteMap(quotes: CRMQuote[]) {
  return new Map(quotes.map(quote => [quote.id, quote]))
}
