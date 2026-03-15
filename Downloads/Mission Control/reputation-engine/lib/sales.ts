import type {
  CRMLead,
  CRMQuote,
  CRMClient,
  FollowUpLog,
  InventoryItem,
  QuoteLineItem,
  QuoteStatus,
  SalesDashboardSummary,
  SalesLeadStage,
} from './types'

export const SALES_LEAD_STAGES: Array<{ id: SalesLeadStage; label: string }> = [
  { id: 'new', label: 'New Call' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'pricing', label: 'Building Quote' },
  { id: 'quoted', label: 'Quoted' },
  { id: 'nurture', label: 'Shopping Around' },
  { id: 'booked', label: 'Booked' },
  { id: 'lost', label: 'Lost' },
]

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
  3: 230,
  4: 365,
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

export function suggestTruckCount(totalCubicFeet: number, moveType?: CRMLead['moveType']) {
  if (moveType === 'long-distance') {
    return totalCubicFeet >= 1500 ? 2 : 1
  }

  return totalCubicFeet >= 1600 ? 2 : 1
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
  >
) {
  const isLongDistance = lead.moveType === 'long-distance'
  const isLaborOnly = lead.moveType === 'labor-only'
  const isPacking = lead.moveType === 'packing'
  const metrics = deriveInventoryMetrics(lead.inventory || [])
  const totalCubicFeet = lead.totalCubicFeet || metrics.totalCubicFeet
  const totalWeightLbs = Number(overrides?.estimatedWeightLbs || lead.totalWeightLbs || metrics.totalWeightLbs)
  const crewSize = Number(overrides?.crewSize || suggestCrewSize(totalWeightLbs, totalCubicFeet, metrics.includedInventory))
  const truckCount = Number(overrides?.truckCount || suggestTruckCount(totalCubicFeet, lead.moveType))
  const crewRate = getCrewRate(crewSize, lead.moveType)
  const longDistanceTruckCost = Number(overrides?.longDistanceTruckCost || (isLongDistance ? Math.max(650, truckCount * 650) : 0))
  const longDistanceGasCost = Number(overrides?.longDistanceGasCost || (isLongDistance ? Math.max(250, truckCount * 250) : 0))
  const longDistanceInsuranceCost = Number(overrides?.longDistanceInsuranceCost || (isLongDistance ? 150 : 0))
  const longDistanceMiscCost = Number(overrides?.longDistanceMiscCost || (isLongDistance ? 150 : 0))
  const longDistanceMarkupRate = Number(overrides?.longDistanceMarkupRate || (isLongDistance ? 40 : 0))
  const portalHours = isLongDistance ? 1.5 : isLaborOnly ? 0.5 : 1
  const laborHours =
    totalWeightLbs > 0
      ? totalWeightLbs / 350 / Math.max(1, crewSize)
      : totalCubicFeet > 0
        ? totalCubicFeet / (crewSize >= 4 ? 150 : crewSize === 3 ? 190 : crewSize === 2 ? 220 : 120)
        : isLongDistance
          ? 9
          : crewSize >= 3
            ? 5
            : 4
  const estimatedHours = Math.max(3, Number(overrides?.estimatedHours || roundQuarterHour(laborHours + portalHours)))
  const laborAmount = Math.round(estimatedHours * crewRate)
  const travelAmount = isLaborOnly ? 0 : Math.round(Math.max(0, portalHours * crewRate * 0.35))
  const longDistanceOperationalBase = longDistanceTruckCost + longDistanceGasCost + longDistanceInsuranceCost + longDistanceMiscCost
  const longDistanceMarkupAmount = isLongDistance ? Math.round(longDistanceOperationalBase * (longDistanceMarkupRate / 100)) : 0
  const extraTruckAmount =
    truckCount > 1
      ? isLongDistance
        ? Math.round((truckCount - 1) * estimatedHours * getCrewRate(2, lead.moveType))
        : Math.round((truckCount - 1) * estimatedHours * getCrewRate(2, lead.moveType) * 0.85)
      : 0

  const lineItems: QuoteLineItem[] = [
    {
      description: isPacking ? 'Packing labor' : isLongDistance ? 'Long-distance moving labor' : isLaborOnly ? 'Labor-only moving crew' : 'Local moving labor',
      details:
        totalWeightLbs > 0
          ? `${totalWeightLbs} lbs estimated · ${crewSize} movers · ${estimatedHours} portal-to-portal hours · 350 lbs/man-hour`
          : totalCubicFeet > 0
            ? `${totalCubicFeet} cu ft estimated · ${crewSize} movers · ${estimatedHours} portal-to-portal hours`
            : `${isLongDistance ? 'Long-distance' : isLaborOnly ? 'Labor-only' : isPacking ? 'Packing' : 'Local'} estimate with ${crewSize} movers`,
      amount: laborAmount,
    },
  ]

  if (travelAmount > 0) {
    lineItems.push({
      description: isLongDistance ? 'Dispatch and route coverage' : 'Portal-to-portal travel allowance',
      details: isLongDistance ? 'Routing, dispatch, and staging allowance' : 'Crew travel buffer',
      amount: travelAmount,
    })
  }

  if (longDistanceTruckCost > 0) {
    lineItems.push({
      description: 'One-way truck rental',
      details: `${truckCount} truck${truckCount > 1 ? 's' : ''} estimated for the long-distance route`,
      amount: longDistanceTruckCost,
    })
  }

  if (longDistanceGasCost > 0) {
    lineItems.push({
      description: 'Fuel allowance',
      details: 'Estimated using default long-distance fuel assumptions',
      amount: longDistanceGasCost,
    })
  }

  if (longDistanceInsuranceCost > 0) {
    lineItems.push({
      description: 'Truck insurance allowance',
      details: 'Default insurance coverage assumption',
      amount: longDistanceInsuranceCost,
    })
  }

  if (longDistanceMiscCost > 0) {
    lineItems.push({
      description: 'Long-distance misc allowance',
      details: 'Rental car, tolls, and route contingency',
      amount: longDistanceMiscCost,
    })
  }

  if (longDistanceMarkupAmount > 0) {
    lineItems.push({
      description: 'Long-distance route markup',
      details: `${longDistanceMarkupRate}% markup on truck, fuel, insurance, and misc`,
      amount: longDistanceMarkupAmount,
    })
  }

  if (extraTruckAmount > 0) {
    lineItems.push({
      description: 'Additional truck and crew package',
      details: `${truckCount} trucks suggested from inventory volume`,
      amount: extraTruckAmount,
    })
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
