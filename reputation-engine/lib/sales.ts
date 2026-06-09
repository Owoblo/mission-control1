import type {
  LeadKind,
  CRMLead,
  CRMQuote,
  LeadFollowUpStatus,
  JobFactors,
  JobPenalty,
  PricingBreakdown,
  CRMClient,
  FollowUpLog,
  InventoryItem,
  EstimateRouteContext,
  QuoteLineItem,
  QuoteLeg,
  QuoteStatus,
  SalesBranch,
  SalesDashboardSummary,
  SalesLeadStage,
} from './types'
import { normalizePhone as normalizeIdentityPhone } from './sales-phones'
import { applyMovePolicyToInventory } from './move-policy'
import { normalizeCrewPayouts } from './operations'
import { buildPackingMaterialsEstimate } from './packing-materials'
import { applyRealtorContactToOpportunityLead } from './realtor-opportunity'

function normalizeOptionalText(value?: string | null) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const SALES_LEAD_STAGES: Array<{ id: SalesLeadStage; label: string }> = [
  { id: 'new', label: 'New Lead' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'estimate_scheduled', label: 'Estimate Scheduled' },
  { id: 'estimate_completed', label: 'Estimate Done' },
  { id: 'pricing', label: 'Building Quote' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'tentative', label: 'Tentative Reservation' },
  { id: 'nurture', label: 'Shopping Around' },
  { id: 'booked', label: 'Booked' },
  { id: 'completed', label: 'Move Completed' },
  { id: 'customer_success', label: 'Customer Success' },
  { id: 'lost', label: 'Lost' },
]

export const BOOKED_LIKE_STAGES: SalesLeadStage[] = ['booked', 'completed', 'customer_success']
export const CLOSED_LEAD_STAGES: SalesLeadStage[] = [...BOOKED_LIKE_STAGES, 'lost']

export function isBookedLikeStage(stage?: SalesLeadStage | string | null) {
  return !!stage && BOOKED_LIKE_STAGES.includes(stage as SalesLeadStage)
}

export function isClosedLeadStage(stage?: SalesLeadStage | string | null) {
  return !!stage && CLOSED_LEAD_STAGES.includes(stage as SalesLeadStage)
}

export const LOST_REASONS: Array<{ id: string; label: string }> = [
  { id: 'price', label: 'Price — Too Expensive' },
  { id: 'timing', label: 'Timing — Not Ready Yet' },
  { id: 'competitor', label: 'Went with Competitor' },
  { id: 'no_response', label: 'No Response / Ghost' },
  { id: 'not_a_fit', label: 'Not a Fit' },
  { id: 'cancelled_move', label: 'Cancelled Move' },
  { id: 'diy', label: 'Moving Themselves — DIY' },
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

export const SALES_BRANCHES: Array<{ id: SalesBranch; label: string }> = [
  { id: 'windsor', label: 'Windsor' },
  { id: 'waterloo', label: 'Waterloo / KW' },
  { id: 'london', label: 'London' },
  { id: 'ottawa', label: 'Ottawa' },
]

export const CRM_LEAD_SOURCES: Array<{ id: string; label: string }> = [
  { id: 'google_online_search', label: 'Google / Online Search' },
  { id: 'facebook_instagram_ad', label: 'Facebook / Instagram Ad' },
  { id: 'review_marketplace', label: 'Yelp / HomeAdvisor / Thumbtack' },
  { id: 'customer_referral', label: 'Customer Referral' },
  { id: 'repeat_customer', label: 'Repeat Customer' },
  { id: 'walk_in', label: 'Walk-In' },
  { id: 'cold_call', label: 'Cold Call' },
  { id: 'corporate_account', label: 'Corporate Account' },
  { id: 'direct_mail', label: 'QR / Direct Mail' },
  { id: 'website_form', label: 'Website Form' },
  { id: 'email', label: 'Email' },
  { id: 'phone', label: 'Phone' },
  { id: 'other', label: 'Other' },
]

export const PROPERTY_BEDROOM_OPTIONS: Array<{ id: NonNullable<CRMLead['propertyBedrooms']>; label: string }> = [
  { id: 'studio', label: 'Studio' },
  { id: '1_bedroom', label: '1 Bedroom' },
  { id: '2_bedrooms', label: '2 Bedrooms' },
  { id: '3_bedrooms', label: '3 Bedrooms' },
  { id: '4_bedrooms', label: '4 Bedrooms' },
  { id: '5_plus', label: '5+ Bedrooms' },
]

export const PROPERTY_TYPE_OPTIONS: Array<{ id: NonNullable<CRMLead['propertyType']>; label: string }> = [
  { id: 'apartment', label: 'Apartment' },
  { id: 'condo', label: 'Condo' },
  { id: 'townhouse', label: 'Townhouse' },
  { id: 'detached_house', label: 'Detached House' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'storage_unit', label: 'Storage Unit' },
]

export const FOLLOW_UP_STATUSES: Array<{ id: LeadFollowUpStatus; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'following_up', label: 'Following Up' },
  { id: 'followed_up', label: 'Followed Up' },
  { id: 'no_response', label: 'No Response' },
]

const SALES_BRANCH_AREAS: Record<SalesBranch, string[]> = {
  windsor: ['windsor', 'tecumseh', 'lasalle', 'la salle', 'amherstburg', 'essex', 'lakeshore', 'belle river', 'leamington', 'kingsville', 'chatham', 'chatham kent'],
  waterloo: ['waterloo', 'kitchener', 'cambridge', 'guelph', 'elmira', 'st jacobs', 'st. jacobs', 'baden', 'kw', 'k w'],
  london: ['london', 'st thomas', 'st. thomas', 'woodstock', 'strathroy', 'dorchester', 'ingersoll', 'komoka', 'lambeth'],
  ottawa: ['ottawa', 'kanata', 'orleans', 'orleans', 'orléans', 'nepean', 'barrhaven', 'gloucester', 'stittsville', 'manotick'],
}

function normalizeLocationText(...values: Array<string | null | undefined>) {
  return values
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getSalesBranchLabel(branch?: SalesBranch) {
  return SALES_BRANCHES.find(item => item.id === branch)?.label || 'Unassigned'
}

export function detectSalesBranchFromLocation(...values: Array<string | null | undefined>): SalesBranch | undefined {
  const normalized = normalizeLocationText(...values)
  if (!normalized) return undefined

  for (const [branch, aliases] of Object.entries(SALES_BRANCH_AREAS) as Array<[SalesBranch, string[]]>) {
    if (aliases.some(alias => normalized.includes(normalizeLocationText(alias)))) {
      return branch
    }
  }

  return undefined
}

export function isLocationWithinBranchServiceArea(branch: SalesBranch | undefined, ...values: Array<string | null | undefined>) {
  if (!branch) return false
  const normalized = normalizeLocationText(...values)
  if (!normalized) return false
  return SALES_BRANCH_AREAS[branch].some(alias => normalized.includes(normalizeLocationText(alias)))
}

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
  if (lead.source === 'customer_referral' || lead.source === 'referral') score += 25
  else if (lead.source === 'google_online_search' || lead.source === 'google') score += 20
  else if (lead.source === 'direct_mail') score += 15
  else if (lead.source === 'repeat_customer' || lead.source === 'repeat') score += 30
  else if (lead.source === 'destination_opportunity') score += 12

  if (lead.stage === 'quoted') score += 20
  else if (lead.stage === 'customer_success') score += 50
  else if (lead.stage === 'completed') score += 45
  else if (lead.stage === 'booked') score += 40
  else if (lead.stage === 'pricing') score += 15
  else if (lead.stage === 'nurture') score += 8
  else if (lead.stage === 'contacted') score += 10

  if ((lead.inventory || []).length > 0) score += 10
  if (lead.phone) score += 5
  if (lead.quoteId) score += 15
  if (lead.leadKind === 'realtor_opportunity') score += 5

  const daysSince = (Date.now() - new Date(lead.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince < 3) score += 10
  else if (daysSince > 14) score -= 10

  return Math.max(0, Math.min(100, score))
}

export function getLeadAssignedRepName(lead?: Pick<CRMLead, 'assignedRep' | 'assignedRepName'> | null) {
  return normalizeOptionalText(lead?.assignedRepName) || normalizeOptionalText(lead?.assignedRep)
}

export function getLeadAssignedRepKey(lead?: Pick<CRMLead, 'assignedRep' | 'assignedRepName' | 'assignedRepUserId'> | null) {
  return normalizeOptionalText(lead?.assignedRepUserId) || getLeadAssignedRepName(lead)
}

const LEGACY_LEAD_SOURCE_MAP: Record<string, string> = {
  google: 'google_online_search',
  facebook: 'facebook_instagram_ad',
  instagram: 'facebook_instagram_ad',
  referral: 'customer_referral',
  repeat: 'repeat_customer',
  corporate: 'corporate_account',
  yelp: 'review_marketplace',
  homeadvisor: 'review_marketplace',
  thumbtack: 'review_marketplace',
}

export function normalizeLeadSource(source?: string | null) {
  const value = normalizeOptionalText(source)
  if (!value) return undefined
  return LEGACY_LEAD_SOURCE_MAP[value] || value
}

export function getLeadSourceLabel(source?: string | null) {
  const normalized = normalizeLeadSource(source)
  if (!normalized) return 'Other'
  return CRM_LEAD_SOURCES.find(item => item.id === normalized)?.label || normalized.replace(/_/g, ' ')
}

export function deriveLeadFollowUpStatus(
  lead: Pick<CRMLead, 'followUpStatus' | 'followUpDate' | 'stage' | 'lastInboundAt' | 'lastHumanOutboundAt'>
) {
  if (lead.followUpStatus) return lead.followUpStatus
  if (lead.stage === 'lost' || lead.stage === 'completed' || lead.stage === 'customer_success') {
    return 'followed_up' as LeadFollowUpStatus
  }

  const today = new Date().toISOString().slice(0, 10)
  const hasHumanFollowUp =
    !!lead.lastHumanOutboundAt &&
    (!lead.lastInboundAt || new Date(lead.lastHumanOutboundAt).getTime() >= new Date(lead.lastInboundAt).getTime())

  if (lead.followUpDate) {
    if (lead.followUpDate < today && hasHumanFollowUp) {
      return 'no_response' as LeadFollowUpStatus
    }
    return hasHumanFollowUp ? ('following_up' as LeadFollowUpStatus) : ('pending' as LeadFollowUpStatus)
  }

  if (hasHumanFollowUp) {
    return 'following_up' as LeadFollowUpStatus
  }

  if (lead.lastInboundAt) {
    return 'pending' as LeadFollowUpStatus
  }

  return undefined
}

export function normalizeLead(lead: CRMLead): CRMLead {
  const leadKind: LeadKind = lead.leadKind || 'customer'
  const assignedRepName = getLeadAssignedRepName(lead)
  const assignedRepUserId = normalizeOptionalText(lead.assignedRepUserId)
  const lastTouchedByName = normalizeOptionalText(lead.lastTouchedByName)
  const lastTouchedByUserId = normalizeOptionalText(lead.lastTouchedByUserId)
  const lastTouchedAt = normalizeOptionalText(lead.lastTouchedAt)
  const mergedIntoLeadId = normalizeOptionalText(lead.mergedIntoLeadId)
  const mergedAt = normalizeOptionalText(lead.mergedAt)
  const mergedByUserId = normalizeOptionalText(lead.mergedByUserId)
  const mergedByName = normalizeOptionalText(lead.mergedByName)
  const mergedReason = normalizeOptionalText(lead.mergedReason)
  const inventory = applyMovePolicyToInventory(Array.isArray(lead.inventory) ? lead.inventory : [], {
    enforceExclusion: true,
  })
  const inventoryMetrics = deriveInventoryMetrics(inventory)
  const normalizedPhone = normalizeOptionalText(lead.phone)
  const normalizedEmail = normalizeOptionalText(lead.email)?.toLowerCase()
  const normalizedLead: CRMLead = {
    ...lead,
    leadKind,
    primaryContactRole: lead.primaryContactRole || (leadKind === 'realtor_opportunity' ? 'realtor' : 'customer'),
    stage: lead.stage || 'new',
    source: normalizeLeadSource(lead.source),
    phone: normalizedPhone,
    email: normalizedEmail,
    identityPhone: normalizeOptionalText(lead.identityPhone) || normalizeIdentityPhone(normalizedPhone) || undefined,
    identityEmail: normalizeOptionalText(lead.identityEmail)?.toLowerCase() || normalizedEmail,
    callLogs: Array.isArray(lead.callLogs) ? lead.callLogs : [],
    inventory,
    mediaAssets: Array.isArray(lead.mediaAssets) ? lead.mediaAssets : [],
    crewPayouts: normalizeCrewPayouts(lead.crewPayouts),
    totalItems: inventory.length > 0 ? inventoryMetrics.totalItems : (lead.totalItems ?? lead.inventory?.length ?? 0),
    totalCubicFeet: inventory.length > 0 ? inventoryMetrics.totalCubicFeet : (lead.totalCubicFeet ?? 0),
    totalWeightLbs: inventory.length > 0 ? inventoryMetrics.totalWeightLbs : (lead.totalWeightLbs ?? 0),
    createdAt: lead.createdAt || new Date().toISOString().slice(0, 10),
    leadScore: lead.leadScore ?? calculateLeadScore(lead),
    assignedRep: assignedRepName,
    assignedRepName,
    assignedRepUserId,
    leadOwnerStatus: assignedRepName ? lead.leadOwnerStatus || 'assigned' : 'unassigned',
    ownedAt: assignedRepName ? normalizeOptionalText(lead.ownedAt) : undefined,
    followUpStatus: deriveLeadFollowUpStatus(lead),
    lastTouchedByName,
    lastTouchedByUserId,
    lastTouchedAt,
    mergedIntoLeadId,
    mergedAt,
    mergedByUserId,
    mergedByName,
    mergedReason,
  }

  if (normalizedLead.leadKind === 'realtor_opportunity' && normalizedLead.primaryContactRole === 'realtor') {
    return applyRealtorContactToOpportunityLead(normalizedLead, {
      realtorName: normalizedLead.realtorName,
      realtorPhone: normalizedLead.realtorPhone,
      realtorEmail: normalizedLead.realtorEmail,
      realtorBrokerage: normalizedLead.realtorBrokerage,
    })
  }

  return normalizedLead
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
    billingModel: quote.billingModel || undefined,
    paymentTerms: quote.paymentTerms || getDefaultPaymentTerms(quote.moveType),
    minimumBillableHours: Number(quote.minimumBillableHours || 0) || undefined,
    maximumEstimatedHours: Number(quote.maximumEstimatedHours || 0) || undefined,
    hourlyRateOverride: Number(quote.hourlyRateOverride || 0) || undefined,
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
  '4-2': 290,   // standard 2-truck job — competitive market rate
  '5-2': 350,
  '6-2': 395,
  '6-3': 480,
  '7-3': 530,
  '8-3': 580,
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

type EstimateQuoteOverrides = Partial<
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
  legs?: QuoteLeg[]
}

type EstimateQuoteResult = ReturnType<typeof computeQuoteTotals> & {
  crewSize: number
  estimatedHours: number
  truckCount: number
  estimatedWeightLbs?: number
  longDistanceDistanceKm?: number
  longDistanceTruckCost?: number
  longDistanceGasCost?: number
  longDistanceInsuranceCost?: number
  longDistanceMiscCost?: number
  longDistanceMarkupRate?: number
  suggestedCrewRate: number
  pricingBreakdown: PricingBreakdown
}

const AUTO_ESTIMATE_LINE_ITEM_DESCRIPTIONS = new Set([
  'Local moving labor',
  'Long-distance moving labor',
  'Labor-only moving crew',
  'Packing labor',
  'Dispatch and route coverage',
  'Portal-to-portal travel allowance',
  'Mileage and linehaul',
  'Additional truck and crew package',
  'Full-Service Moving',
  'Long-Distance Moving Service',
  'Labor-Only Moving Crew',
  'Professional Packing Service',
  'Storage Load/Unload Service',
  'Packing-Only Service',
  'One-way truck rental',
  'Fuel allowance',
  'Truck insurance allowance',
  'Long-distance misc allowance',
  'Long-distance route markup',
  'Travel & destination handling pending',
  'Moving Services — Agreed Rate',
  'Long-Distance Moving Service — All Inclusive',
])

export function isAutoGeneratedEstimateLineItemDescription(description?: string) {
  const normalized = (description || '').trim()
  if (!normalized) return false
  if (normalized.startsWith('[Leg ')) return true
  return AUTO_ESTIMATE_LINE_ITEM_DESCRIPTIONS.has(normalized)
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
  if (moveType === 'commercial') return 0
  return moveType === 'long-distance' ? 0.4 : 0.2
}

export function getDefaultPaymentTerms(moveType?: CRMLead['moveType'] | CRMQuote['moveType']): CRMQuote['paymentTerms'] {
  return moveType === 'commercial' ? 'approval_invoice' : 'deposit_required'
}

export function isInvoiceStylePaymentTerms(paymentTerms?: CRMQuote['paymentTerms']) {
  return paymentTerms === 'approval_invoice' ||
    paymentTerms === 'invoice_net_7' ||
    paymentTerms === 'invoice_net_15' ||
    paymentTerms === 'invoice_net_30' ||
    paymentTerms === 'po_required'
}

export function paymentTermsLabel(paymentTerms?: CRMQuote['paymentTerms']) {
  if (paymentTerms === 'approval_invoice') return 'Approval + invoice'
  if (paymentTerms === 'invoice_net_7') return 'Invoice Net 7'
  if (paymentTerms === 'invoice_net_15') return 'Invoice Net 15'
  if (paymentTerms === 'invoice_net_30') return 'Invoice Net 30'
  if (paymentTerms === 'po_required') return 'PO required'
  return 'Deposit required'
}

export function computeCommercialCostLayer(factors?: JobFactors, revenue = 0) {
  const protectionCost = roundCurrency(Number(factors?.commercialProtectionCost || 0))
  const liabilityCost = roundCurrency(Number(factors?.commercialLiabilityCost || 0))
  const adminCost = roundCurrency(Number(factors?.commercialAdminCost || 0))
  const otherDirectCost = roundCurrency(Number(factors?.commercialOtherDirectCost || 0))
  const directCost = roundCurrency(protectionCost + liabilityCost + adminCost + otherDirectCost)
  const markupRate = Math.max(0, Number(factors?.commercialMarkupRate || 0))
  const markupAmount = roundCurrency(revenue > 0 ? revenue * (markupRate / 100) : 0)

  return {
    protectionCost,
    liabilityCost,
    adminCost,
    otherDirectCost,
    directCost,
    markupRate,
    markupAmount,
    totalCost: directCost,
  }
}

function addressLooksLikeHouse(address?: string, propertyType?: CRMLead['propertyType']) {
  if (propertyType === 'detached_house' || propertyType === 'townhouse') return true
  if (propertyType === 'apartment' || propertyType === 'condo' || propertyType === 'commercial' || propertyType === 'storage_unit') return false
  const text = (address || '').toLowerCase()
  if (!text.trim()) return false
  const unitPattern = /(?:\b(?:apt|apartment|unit|suite|ste|floor|fl|room|rm)\b|#\s*\w+|\b\d+\s*-\s*\d+)/
  if (unitPattern.test(text)) return false
  return /\b\d{1,6}\s+[a-z0-9]/.test(text)
}

function accessTextSaysLimited(...values: Array<string | undefined>) {
  const text = values.filter(Boolean).join(' ').toLowerCase()
  if (!text.trim()) return false
  return /\b(no|limited|tight|hard|difficult|street|permit|far|long carry|walk|blocked|underground|loading dock|dock|cannot|can't|cant)\b/.test(text)
}

function normalizeHouseAccessAssumptions(lead: CRMLead, factors?: JobFactors): JobFactors | undefined {
  if (!factors) return factors
  const next = { ...factors }
  const limitedAccessNotes = accessTextSaysLimited(lead.originAccess, lead.destAccess, lead.parkingNotes, lead.notes)

  if (
    addressLooksLikeHouse(lead.originAddress, lead.propertyType) &&
    (next.originFloors || 1) <= 2 &&
    !limitedAccessNotes
  ) {
    if (next.originParkingOk === false) next.originParkingOk = true
    if (next.originHasElevator) {
      next.originHasElevator = false
      next.originElevatorReserved = undefined
    }
  }

  if (
    addressLooksLikeHouse(lead.destAddress, lead.propertyType) &&
    (next.destFloors || 1) <= 2 &&
    !limitedAccessNotes
  ) {
    if (next.destParkingOk === false) next.destParkingOk = true
    if (next.destHasElevator) {
      next.destHasElevator = false
      next.destElevatorReserved = undefined
    }
  }

  return next
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

function estimatePackingDayPlan(input: {
  inventory: InventoryItem[]
  totalCubicFeet: number
  estimatedBoxes?: number
  crewSizeHint: number
}) {
  const includedInventory = input.inventory.filter(item => item.included !== false)
  const uniqueRooms = new Set(
    includedInventory
      .map(item => (item.room || '').trim())
      .filter(Boolean)
  ).size
  const estimatedBoxes = Math.max(
    0,
    Number(input.estimatedBoxes || 0) ||
      includedInventory.reduce((sum, item) => {
        const label = (item.name || item.item || '').toLowerCase()
        if (!label.includes('box')) return sum
        return sum + Math.max(1, Number(item.qty || 1))
      }, 0)
  )
  const packingCrewSize =
    input.crewSizeHint >= 4 || input.totalCubicFeet >= 1100 || estimatedBoxes >= 65
      ? 3
      : 2
  const volumeHours = input.totalCubicFeet > 0
    ? input.totalCubicFeet / (packingCrewSize === 3 ? 160 : 110)
    : 0
  const boxHours = estimatedBoxes > 0
    ? estimatedBoxes / (packingCrewSize === 3 ? 10 : 7)
    : 0
  const roomHours = uniqueRooms > 0
    ? uniqueRooms * (packingCrewSize === 3 ? 0.75 : 0.9)
    : 0
  const packingHours = Math.max(
    packingCrewSize === 3 ? 5 : 4,
    roundQuarterHour(Math.max(volumeHours, boxHours, roomHours))
  )
  const packingCrewRate = PACKING_CREW_RATES[packingCrewSize] || PACKING_CREW_RATES[3]
  const amountBeforeHst = roundCurrency(packingHours * packingCrewRate)

  return {
    crewSize: packingCrewSize,
    hours: packingHours,
    amountBeforeHst,
    total: roundCurrency(amountBeforeHst * 1.13),
    note: packingCrewSize === 2
      ? `${packingCrewSize} packers · ~${packingHours}h · designed for a smaller or mid-size pack day`
      : `${packingCrewSize} packers · ~${packingHours}h · suited for a larger home or tighter timeline`,
  }
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
export const UHAUL_RATE_PER_KM = 1   // quick rental estimate used for long-distance quoting
const COMMISSION_RATE = 0.05          // 5% of revenue — rep commission
const PACKING_SUPPLIES_COST_PER_BOX = 3.50  // avg cost per box (box + tape + paper)

// Items that almost always require disassembly/reassembly — auto-detected from inventory scan
const DISASSEMBLY_KEYWORDS = [
  // Beds — match any bed frame/base, not just ones labeled "bed frame"
  'bed frame', 'bunk bed', 'crib', 'daybed',
  'platform bed', 'sleigh bed', 'canopy bed', 'murphy bed',
  'queen bed', 'king bed', 'twin bed', 'double bed', 'full bed',
  'queen size bed', 'king size bed', 'twin size bed',
  'queen platform', 'king platform',
  // Tables
  'dining table', 'kitchen table', 'office table', 'conference table',
  // Desks
  'executive desk', 'corner desk', 'l-shaped desk', 'standing desk',
  'desk frame', 'workstation desk', 'computer desk', 'office desk',
  // Storage / shelving with assembly
  'china cabinet', 'hutch', 'bookcase', 'bookshelf',
  // Other
  'trampoline',
  'mirror dresser', 'dresser with mirror', 'mirrored dresser', 'dresser mirror',
]

// Names that contain a keyword but should NOT be flagged for disassembly
const DISASSEMBLY_EXCLUSIONS = [
  'desk chair',   // "office desk chair", "ergonomic desk chair" — chairs, not desks
  'patio set',
  'patio table',
  'bar stool',    // bar stools don't disassemble
  'coffee table', // coffee tables rarely need disassembly
  'end table',
  'side table',
  'night table',
  'nightstand',
]

export function needsDisassembly(name: string): boolean {
  const lower = name.toLowerCase()
  if (DISASSEMBLY_EXCLUSIONS.some(ex => lower.includes(ex))) return false
  return DISASSEMBLY_KEYWORDS.some(kw => lower.includes(kw))
}

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
    if (item.included === false) return count
    return needsDisassembly(item.name || item.item || '')
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

  // Conjoint / two-household moves have a second pickup that can carry its own
  // elevator, floor, and parking constraints. Price it separately so Person B's
  // apartment access does not disappear inside the route summary.
  if (factors.conjointMove) {
    const personBOriginFloors = factors.personBOriginFloors || 1
    if (personBOriginFloors >= 2 && !factors.personBOriginHasElevator) {
      penalties.push({
        label: `Second pickup – ${personBOriginFloors}-storey, stairs (no elevator)`,
        hours: (personBOriginFloors - 1) * 0.35,
        category: 'access',
      })
    }
    if (factors.personBOriginHasElevator && !factors.personBOriginElevatorReserved) {
      penalties.push({ label: 'Second pickup – elevator not reserved (shared, wait time)', hours: 0.75, category: 'access' })
    }
    if (factors.personBOriginParkingOk === false) {
      penalties.push({ label: 'Second pickup – limited truck access', hours: 0.75, category: 'access' })
    }
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
    const mode = factors.disassemblyMode || 'both'
    // Both = 0.25h/item (crew works in parallel), single side = 0.15h/item
    const hoursPerItem = mode === 'both' ? 0.25 : 0.15
    const modeLabel = mode === 'both'
      ? 'Disassembly + reassembly'
      : mode === 'disassemble_only'
        ? 'Disassembly only (crew reassembles at origin, customer handles destination)'
        : 'Reassembly only (customer disassembles, crew reassembles at destination)'
    penalties.push({
      label: `${modeLabel} – ${disassemblyCount} item${disassemblyCount > 1 ? 's' : ''}`,
      hours: Math.round(disassemblyCount * hoursPerItem * 4) / 4,
      category: 'disassembly',
      details: ['Beds, dining tables, hutches, desks, trampolines, similar freestanding assemblies'],
    })
  }

  // Hidden inventory — adds cubic feet (no direct hour penalty, feeds back into labor calc)
  // Boxes: first 50 are standard and included — only count the overage above 50
  const BOX_STANDARD_ALLOWANCE = 50
  const totalBoxes = factors.estimatedBoxes || 0
  const billableBoxes = Math.max(0, totalBoxes - BOX_STANDARD_ALLOWANCE)
  const extraCubicFeet =
    (factors.garageCubicFeet || 0) +
    (factors.basementCubicFeet || 0) +
    (factors.shedCubicFeet || 0) +
    billableBoxes * 1.5

  if ((factors.garageCubicFeet || 0) > 0) {
    penalties.push({ label: `Garage – ${factors.garageCubicFeet} cu ft (not in MLS photos)`, hours: 0, category: 'hidden_inventory' })
  }
  if ((factors.basementCubicFeet || 0) > 0) {
    penalties.push({ label: `Basement – ${factors.basementCubicFeet} cu ft (not in MLS photos)`, hours: 0, category: 'hidden_inventory' })
  }
  if ((factors.shedCubicFeet || 0) > 0) {
    penalties.push({ label: `Shed – ${factors.shedCubicFeet} cu ft (not in MLS photos)`, hours: 0, category: 'hidden_inventory' })
  }
  if (totalBoxes > 0) {
    penalties.push({
      label: totalBoxes <= BOX_STANDARD_ALLOWANCE
        ? `${totalBoxes} boxes – included in standard pricing`
        : `${totalBoxes} boxes – ${billableBoxes} over standard allowance (~${Math.round(billableBoxes * 1.5)} cu ft added)`,
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
        ? isBookedLikeStage(lead.stage)
          ? lead.stage
          : 'lost'
        : quote.status === 'sent' || quote.status === 'viewed'
          ? 'quoted'
          : quote.status === 'draft'
            ? isBookedLikeStage(lead.stage)
              ? lead.stage
              : lead.stage === 'lost'
                ? 'lost'
                : 'pricing'
          : isBookedLikeStage(lead.stage)
            ? lead.stage
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

function estimateSingleLeadQuote(
  lead: CRMLead,
  overrides?: EstimateQuoteOverrides,
  factors?: JobFactors
): EstimateQuoteResult {
  const resolvedQuoteType = overrides?.quoteType || lead.quoteType
  const isLongDistance = resolvedQuoteType === 'long_distance' || lead.moveType === 'long-distance'
  const isLaborOnly = resolvedQuoteType === 'labor_only' || lead.moveType === 'labor-only'
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
      if (!needsDisassembly(name)) return []
      const qty = Math.max(1, Number(item.qty || 1))
      const displayName = item.name || item.item || ''
      return qty > 1 ? [`${qty}× ${displayName}`] : [displayName]
    })

  // Specialty items that ARE being moved (not flagged as "do not move")
  const specialtyItemFlags: string[] = []
  if (factors?.hasPiano ?? lead.jobFactors?.hasPiano) specialtyItemFlags.push('Upright Piano')
  if (factors?.hasSafe ?? lead.jobFactors?.hasSafe) specialtyItemFlags.push('Heavy Safe')

  const rawFactors = factors ?? lead.jobFactors
  const activeFactors: JobFactors | undefined = normalizeHouseAccessAssumptions(lead, rawFactors
    ? {
        ...rawFactors,
        // Only auto-fill disassemblyItemCount if rep hasn't set it explicitly
        disassemblyItemCount: rawFactors.disassemblyItemCount ?? autoDisassemblyCount,
      }
    : autoDisassemblyCount > 0
      ? { disassemblyItemCount: autoDisassemblyCount }
      : undefined)
  const { penalties, extraHours: penaltyHoursFromFactors, extraCubicFeet } = activeFactors
    ? computeJobPenalties(activeFactors)
    : { penalties: [], extraHours: 0, extraCubicFeet: 0 }
  let extraHours = penaltyHoursFromFactors

  if (lead.moveType === 'commercial' && activeFactors) {
    const commercialAdjustments: JobPenalty[] = []
    if (activeFactors.commercialLabelingRequired) {
      commercialAdjustments.push({ label: 'Commercial labeling / department placement plan', hours: 0.5, category: 'access' })
    }
    if (activeFactors.commercialITEquipment) {
      commercialAdjustments.push({ label: 'IT/electronics handling — monitors, towers, cables, and peripherals', hours: 0.5, category: 'specialty' })
    }
    if (activeFactors.commercialDisposalRequired) {
      commercialAdjustments.push({ label: 'Commercial disposal / cleanout coordination', hours: 0.5, category: 'hidden_inventory' })
    }
    if (activeFactors.commercialAfterHours) {
      commercialAdjustments.push({ label: 'After-hours building coordination window', hours: 0.25, category: 'access' })
    }
    if (activeFactors.commercialFreightElevator) {
      commercialAdjustments.push({ label: 'Freight elevator staging and reservation coordination', hours: 0.25, category: 'access' })
    } else if (!activeFactors.commercialLoadingDock) {
      commercialAdjustments.push({ label: 'Commercial access review — loading dock/freight elevator not confirmed', hours: 0.25, category: 'access' })
    }
    if (activeFactors.commercialCOIRequired) {
      commercialAdjustments.push({ label: 'Certificate of insurance required before dispatch', hours: 0, isFlagOnly: true, category: 'warning' })
    }
    if (activeFactors.commercialPoNumber) {
      commercialAdjustments.push({ label: `Commercial billing reference / PO: ${activeFactors.commercialPoNumber}`, hours: 0, isFlagOnly: true, category: 'warning' })
    }
    commercialAdjustments.forEach(adjustment => {
      penalties.push(adjustment)
      if (!adjustment.isFlagOnly) extraHours += adjustment.hours
    })
  }

  const baseCubicFeet = lead.totalCubicFeet || metrics.totalCubicFeet
  const totalCubicFeet = baseCubicFeet + extraCubicFeet
  const totalWeightLbs = Number(overrides?.estimatedWeightLbs || lead.totalWeightLbs || metrics.totalWeightLbs)
  const suggestedCrew = Number(overrides?.crewSize || suggestCrewSize(totalWeightLbs, totalCubicFeet, metrics.includedInventory))
  const suggestedTruckCount = suggestTruckCount(totalCubicFeet, totalWeightLbs, lead.moveType)
  const truckCount = Number(overrides?.truckCount || activeFactors?.truckCountOverride || suggestedTruckCount)

  // Multi-truck coordination overhead: each additional truck adds ~30 min for
  // parallel loading logistics, crew briefing, and staging at origin.
  // Only applies to local full-service moves (not long-distance, labor-only, or packing).
  if (!isLongDistance && !isPacking && !isLaborOnly && truckCount >= 2) {
    const coordHours = roundQuarterHour(0.5 * (truckCount - 1))
    penalties.push({
      label: `${truckCount}-truck coordination — load sequence, parallel staging, crew sync`,
      hours: coordHours,
      category: 'access',
    })
    extraHours += coordHours
  }

  const threeTruckReview = truckCount >= 3
  const crewMinimum = isPacking ? 1 : truckCount >= 3 ? 6 : truckCount === 2 ? 4 : 2
  // Business rule: 1 truck local = max 3 movers by default (4th not productive on single truck)
  const crewSuggestionCap = (!isLongDistance && !isLaborOnly && !isPacking && truckCount === 1) ? 3 : Infinity
  const crewSizeOverride = activeFactors?.crewSizeOverride
  const crewSize = crewSizeOverride
    ? Math.max(crewSizeOverride, crewMinimum)  // honour override but never below truck minimum
    : overrides?.crewSize ? suggestedCrew : Math.max(Math.min(suggestedCrew, crewSuggestionCap), crewMinimum)
  // Truck-aware rate: 2-truck jobs use LOCAL_CREW_RATES_TRUCK_AWARE which builds in
  // the efficiency discount (e.g. 4 movers + 2 trucks = $350/hr, not $270 × 1.5 = $405)
  const crewRate = getCrewRate(crewSize, lead.moveType, truckCount)
  const baseCrewRate = crewRate  // kept for cost estimate calculations
  const truckRateMultiplier = getTruckRateMultiplier(truckCount)  // kept for display only
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
  const autoUhaulChargeEstimate = isLongDistance && operationalDistanceKm
    ? roundCurrency(Math.max(0, operationalDistanceKm) * truckCount * UHAUL_RATE_PER_KM)
    : 0
  const longDistanceTruckCost = Number(overrides?.longDistanceTruckCost || 0) || autoUhaulChargeEstimate
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
  const driveBufferHours = roundQuarterHour(routeCategory === 'long-distance' ? 0 : effectiveBillableDriveHours * 0.06)
  // Long-distance: no buffer — it's a planned full-day job, experienced crew, no padding needed
  const loadUnloadBufferHours = routeCategory === 'long-distance' ? 0 : roundQuarterHour((rawLaborHours + secondTripHandlingHours + extraHours) * 0.06)
  const bufferHours = roundQuarterHour(driveBufferHours + loadUnloadBufferHours)
  const estimatedHours = Math.max(3, Number(overrides?.estimatedHours || roundQuarterHour(preBufferHours + bufferHours)))
  const operationalPreBufferHours = roundQuarterHour(rawLaborHours + secondTripHandlingHours + effectiveOperationalDriveHours + extraHours)
  const operationalHours = roundQuarterHour(operationalPreBufferHours + loadUnloadBufferHours + (routeCategory === 'long-distance' ? 0 : driveBufferHours))
  const laborAmount = roundCurrency(estimatedHours * crewRate)
  const longDistanceOperationalBase = longDistanceTruckCost + longDistanceGasCost + longDistanceInsuranceCost + longDistanceMiscCost
  const longDistanceMarkupAmount = isLongDistance ? roundCurrency(longDistanceOperationalBase * (longDistanceMarkupRate / 100)) : 0
  const commercialRevenueBase = roundCurrency(laborAmount + longDistanceOperationalBase + longDistanceMarkupAmount)
  const commercialCostLayer = lead.moveType === 'commercial'
    ? computeCommercialCostLayer(activeFactors, commercialRevenueBase)
    : computeCommercialCostLayer(undefined, 0)
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
    oneTripHours: number
    oneTripAmount: number
    oneTripSavingsVsTwoTrip: number
  } | null = null

  let multiTruckOption: PricingBreakdown['intelligenceFlags']['multiTruckOption'] = null

  if (!missingDestination && !isLongDistance && !isPacking && !isLaborOnly && (truckCount >= 2 || totalCubicFeet >= TWO_TRIP_ZONE_CF)) {
    // Business rule: 1 truck always = 3 movers (4th mover not productive on single truck)
    const tripCrewSize = 3
    const oneTruckRate = roundCurrency(getCrewRate(tripCrewSize, lead.moveType))
    // Recompute labor hours at 3-mover pace (may differ from current crewSize)
    const threeMoverLoadHours = totalWeightLbs > 0
      ? totalWeightLbs / LOAD_RATE_LBS_PER_MAN_HOUR / 3
      : totalCubicFeet > 0 ? totalCubicFeet / (LOAD_RATE_CF_PER_MAN_HOUR * 3) : 2.5
    const threeMoverUnloadHours = totalWeightLbs > 0
      ? totalWeightLbs / UNLOAD_RATE_LBS_PER_MAN_HOUR / 3
      : totalCubicFeet > 0 ? totalCubicFeet / (UNLOAD_RATE_CF_PER_MAN_HOUR * 3) : threeMoverLoadHours * 0.65
    const threeMoverRawLabor = threeMoverLoadHours + threeMoverUnloadHours
    // Proportion that actually goes on the second trip — proportional to real overflow, not flat 50%
    const trip2Frac = totalCubicFeet > TRUCK_CAPACITY_CF
      ? (totalCubicFeet - TRUCK_CAPACITY_CF) / totalCubicFeet
      : 0.35
    // Overflow items (garage boxes, light items) load ~45% faster — no wrapping needed
    const secondTripHandlingHours = roundQuarterHour(
      threeMoverLoadHours * trip2Frac * 0.55 + threeMoverUnloadHours * trip2Frac * 0.55 * 0.85
    )
    const extraTripDriveHours = roundQuarterHour(originToDestHours * 2)
    const twoTripBaseHours = roundQuarterHour(threeMoverRawLabor + billableDriveHours + secondTripHandlingHours + extraTripDriveHours + extraHours)
    const twoTripDriveBuffer = roundQuarterHour(extraTripDriveHours * 0.1)
    const twoTripLoadBuffer = roundQuarterHour((threeMoverRawLabor + secondTripHandlingHours + extraHours) * 0.1)
    const twoTripHours = Math.max(3, roundQuarterHour(twoTripBaseHours + twoTripDriveBuffer + twoTripLoadBuffer))
    const twoTripAmount = roundCurrency(twoTripHours * oneTruckRate)
    const multiTruckAmount = laborAmount + longDistanceOperationalBase + longDistanceMarkupAmount
    const savings = roundCurrency(multiTruckAmount - twoTripAmount)
    // Option C: 1 truck, 3 movers, 1 trip (optimistic — everything fits in one run)
    const oneTripBaseHours = roundQuarterHour(threeMoverRawLabor + billableDriveHours + extraHours)
    const oneTripBuffer = roundQuarterHour((threeMoverRawLabor + extraHours) * 0.06 + billableDriveHours * 0.06)
    const oneTripHours = Math.max(3, roundQuarterHour(oneTripBaseHours + oneTripBuffer))
    const oneTripAmount = roundCurrency(oneTripHours * oneTruckRate)
    twoTripComparison = {
      crewSize: tripCrewSize,
      totalHours: twoTripHours,
      totalAmount: twoTripAmount,
      savings,
      extraHours: roundQuarterHour(extraTripDriveHours + secondTripHandlingHours),
      note: savings > 0
        ? `1 truck, 2 trips saves ~${formatMoney(savings)} but adds ~${roundQuarterHour(extraTripDriveHours + secondTripHandlingHours)}h`
        : '2 trucks is more cost-effective for this load',
      oneTripHours,
      oneTripAmount,
      oneTripSavingsVsTwoTrip: roundCurrency(twoTripAmount - oneTripAmount),
    }

    multiTruckOption = {
      totalHours: estimatedHours,
      totalAmount: laborAmount,
      truckCount,
      note: `${truckCount} trucks reduces repeat travel but carries a higher hourly rate`,
    }
  }

  const packingMaterialsEstimate =
    isPacking || activeFactors?.packingStatus === 'not-started' || activeFactors?.packingStatus === 'partial'
      ? buildPackingMaterialsEstimate({
          inventory: lead.inventory || [],
          estimatedBoxes: activeFactors?.estimatedBoxes,
        })
      : null
  const packingDayEstimate = estimatePackingDayPlan({
    inventory: lead.inventory || [],
    totalCubicFeet,
    estimatedBoxes: activeFactors?.estimatedBoxes,
    crewSizeHint: crewSize,
  })

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
  const commissionCost = roundCurrency(laborAmount * COMMISSION_RATE)
  const suppliesCost = roundCurrency((factors?.estimatedBoxes || 0) * PACKING_SUPPLIES_COST_PER_BOX)
  const directCost = roundCurrency(laborCost + truckOpsCost + commissionCost + suppliesCost + commercialCostLayer.totalCost)
  const computedRevenue = roundCurrency(
    lead.moveType === 'commercial'
      ? commercialRevenueBase + commercialCostLayer.markupAmount
      : laborAmount
  )
  const grossProfit = roundCurrency(computedRevenue - directCost)
  const grossMarginPct = computedRevenue > 0 ? Math.round((grossProfit / computedRevenue) * 1000) / 10 : 0

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
    packingMaterialsEstimate,
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
    inclusions.push('materials quoted separately at actual usage')
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
    ? 'Packing-Only Service'
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

  if (lead.moveType === 'commercial' && commercialCostLayer.markupAmount > 0) {
    lineItems.push({
      description: 'Commercial logistics markup',
      details: `${commercialCostLayer.markupRate}% commercial coordination, risk, and scope management allowance`,
      amount: commercialCostLayer.markupAmount,
    })
  }

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
    uhaulRatePerKm: isLongDistance ? UHAUL_RATE_PER_KM : undefined,
    uhaulChargeEstimate: isLongDistance ? longDistanceTruckCost || autoUhaulChargeEstimate || undefined : undefined,
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
      commissionCost,
      suppliesCost,
      commercialProtectionCost: commercialCostLayer.protectionCost,
      commercialLiabilityCost: commercialCostLayer.liabilityCost,
      commercialAdminCost: commercialCostLayer.adminCost,
      commercialOtherDirectCost: commercialCostLayer.otherDirectCost,
      commercialDirectCost: commercialCostLayer.directCost,
      commercialMarkupAmount: commercialCostLayer.markupAmount,
      totalCost: directCost,
      grossProfit,
      grossMarginPct,
      computedRevenue,
    },
    intelligenceFlags,
  }

  return {
    ...computeQuoteTotals(lineItems, getDefaultDepositRate(lead.moveType)),
    crewSize,
    estimatedHours,
    truckCount,
    estimatedWeightLbs: totalWeightLbs || undefined,
    longDistanceDistanceKm: Number(overrides?.longDistanceDistanceKm || (isLongDistance ? effectiveBillableDistanceKm : 0) || 0) || undefined,
    longDistanceTruckCost: longDistanceTruckCost || undefined,
    longDistanceGasCost: longDistanceGasCost || undefined,
    longDistanceInsuranceCost: longDistanceInsuranceCost || undefined,
    longDistanceMiscCost: longDistanceMiscCost || undefined,
    longDistanceMarkupRate: longDistanceMarkupRate || undefined,
    suggestedCrewRate: crewRate,
    pricingBreakdown,
  }
}

function clampInventorySharePct(value: number | undefined, fallback: number) {
  const normalized = Number(value)
  if (!Number.isFinite(normalized) || normalized <= 0) {
    return Math.max(5, Math.min(100, Math.round(fallback)))
  }
  return Math.max(5, Math.min(100, Math.round(normalized)))
}

function buildScaledLeadSnapshot(
  lead: CRMLead,
  totalCubicFeet: number,
  totalWeightLbs: number,
  sharePct: number
): CRMLead {
  const ratio = Math.max(0.05, Math.min(1, sharePct / 100))
  return {
    ...lead,
    inventory: [],
    totalItems: Math.max(1, Math.round((lead.totalItems || 1) * ratio)),
    totalCubicFeet: roundCurrency(totalCubicFeet * ratio),
    totalWeightLbs: roundCurrency(totalWeightLbs * ratio),
  }
}

function buildLegRouteContext(
  leg: QuoteLeg,
  fallbackCategory: EstimateRouteContext['routeCategory']
): EstimateRouteContext {
  const deliveryLike = leg.type === 'delivery' || leg.type === 'junk'
  const pricingStatus =
    leg.pricingStatus ||
    (
      (leg.driveHours || leg.distanceKm || leg.billableDriveHours || leg.billableDistanceKm)
        ? 'ready'
        : 'provisional'
    )
  const routeCategory = leg.routeCategory || fallbackCategory || 'local'
  const baseDriveHours = roundQuarterHour(Number(leg.driveHours || 0))
  const billableDriveHours = roundQuarterHour(
    deliveryLike
      ? Number(leg.driveHours || leg.billableDriveHours || 0)
      : Number(leg.billableDriveHours || leg.driveHours || 0)
  )
  const operationalDriveHours = roundQuarterHour(
    deliveryLike
      ? Number(leg.driveHours || leg.operationalDriveHours || 0)
      : Number(leg.operationalDriveHours || leg.billableDriveHours || leg.driveHours || 0)
  )
  const billableDistanceKm = roundCurrency(
    deliveryLike
      ? Number(leg.distanceKm || leg.billableDistanceKm || 0)
      : Number(leg.billableDistanceKm || leg.distanceKm || 0)
  )
  const operationalDistanceKm = roundCurrency(
    deliveryLike
      ? Number(leg.distanceKm || leg.operationalDistanceKm || 0)
      : Number(leg.operationalDistanceKm || leg.billableDistanceKm || leg.distanceKm || 0)
  )

  return {
    pricingStatus,
    routeCategory,
    billableDriveHours,
    operationalDriveHours,
    originToDestinationHours: baseDriveHours,
    yardToOriginHours: deliveryLike ? 0 : roundQuarterHour(Number(leg.yardToOriginHours || 0)),
    returnTripHours: deliveryLike ? 0 : roundQuarterHour(Number(leg.returnTripHours || 0)),
    originToDestinationDistanceKm: roundCurrency(Number(leg.distanceKm || 0)),
    billableDistanceKm,
    operationalDistanceKm,
    missingRequirements: pricingStatus === 'provisional' ? ['Route confirmation still needed for this stop'] : [],
  }
}

function buildLegFactors(baseFactors: JobFactors | undefined, leg: QuoteLeg): JobFactors | undefined {
  const next: JobFactors = { ...(baseFactors || {}) }
  let touched = Object.keys(next).length > 0
  const apply = <K extends keyof JobFactors>(key: K, value: JobFactors[K]) => {
    next[key] = value
    touched = true
  }

  if (leg.type === 'storage') {
    apply('destFloors', 1)
    apply('destHasElevator', false)
    apply('destElevatorReserved', undefined)
    apply('destParkingOk', true)
    if (next.disassemblyItemCount) apply('disassemblyMode', 'disassemble_only')
  }

  if (leg.type === 'storage_delivery' || leg.type === 'delivery') {
    apply('originFloors', 1)
    apply('originHasElevator', false)
    apply('originElevatorReserved', undefined)
    apply('originParkingOk', true)
    apply('packingStatus', 'packed')
    if (next.disassemblyItemCount) apply('disassemblyMode', 'reassemble_only')
  }

  return touched ? next : undefined
}

function getLegServiceLabel(leg: QuoteLeg) {
  if (leg.type === 'storage') return 'House → Storage'
  if (leg.type === 'storage_delivery') return 'Storage → New Home'
  if (leg.type === 'delivery') return 'Additional Delivery Stop'
  if (leg.type === 'junk') return 'Junk Removal Stop'
  return 'Moving Service'
}

function getLegDisplayLabel(leg: QuoteLeg, index: number) {
  const trimmed = leg.label?.trim()
  return trimmed || `Leg ${index + 1}`
}

function buildLegLineItem(input: {
  leg: QuoteLeg
  index: number
  crewSize: number
  truckCount: number
  totalHours: number
  amount: number
  driveHours: number
  distanceKm: number
  shareNote?: string
}) {
  const parts = [
    getLegServiceLabel(input.leg),
    `${input.crewSize} movers`,
    `${input.truckCount} truck${input.truckCount > 1 ? 's' : ''}`,
    `~${input.totalHours}h`,
  ]
  if (input.distanceKm > 0 || input.driveHours > 0) {
    parts.push(`${input.distanceKm} km · ${input.driveHours}h drive`)
  }
  if (input.shareNote) {
    parts.push(input.shareNote)
  }
  if (input.leg.type === 'storage') {
    parts.push('disassembly only at pickup · wrap items for storage')
  } else if (input.leg.type === 'storage_delivery') {
    parts.push('pickup from storage · reassemble at destination')
  } else if (input.leg.type === 'delivery') {
    parts.push('same load, extra stop on route')
  }
  if (input.leg.notes?.trim()) {
    parts.push(input.leg.notes.trim())
  }

  return {
    description: `[Leg ${input.index + 1}] ${getLegDisplayLabel(input.leg, input.index)}`,
    details: parts.join(' · '),
    amount: roundCurrency(input.amount),
  }
}

function buildMultiLegEstimate(
  lead: CRMLead,
  overrides: EstimateQuoteOverrides | undefined,
  factors: JobFactors | undefined
): EstimateQuoteResult {
  const legs = (overrides?.legs || []).filter(leg =>
    !!(leg.originAddress || leg.originCity || leg.destAddress || leg.destCity || leg.label || leg.type)
  )
  const baseEstimate = estimateSingleLeadQuote(lead, { ...overrides, legs: undefined }, factors)
  const overallMetrics = deriveInventoryMetrics(lead.inventory || [])
  const totalCubicFeet = lead.totalCubicFeet || overallMetrics.totalCubicFeet
  const totalWeightLbs = Number(overrides?.estimatedWeightLbs || lead.totalWeightLbs || overallMetrics.totalWeightLbs)
  const baseFactors = factors ?? lead.jobFactors
  const lineItems: QuoteLineItem[] = []
  const collectedPenalties: JobPenalty[] = []
  const routeCategories = new Set<PricingBreakdown['routeCategory']>()
  let totalLoadHours = 0
  let totalUnloadHours = 0
  let totalDriveHours = 0
  let totalOperationalDriveHours = 0
  let totalPenaltyHours = 0
  let totalDriveBufferHours = 0
  let totalLoadUnloadBufferHours = 0
  let totalBillableDistanceKm = 0
  let totalOperationalDistanceKm = 0
  let totalOperationalHours = 0
  let missingDestination = false

  for (let index = 0; index < legs.length; index += 1) {
    const leg = legs[index]
    if (leg.type === 'junk') {
      const sharePct = clampInventorySharePct(leg.inventorySharePct, 15)
      const routeContext = buildLegRouteContext(leg, baseEstimate.pricingBreakdown.routeCategory)
      const driveHours = roundQuarterHour(routeContext.billableDriveHours || leg.driveHours || 0.25)
      const operationalDriveHours = roundQuarterHour(routeContext.operationalDriveHours || driveHours)
      const billableDistanceKm = roundCurrency(routeContext.billableDistanceKm || leg.distanceKm || 0)
      const operationalDistanceKm = roundCurrency(routeContext.operationalDistanceKm || billableDistanceKm)
      const loadHours = roundQuarterHour(baseEstimate.pricingBreakdown.loadHours * (sharePct / 100) * 0.45)
      const unloadHours = 0.5
      const driveBufferHours = roundQuarterHour(driveHours * 0.1)
      const loadUnloadBufferHours = roundQuarterHour((loadHours + unloadHours) * 0.1)
      const totalHours = Math.max(1.5, roundQuarterHour(loadHours + unloadHours + driveHours + driveBufferHours + loadUnloadBufferHours))
      const operationalHours = roundQuarterHour(loadHours + unloadHours + operationalDriveHours + driveBufferHours + loadUnloadBufferHours)
      const amount = roundCurrency((totalHours * baseEstimate.pricingBreakdown.crewRatePerHour) + 149)
      const shareNote = `removes ~${sharePct}% equivalent of the overall load`
      lineItems.push(buildLegLineItem({
        leg,
        index,
        crewSize: baseEstimate.crewSize,
        truckCount: baseEstimate.truckCount,
        totalHours,
        amount,
        driveHours,
        distanceKm: billableDistanceKm,
        shareNote,
      }))
      if (routeContext.pricingStatus === 'provisional') {
        lineItems.push({
          description: `[Leg ${index + 1}] Route pending`,
          details: 'Travel route still needs confirmation for this junk removal stop',
          amount: 0,
        })
        missingDestination = true
      }
      totalLoadHours += loadHours
      totalUnloadHours += unloadHours
      totalDriveHours += driveHours
      totalOperationalDriveHours += operationalDriveHours
      totalDriveBufferHours += driveBufferHours
      totalLoadUnloadBufferHours += loadUnloadBufferHours
      totalBillableDistanceKm += billableDistanceKm
      totalOperationalDistanceKm += operationalDistanceKm
      totalOperationalHours += operationalHours
      routeCategories.add(routeContext.routeCategory || baseEstimate.pricingBreakdown.routeCategory)
      continue
    }

    if (leg.type === 'delivery') {
      const deliverySharePct = clampInventorySharePct(leg.inventorySharePct, 20)
      const deliveryScaledLead = buildScaledLeadSnapshot(lead, totalCubicFeet, totalWeightLbs, deliverySharePct)
      const deliveryRouteContext = buildLegRouteContext(leg, baseEstimate.pricingBreakdown.routeCategory)
      const deliveryEstimate = estimateSingleLeadQuote(
        deliveryScaledLead,
        {
          crewSize: baseEstimate.crewSize,
          truckCount: baseEstimate.truckCount,
          estimatedWeightLbs: deliveryScaledLead.totalWeightLbs,
          quoteType: deliveryRouteContext.routeCategory === 'long-distance' ? 'long_distance' : 'standard',
          routeContext: deliveryRouteContext,
        },
        buildLegFactors(baseFactors, leg)
      )

      const deliveryUnloadHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.unloadHours)
      const deliveryDriveHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.driveHours)
      const deliveryOperationalDriveHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.operationalDriveHours)
      const deliveryPenaltyHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.penaltyHours)
      const deliveryDriveBufferHours = roundQuarterHour(
        deliveryRouteContext.routeCategory === 'long-distance' ? 0 : deliveryDriveHours * 0.1
      )
      const deliveryLoadUnloadBufferHours = roundQuarterHour(
        deliveryRouteContext.routeCategory === 'long-distance' ? 0 : (deliveryUnloadHours + deliveryPenaltyHours) * 0.1
      )
      const deliveryTotalHours = Math.max(
        1.5,
        roundQuarterHour(
          deliveryUnloadHours +
            deliveryDriveHours +
            deliveryPenaltyHours +
            deliveryDriveBufferHours +
            deliveryLoadUnloadBufferHours
        )
      )
      const deliveryOperationalHours = roundQuarterHour(
        deliveryUnloadHours +
          deliveryOperationalDriveHours +
          deliveryPenaltyHours +
          deliveryDriveBufferHours +
          deliveryLoadUnloadBufferHours
      )
      const deliveryLongDistanceOperationalBase =
        Number(deliveryEstimate.longDistanceTruckCost || 0) +
        Number(deliveryEstimate.longDistanceGasCost || 0) +
        Number(deliveryEstimate.longDistanceInsuranceCost || 0) +
        Number(deliveryEstimate.longDistanceMiscCost || 0)
      const deliveryLongDistanceMarkupAmount = deliveryRouteContext.routeCategory === 'long-distance'
        ? roundCurrency(deliveryLongDistanceOperationalBase * (Number(deliveryEstimate.longDistanceMarkupRate || 0) / 100))
        : 0
      const deliveryAmount = roundCurrency(
        (deliveryTotalHours * baseEstimate.pricingBreakdown.crewRatePerHour) +
          deliveryLongDistanceOperationalBase +
          deliveryLongDistanceMarkupAmount
      )
      lineItems.push(buildLegLineItem({
        leg,
        index,
        crewSize: baseEstimate.crewSize,
        truckCount: baseEstimate.truckCount,
        totalHours: deliveryTotalHours,
        amount: deliveryAmount,
        driveHours: deliveryDriveHours,
        distanceKm: roundCurrency(deliveryEstimate.pricingBreakdown.billableDistanceKm || 0),
        shareNote: `delivers ~${deliverySharePct}% of the overall shipment`,
      }))
      if (deliveryRouteContext.pricingStatus === 'provisional') {
        lineItems.push({
          description: `[Leg ${index + 1}] Route pending`,
          details: 'Travel route still needs confirmation for this stop',
          amount: 0,
        })
        missingDestination = true
      }
      const deliveryLabel = getLegDisplayLabel(leg, index)
      collectedPenalties.push(
        ...deliveryEstimate.pricingBreakdown.penalties.map(penalty => ({
          ...penalty,
          label: `${deliveryLabel} — ${penalty.label}`,
        }))
      )
      routeCategories.add(deliveryRouteContext.routeCategory || baseEstimate.pricingBreakdown.routeCategory)
      totalUnloadHours += deliveryUnloadHours
      totalDriveHours += deliveryDriveHours
      totalOperationalDriveHours += deliveryOperationalDriveHours
      totalPenaltyHours += deliveryPenaltyHours
      totalDriveBufferHours += deliveryDriveBufferHours
      totalLoadUnloadBufferHours += deliveryLoadUnloadBufferHours
      totalBillableDistanceKm += Number(deliveryEstimate.pricingBreakdown.billableDistanceKm || 0)
      totalOperationalDistanceKm += Number(deliveryEstimate.pricingBreakdown.operationalDistanceKm || 0)
      totalOperationalHours += deliveryOperationalHours
      continue
    }

    const deliveryLegs: QuoteLeg[] = []
    for (let cursor = index + 1; cursor < legs.length; cursor += 1) {
      if (legs[cursor].type !== 'delivery') break
      deliveryLegs.push(legs[cursor])
    }
    const defaultDeliveryShare = deliveryLegs.length > 0
      ? Math.max(10, Math.round(40 / deliveryLegs.length))
      : 0
    const deliveryShareTotal = deliveryLegs.reduce(
      (sum, deliveryLeg) => sum + clampInventorySharePct(deliveryLeg.inventorySharePct, defaultDeliveryShare),
      0
    )
    let unloadSharePct = clampInventorySharePct(
      leg.inventorySharePct,
      deliveryLegs.length > 0 ? Math.max(10, 100 - deliveryShareTotal) : 100
    )
    if (deliveryShareTotal > 0 && unloadSharePct + deliveryShareTotal > 100) {
      unloadSharePct = Math.max(10, 100 - deliveryShareTotal)
    }
    const cycleLoadSharePct = deliveryLegs.length > 0
      ? Math.min(100, unloadSharePct + deliveryShareTotal)
      : unloadSharePct
    const scaledLead = buildScaledLeadSnapshot(lead, totalCubicFeet, totalWeightLbs, cycleLoadSharePct)
    const routeContext = buildLegRouteContext(leg, baseEstimate.pricingBreakdown.routeCategory)
    const legEstimate = estimateSingleLeadQuote(
      scaledLead,
      {
        crewSize: baseEstimate.crewSize,
        truckCount: baseEstimate.truckCount,
        estimatedWeightLbs: scaledLead.totalWeightLbs,
        quoteType: routeContext.routeCategory === 'long-distance' ? 'long_distance' : 'standard',
        routeContext,
      },
      buildLegFactors(baseFactors, leg)
    )

    const unloadRatio = cycleLoadSharePct > 0 ? (unloadSharePct / cycleLoadSharePct) : 1
    const loadHours = roundQuarterHour(legEstimate.pricingBreakdown.loadHours)
    const unloadHours = roundQuarterHour(legEstimate.pricingBreakdown.unloadHours * unloadRatio)
    const driveHours = roundQuarterHour(legEstimate.pricingBreakdown.driveHours)
    const operationalDriveHours = roundQuarterHour(legEstimate.pricingBreakdown.operationalDriveHours)
    const penaltyHours = roundQuarterHour(legEstimate.pricingBreakdown.penaltyHours)
    const driveBufferHours = roundQuarterHour(routeContext.routeCategory === 'long-distance' ? 0 : driveHours * 0.1)
    const loadUnloadBufferHours = roundQuarterHour(
      routeContext.routeCategory === 'long-distance' ? 0 : (loadHours + unloadHours + penaltyHours) * 0.1
    )
    const totalHours = Math.max(2, roundQuarterHour(loadHours + unloadHours + driveHours + penaltyHours + driveBufferHours + loadUnloadBufferHours))
    const operationalHours = roundQuarterHour(loadHours + unloadHours + operationalDriveHours + penaltyHours + driveBufferHours + loadUnloadBufferHours)
    const longDistanceOperationalBase =
      Number(legEstimate.longDistanceTruckCost || 0) +
      Number(legEstimate.longDistanceGasCost || 0) +
      Number(legEstimate.longDistanceInsuranceCost || 0) +
      Number(legEstimate.longDistanceMiscCost || 0)
    const longDistanceMarkupAmount = routeContext.routeCategory === 'long-distance'
      ? roundCurrency(longDistanceOperationalBase * (Number(legEstimate.longDistanceMarkupRate || 0) / 100))
      : 0
    const amount = roundCurrency((totalHours * baseEstimate.pricingBreakdown.crewRatePerHour) + longDistanceOperationalBase + longDistanceMarkupAmount)
    const shareNote =
      deliveryLegs.length > 0
        ? `loads ~${cycleLoadSharePct}% of shipment · delivers ~${unloadSharePct}% at this stop`
        : unloadSharePct < 100
          ? `handles ~${unloadSharePct}% of the overall inventory`
          : undefined

    lineItems.push(buildLegLineItem({
      leg,
      index,
      crewSize: baseEstimate.crewSize,
      truckCount: baseEstimate.truckCount,
      totalHours,
      amount,
      driveHours,
      distanceKm: roundCurrency(legEstimate.pricingBreakdown.billableDistanceKm || 0),
      shareNote,
    }))
    if (routeContext.pricingStatus === 'provisional') {
      lineItems.push({
        description: `[Leg ${index + 1}] Route pending`,
        details: 'Travel route still needs confirmation for this stop',
        amount: 0,
      })
      missingDestination = true
    }

    const legLabel = getLegDisplayLabel(leg, index)
    collectedPenalties.push(
      ...legEstimate.pricingBreakdown.penalties.map(penalty => ({
        ...penalty,
        label: `${legLabel} — ${penalty.label}`,
      }))
    )
    routeCategories.add(routeContext.routeCategory || baseEstimate.pricingBreakdown.routeCategory)
    totalLoadHours += loadHours
    totalUnloadHours += unloadHours
    totalDriveHours += driveHours
    totalOperationalDriveHours += operationalDriveHours
    totalPenaltyHours += penaltyHours
    totalDriveBufferHours += driveBufferHours
    totalLoadUnloadBufferHours += loadUnloadBufferHours
    totalBillableDistanceKm += Number(legEstimate.pricingBreakdown.billableDistanceKm || 0)
    totalOperationalDistanceKm += Number(legEstimate.pricingBreakdown.operationalDistanceKm || 0)
    totalOperationalHours += operationalHours

    for (const deliveryLeg of deliveryLegs) {
      index += 1
      const deliveryIndex = index
      const deliverySharePct = clampInventorySharePct(deliveryLeg.inventorySharePct, defaultDeliveryShare)
      const deliveryScaledLead = buildScaledLeadSnapshot(lead, totalCubicFeet, totalWeightLbs, deliverySharePct)
      const deliveryRouteContext = buildLegRouteContext(deliveryLeg, routeContext.routeCategory || baseEstimate.pricingBreakdown.routeCategory)
      const deliveryEstimate = estimateSingleLeadQuote(
        deliveryScaledLead,
        {
          crewSize: baseEstimate.crewSize,
          truckCount: baseEstimate.truckCount,
          estimatedWeightLbs: deliveryScaledLead.totalWeightLbs,
          quoteType: deliveryRouteContext.routeCategory === 'long-distance' ? 'long_distance' : 'standard',
          routeContext: deliveryRouteContext,
        },
        buildLegFactors(baseFactors, deliveryLeg)
      )

      const deliveryLoadHours = 0
      const deliveryUnloadHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.unloadHours)
      const deliveryDriveHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.driveHours)
      const deliveryOperationalDriveHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.operationalDriveHours)
      const deliveryPenaltyHours = roundQuarterHour(deliveryEstimate.pricingBreakdown.penaltyHours)
      const deliveryDriveBufferHours = roundQuarterHour(
        deliveryRouteContext.routeCategory === 'long-distance' ? 0 : deliveryDriveHours * 0.1
      )
      const deliveryLoadUnloadBufferHours = roundQuarterHour(
        deliveryRouteContext.routeCategory === 'long-distance' ? 0 : (deliveryUnloadHours + deliveryPenaltyHours) * 0.1
      )
      const deliveryTotalHours = Math.max(
        1.5,
        roundQuarterHour(
          deliveryUnloadHours +
            deliveryDriveHours +
            deliveryPenaltyHours +
            deliveryDriveBufferHours +
            deliveryLoadUnloadBufferHours
        )
      )
      const deliveryOperationalHours = roundQuarterHour(
        deliveryUnloadHours +
          deliveryOperationalDriveHours +
          deliveryPenaltyHours +
          deliveryDriveBufferHours +
          deliveryLoadUnloadBufferHours
      )
      const deliveryLongDistanceOperationalBase =
        Number(deliveryEstimate.longDistanceTruckCost || 0) +
        Number(deliveryEstimate.longDistanceGasCost || 0) +
        Number(deliveryEstimate.longDistanceInsuranceCost || 0) +
        Number(deliveryEstimate.longDistanceMiscCost || 0)
      const deliveryLongDistanceMarkupAmount = deliveryRouteContext.routeCategory === 'long-distance'
        ? roundCurrency(deliveryLongDistanceOperationalBase * (Number(deliveryEstimate.longDistanceMarkupRate || 0) / 100))
        : 0
      const deliveryAmount = roundCurrency(
        (deliveryTotalHours * baseEstimate.pricingBreakdown.crewRatePerHour) +
          deliveryLongDistanceOperationalBase +
          deliveryLongDistanceMarkupAmount
      )
      lineItems.push(buildLegLineItem({
        leg: deliveryLeg,
        index: deliveryIndex,
        crewSize: baseEstimate.crewSize,
        truckCount: baseEstimate.truckCount,
        totalHours: deliveryTotalHours,
        amount: deliveryAmount,
        driveHours: deliveryDriveHours,
        distanceKm: roundCurrency(deliveryEstimate.pricingBreakdown.billableDistanceKm || 0),
        shareNote: `delivers ~${deliverySharePct}% of the overall shipment`,
      }))
      if (deliveryRouteContext.pricingStatus === 'provisional') {
        lineItems.push({
          description: `[Leg ${deliveryIndex + 1}] Route pending`,
          details: 'Travel route still needs confirmation for this stop',
          amount: 0,
        })
        missingDestination = true
      }
      const deliveryLabel = getLegDisplayLabel(deliveryLeg, deliveryIndex)
      collectedPenalties.push(
        ...deliveryEstimate.pricingBreakdown.penalties.map(penalty => ({
          ...penalty,
          label: `${deliveryLabel} — ${penalty.label}`,
        }))
      )
      routeCategories.add(deliveryRouteContext.routeCategory || baseEstimate.pricingBreakdown.routeCategory)
      totalLoadHours += deliveryLoadHours
      totalUnloadHours += deliveryUnloadHours
      totalDriveHours += deliveryDriveHours
      totalOperationalDriveHours += deliveryOperationalDriveHours
      totalPenaltyHours += deliveryPenaltyHours
      totalDriveBufferHours += deliveryDriveBufferHours
      totalLoadUnloadBufferHours += deliveryLoadUnloadBufferHours
      totalBillableDistanceKm += Number(deliveryEstimate.pricingBreakdown.billableDistanceKm || 0)
      totalOperationalDistanceKm += Number(deliveryEstimate.pricingBreakdown.operationalDistanceKm || 0)
      totalOperationalHours += deliveryOperationalHours
    }
  }

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
        collectedPenalties
          .filter(penalty => penalty.category === entry.category && !penalty.isFlagOnly)
          .reduce((sum, penalty) => sum + penalty.hours, 0)
      ),
    }))
    .filter(entry => entry.hours > 0)

  const routeCategory: PricingBreakdown['routeCategory'] =
    routeCategories.has('long-distance')
      ? 'long-distance'
      : routeCategories.has('medium')
        ? 'medium'
        : baseEstimate.pricingBreakdown.routeCategory
  const pricingStatus: PricingBreakdown['pricingStatus'] = missingDestination ? 'provisional' : 'ready'
  const totalHours = roundQuarterHour(totalLoadHours + totalUnloadHours + totalDriveHours + totalPenaltyHours + totalDriveBufferHours + totalLoadUnloadBufferHours)
  const distinctDays = new Set(legs.map(leg => leg.scheduledDate).filter(Boolean)).size || 1
  const laborCost = roundCurrency(baseEstimate.crewSize * totalOperationalHours * LABOR_COST_PER_MOVER_HOUR)
  const truckDailyCost = roundCurrency(baseEstimate.truckCount * TRUCK_DAILY_COST * distinctDays)
  const truckFuelMileageCost = roundCurrency(totalOperationalDistanceKm * baseEstimate.truckCount * TRUCK_OPS_COST_PER_KM)
  const truckOpsCost = roundCurrency(truckDailyCost + truckFuelMileageCost)
  const computedRevenue = roundCurrency(lineItems.reduce((sum, item) => sum + Number(item.amount || 0), 0))
  const commissionCost = roundCurrency(computedRevenue * COMMISSION_RATE)
  const suppliesCost = roundCurrency((lead.jobFactors?.estimatedBoxes || 0) * PACKING_SUPPLIES_COST_PER_BOX)
  const directCost = roundCurrency(laborCost + truckOpsCost + commissionCost + suppliesCost)
  const grossProfit = roundCurrency(computedRevenue - directCost)
  const grossMarginPct = computedRevenue > 0 ? Math.round((grossProfit / computedRevenue) * 1000) / 10 : 0
  const twoDayMoveEstimate = distinctDays >= 2
    ? {
        day1Hours: Math.max(3, roundQuarterHour(totalHours / distinctDays)),
        day2Hours: Math.max(3, roundQuarterHour(totalHours - Math.max(3, roundQuarterHour(totalHours / distinctDays)))),
        note: 'Split across multiple legs / days — confirm dates and key timing on the final quote.',
      }
    : baseEstimate.pricingBreakdown.intelligenceFlags.twoDayMoveEstimate

  const pricingBreakdown: PricingBreakdown = {
    ...baseEstimate.pricingBreakdown,
    loadHours: roundQuarterHour(totalLoadHours),
    driveHours: roundQuarterHour(totalDriveHours),
    operationalDriveHours: roundQuarterHour(totalOperationalDriveHours),
    unloadHours: roundQuarterHour(totalUnloadHours),
    baseHours: roundQuarterHour(totalLoadHours + totalUnloadHours + totalDriveHours),
    penaltyHours: roundQuarterHour(totalPenaltyHours),
    driveBufferHours: roundQuarterHour(totalDriveBufferHours),
    loadUnloadBufferHours: roundQuarterHour(totalLoadUnloadBufferHours),
    bufferHours: roundQuarterHour(totalDriveBufferHours + totalLoadUnloadBufferHours),
    totalHours: Math.max(3, totalHours),
    operationalHours: roundQuarterHour(totalOperationalHours),
    pricingStatus,
    routeCategory,
    billableDistanceKm: roundCurrency(totalBillableDistanceKm),
    operationalDistanceKm: roundCurrency(totalOperationalDistanceKm),
    penalties: collectedPenalties,
    adjustmentBreakdown,
    internalCostEstimate: {
      laborCost,
      truckDailyCost,
      truckFuelMileageCost,
      truckOpsCost,
      commissionCost,
      suppliesCost,
      totalCost: directCost,
      grossProfit,
      grossMarginPct,
      computedRevenue,
    },
    intelligenceFlags: {
      ...baseEstimate.pricingBreakdown.intelligenceFlags,
      fullDayFlag: totalHours >= 14,
      missingDestination,
      twoDayMoveEstimate,
    },
  }

  return {
    ...computeQuoteTotals(lineItems, getDefaultDepositRate(lead.moveType)),
    crewSize: baseEstimate.crewSize,
    estimatedHours: Math.max(3, pricingBreakdown.totalHours),
    truckCount: baseEstimate.truckCount,
    estimatedWeightLbs: totalWeightLbs || undefined,
    longDistanceDistanceKm: roundCurrency(totalBillableDistanceKm) || undefined,
    longDistanceTruckCost: undefined,
    longDistanceGasCost: undefined,
    longDistanceInsuranceCost: undefined,
    longDistanceMiscCost: undefined,
    longDistanceMarkupRate: undefined,
    suggestedCrewRate: baseEstimate.suggestedCrewRate,
    pricingBreakdown,
  }
}

export function estimateLeadQuote(
  lead: CRMLead,
  overrides?: EstimateQuoteOverrides,
  factors?: JobFactors
): EstimateQuoteResult {
  const legs = (overrides?.legs || []).filter(leg =>
    !!(leg.originAddress || leg.originCity || leg.destAddress || leg.destCity || leg.label || leg.type)
  )
  if (legs.length === 0) {
    return estimateSingleLeadQuote(lead, overrides, factors)
  }
  return buildMultiLegEstimate(lead, { ...overrides, legs }, factors)
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
  const normalized = applyMovePolicyToInventory(inventory, { enforceExclusion: true })
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
  const activeLeads = leads.filter(lead => !isClosedLeadStage(lead.stage))
  const quotedLeads = leads.filter(lead => lead.stage === 'quoted' || lead.stage === 'tentative')
  const bookedLeads = leads.filter(lead => isBookedLikeStage(lead.stage))
  const leadsDueToday = activeLeads.filter(lead => lead.followUpDate && lead.followUpDate <= today).length
  const overdueLeads = activeLeads.filter(lead => lead.followUpDate && lead.followUpDate < today).length

  // Build a lookup by leadId so we can find any quote for a lead even if quoteId
  // on the lead record points to a different revision
  const quoteByLeadId = new Map<string, CRMQuote>()
  for (const quote of quotes) {
    if (!quote.leadId) continue
    const existing = quoteByLeadId.get(quote.leadId)
    // Prefer accepted > sent > viewed > draft; otherwise take the highest total
    const betterStatus = (q: CRMQuote) => ['accepted', 'invoiced', 'sent', 'viewed', 'draft'].indexOf(q.status || 'draft')
    if (!existing || betterStatus(quote) < betterStatus(existing) || (!existing.total && quote.total)) {
      quoteByLeadId.set(quote.leadId, quote)
    }
  }

  function findQuoteForLead(lead: CRMLead) {
    return (lead.quoteId ? quotes.find(q => q.id === lead.quoteId) : null) ||
           quoteByLeadId.get(lead.id) ||
           null
  }

  const quotedPipelineValue = quotedLeads.reduce((sum, lead) => {
    const quote = findQuoteForLead(lead)
    return sum + (quote?.total || 0)
  }, 0)

  const bookedRevenue = bookedLeads.reduce((sum, lead) => {
    const quote = findQuoteForLead(lead)
    return sum + (quote?.total || 0)
  }, 0)

  return {
    totalLeads: leads.length,
    activeLeads: activeLeads.length,
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
