import type {
  CRMLead,
  CRMQuote,
  JobFactors,
  JobPenalty,
  PricingBreakdown,
  CRMClient,
  FollowUpLog,
  InventoryItem,
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

const LOCAL_CREW_RATES: Record<number, number> = {
  1: 100,
  2: 160,
  3: 225,
  4: 270,
}

const LABOR_ONLY_CREW_RATES: Record<number, number> = {
  1: 100,
  2: 120,
  3: 150,
  4: 200,
}

const PACKING_CREW_RATES: Record<number, number> = {
  1: 90,
  2: 150,
  3: 150,
  4: 200,
}

function roundQuarterHour(value: number) {
  return Math.round(Math.max(0, value) * 4) / 4
}

export function getCrewRate(crewSize: number, moveType?: CRMLead['moveType'] | CRMQuote['moveType']) {
  const normalizedCrew = Math.max(1, Math.min(4, Math.round(crewSize || 3)))
  const rateTable =
    moveType === 'labor-only'
      ? LABOR_ONLY_CREW_RATES
      : moveType === 'packing'
        ? PACKING_CREW_RATES
        : LOCAL_CREW_RATES
  return rateTable[normalizedCrew] || rateTable[3]
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

// 26ft U-Haul holds ~1,400 cu ft with safe loading buffer
const TRUCK_CAPACITY_CF = 1400

// Items that almost always require disassembly/reassembly — auto-detected from inventory scan
// NOTE: wardrobes are excluded — they are typically built-in and stay with the property
const DISASSEMBLY_KEYWORDS = [
  'bed frame',
  'bunk bed',
  'crib',
  'dining table',
  'desk',
  'wall unit',
  'china cabinet',
  'hutch',
  'trampoline',
]

export function suggestDisassemblyCount(inventory: InventoryItem[]): number {
  return inventory.reduce((count, item) => {
    const name = (item.name || item.item || '').toLowerCase()
    if (item.included === false) return count
    return DISASSEMBLY_KEYWORDS.some(keyword => name.includes(keyword))
      ? count + Math.max(1, Number(item.qty || 1))
      : count
  }, 0)
}

export function suggestTruckCount(totalCubicFeet: number, moveType?: CRMLead['moveType']) {
  if (moveType === 'long-distance') {
    return totalCubicFeet >= TRUCK_CAPACITY_CF ? 2 : 1
  }
  return totalCubicFeet >= TRUCK_CAPACITY_CF ? 2 : 1
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
    })
  }
  if (factors.originHasElevator && !factors.originElevatorReserved) {
    penalties.push({ label: 'Origin – elevator not reserved (shared, wait time)', hours: 0.75 })
  }
  if (factors.originParkingOk === false) {
    penalties.push({ label: 'Origin – limited truck access (no direct parking)', hours: 0.75 })
  }

  // Destination access
  const destFloors = factors.destFloors || 1
  if (destFloors >= 2 && !factors.destHasElevator) {
    penalties.push({
      label: `Destination – ${destFloors}-storey, stairs (no elevator)`,
      hours: (destFloors - 1) * 0.35,
    })
  }
  if (factors.destHasElevator && !factors.destElevatorReserved) {
    penalties.push({ label: 'Destination – elevator not reserved (shared, wait time)', hours: 0.75 })
  }
  if (factors.destParkingOk === false) {
    penalties.push({ label: 'Destination – limited truck access', hours: 0.75 })
  }

  // Packing status
  if (factors.packingStatus === 'partial') {
    penalties.push({ label: 'Partial packing – crew packing assist needed', hours: 1.5 })
  } else if (factors.packingStatus === 'not-started') {
    penalties.push({ label: 'Full pack – customer has not started packing', hours: 3.5 })
  }

  // Specialty items
  if (factors.hasPiano) {
    penalties.push({ label: 'Piano – specialty wrapping and handling', hours: 1.5 })
  }
  if (factors.hasSafe) {
    penalties.push({ label: 'Heavy safe – dolly required, specialty handling', hours: 0.75 })
  }

  // Disassembly / reassembly
  const disassemblyCount = factors.disassemblyItemCount || 0
  if (disassemblyCount > 0) {
    penalties.push({
      label: `Disassembly + reassembly – ${disassemblyCount} major item${disassemblyCount > 1 ? 's' : ''} (beds, wardrobes, wall units)`,
      hours: Math.round(disassemblyCount * 0.33 * 4) / 4,
    })
  }

  // Hidden inventory — adds cubic feet (no direct hour penalty, feeds back into labor calc)
  const extraCubicFeet =
    (factors.garageCubicFeet || 0) +
    (factors.basementCubicFeet || 0) +
    (factors.shedCubicFeet || 0) +
    (factors.estimatedBoxes || 0) * 1.5

  if ((factors.garageCubicFeet || 0) > 0) {
    penalties.push({ label: `Garage – ${factors.garageCubicFeet} cu ft (not in MLS photos)`, hours: 0 })
  }
  if ((factors.basementCubicFeet || 0) > 0) {
    penalties.push({ label: `Basement – ${factors.basementCubicFeet} cu ft (not in MLS photos)`, hours: 0 })
  }
  if ((factors.shedCubicFeet || 0) > 0) {
    penalties.push({ label: `Shed – ${factors.shedCubicFeet} cu ft (not in MLS photos)`, hours: 0 })
  }
  if ((factors.estimatedBoxes || 0) > 0) {
    penalties.push({
      label: `${factors.estimatedBoxes} boxes (~${Math.round((factors.estimatedBoxes || 0) * 1.5)} cu ft) – customer estimate`,
      hours: 0,
    })
  }

  // Items we do NOT move — flag only
  if (factors.hasHotTub) {
    penalties.push({ label: '⚠ Hot tub flagged – Saturn Star does not move hot tubs', hours: 0, isFlagOnly: true })
  }
  if (factors.hasPoolTable) {
    penalties.push({ label: '⚠ Pool table flagged – Saturn Star does not move pool tables', hours: 0, isFlagOnly: true })
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
// Load = wrap furniture + disassemble beds/tables + carry out + stack in truck (slowest phase)
// Unload = carry in + unwrap + reassemble + place in rooms (~1.5× faster than loading)
const LOAD_RATE_LBS_PER_MAN_HOUR = 175
const UNLOAD_RATE_LBS_PER_MAN_HOUR = 265
const LOAD_RATE_CF_PER_MAN_HOUR = 70    // cubic feet fallback when no weight data
const UNLOAD_RATE_CF_PER_MAN_HOUR = 105 // cubic feet fallback: unloading

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
  > & { driveHours?: number; quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'; distanceKm?: number },
  factors?: JobFactors
) {
  // quoteType from overrides takes priority, then lead.quoteType, then infer from moveType
  const resolvedQuoteType = overrides?.quoteType || lead.quoteType
  const isLongDistance = resolvedQuoteType === 'long_distance' || lead.moveType === 'long-distance'
  const isLaborOnly = resolvedQuoteType === 'labor_only' || resolvedQuoteType === 'storage' || lead.moveType === 'labor-only'
  const isPacking = resolvedQuoteType === 'packing_only' || lead.moveType === 'packing'
  const metrics = deriveInventoryMetrics(lead.inventory || [])

  // Apply job factor penalties
  // Auto-detect disassembly count from inventory if not manually set in job factors
  const autoDisassemblyCount = suggestDisassemblyCount(lead.inventory || [])
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
  const truckCount = Number(overrides?.truckCount || activeFactors?.truckCountOverride || suggestTruckCount(totalCubicFeet, lead.moveType))
  // 2 trucks requires minimum 4 movers (2 per truck) — enforce unless manually overridden
  const crewSize = overrides?.crewSize ? suggestedCrew : Math.max(suggestedCrew, truckCount >= 2 ? 4 : 1)
  const crewRate = getCrewRate(crewSize, lead.moveType)
  // LD operational costs default to 0 — drive time at full hourly rate covers truck/gas overhead
  // Reps can manually add these as overrides if needed for specific jobs
  const longDistanceTruckCost = Number(overrides?.longDistanceTruckCost || 0)
  const longDistanceGasCost = Number(overrides?.longDistanceGasCost || 0)
  const longDistanceInsuranceCost = Number(overrides?.longDistanceInsuranceCost || 0)
  const longDistanceMiscCost = Number(overrides?.longDistanceMiscCost || 0)
  const longDistanceMarkupRate = Number(overrides?.longDistanceMarkupRate || 0)
  // Drive time — portal-to-portal means shop→origin + origin→destination
  // overrides.driveHours is the origin→destination leg from OSRM
  // We add an equal shop-to-origin leg (same distance, crew travels both ways)
  // For labor-only, crew is already on-site so only origin→dest travel counts
  const originToDestHours = overrides?.driveHours ?? (isLongDistance ? 1.5 : 0.75)
  const shopToOriginHours = isLaborOnly ? 0 : originToDestHours  // same distance, opposite direction
  const driveHours = roundQuarterHour(isLaborOnly ? 0.5 : originToDestHours + shopToOriginHours)

  // Phase 1: Loading (wrap, disassemble, carry out, load truck) — slowest phase
  // Phase 2: Unloading (carry in, unwrap, reassemble, place) — ~50% faster than loading
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

  const rawLaborHours = loadHours + unloadHours  // pure work phases, excludes drive
  const baseHours = roundQuarterHour(rawLaborHours + driveHours)
  const preBufferHours = roundQuarterHour(baseHours + extraHours)
  // 10% buffer to protect against surprises — baked in silently
  const bufferHours = roundQuarterHour(preBufferHours * 0.1)
  const estimatedHours = Math.max(3, Number(overrides?.estimatedHours || roundQuarterHour(preBufferHours + bufferHours)))
  // Intelligence flags — inform the rep about job characteristics, not visible to customer
  // 26ft truck spec: ~1,650 cu ft. We use 1,400 as a conservative safe-load buffer (pads/wrapping reduce usable space).
  // 2-trip zone starts at 1,000 cu ft — load is 71%+ of truck and second trip becomes plausible for local moves.
  const TWO_TRIP_ZONE_CF = 1000
  const intelligenceFlags = {
    twoTruckRequired: truckCount >= 2,
    twoTripZone: !isLongDistance && !isPacking && !isLaborOnly && totalCubicFeet >= TWO_TRIP_ZONE_CF && totalCubicFeet < TRUCK_CAPACITY_CF,
    threeHourMinApplied: roundQuarterHour(preBufferHours + bufferHours) < 3,
    fullDayFlag: estimatedHours >= 14,
  }
  const laborAmount = Math.round(estimatedHours * crewRate)
  const longDistanceOperationalBase = longDistanceTruckCost + longDistanceGasCost + longDistanceInsuranceCost + longDistanceMiscCost
  const longDistanceMarkupAmount = isLongDistance ? Math.round(longDistanceOperationalBase * (longDistanceMarkupRate / 100)) : 0
  const extraTruckAmount =
    truckCount > 1
      ? isLongDistance
        ? Math.round((truckCount - 1) * estimatedHours * getCrewRate(2, lead.moveType))
        : Math.round((truckCount - 1) * estimatedHours * getCrewRate(2, lead.moveType) * 0.85)
      : 0

  // Phase time labels for the line item details
  const roundedLoad = roundQuarterHour(loadHours)
  const roundedUnload = roundQuarterHour(unloadHours)
  const phaseDetail =
    totalWeightLbs > 0
      ? `${totalWeightLbs} lbs · ${crewSize} movers · ~${roundedLoad}h loading + ${driveHours}h drive + ~${roundedUnload}h unloading (${estimatedHours}h total)`
      : totalCubicFeet > 0
        ? `${totalCubicFeet} cu ft · ${crewSize} movers · ~${roundedLoad}h loading + ${driveHours}h drive + ~${roundedUnload}h unloading (${estimatedHours}h total)`
        : `${crewSize} movers · ${estimatedHours}h portal-to-portal`

  // Build customer-facing service inclusions
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
  if (isLongDistance) {
    inclusions.push(`full portal-to-portal travel (${driveHours}h drive covered)`)
  } else if (!isLaborOnly) {
    inclusions.push('portal-to-portal travel covered')
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

  const pricingBreakdown: PricingBreakdown = {
    loadHours: roundQuarterHour(loadHours),
    driveHours,
    unloadHours: roundQuarterHour(unloadHours),
    baseHours,
    penaltyHours: extraHours,
    bufferHours,
    totalHours: estimatedHours,
    crewSize,
    crewRatePerHour: crewRate,
    truckCount,
    baseCubicFeet,
    extraCubicFeet,
    totalCubicFeet,
    penalties,
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
