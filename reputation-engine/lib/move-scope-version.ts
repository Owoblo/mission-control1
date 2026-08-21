import type { CRMLead, CRMQuote, InventoryItem } from './types'
import { hiddenInventoryCoverage } from './quote-readiness'

export const MOVE_SCOPE_SCHEMA_VERSION = 1 as const

export type ScopeEvidenceReference = {
  id: string
  kind: 'image' | 'video' | 'document' | 'listing'
  url?: string
  room?: string
  source: string
  capturedAt?: string
}

export type MoveScopeItem = {
  key: string
  name: string
  room: string
  quantity: number
  cubicFeetEach: number | null
  weightLbsEach: number | null
  expectedCubicFeet: number | null
  expectedWeightLbs: number | null
  source: string
  confidence: number | null
  status: string
  disassemblyRequired: boolean
  reassemblyRequired: boolean
  handlingLevel: string
  specialEquipment: string[]
  unknowns: string[]
}

export type MoveScopeSnapshot = {
  schemaVersion: typeof MOVE_SCOPE_SCHEMA_VERSION
  leadId: string
  quoteId: string
  generatedAt: string
  customer: { name: string; phone?: string; email?: string }
  schedule: { moveDate?: string; moveTime?: string; moveType?: string; quoteType?: string }
  route: {
    origin: { address?: string; city?: string; access?: string }
    destination: { address?: string; city?: string; access?: string }
    additionalStops: number
    legs: CRMQuote['legs']
  }
  inventory: MoveScopeItem[]
  inventoryTotals: {
    itemCount: number
    expectedCubicFeet: number
    expectedWeightLbs: number
    unknownDimensionItemCount: number
    estimatedBoxes: number
  }
  jobFactors: CRMLead['jobFactors']
  assumptions: {
    crewSize?: number
    truckCount?: number
    truckSize?: string
    estimatedHours?: number
    billingModel?: CRMQuote['billingModel']
    tripAssumption: string
  }
  commercialTerms: {
    lineItems: CRMQuote['lineItems']
    discountAmount: number
    subtotal: number
    hst: number
    total: number
    deposit: number
    balance: number
    servicesDescription?: string
    conditionalClause?: string
  }
  evidence: ScopeEvidenceReference[]
  unknowns: string[]
  exclusions: Array<{ name: string; room: string; reason: string }>
  acceptance?: {
    acceptedAt: string
    termsVersion: string
    customerConfirmedScope: boolean
    customerConfirmedHiddenAreas: boolean
    customerConfirmedAccess: boolean
    customerConfirmedSpecialtyItems: boolean
    customerAcknowledgedArrivalVerification: boolean
    customerAcknowledgedChangeOrders: boolean
    ipAddress?: string
    userAgent?: string
  }
}

export type WalkthroughVerification = {
  scopeVersionId: string
  inventory: {
    materiallyMatches: boolean
    expectedBoxes: number
    observedBoxes: number
    addedItems: Array<{ name: string; quantity: number; room?: string }>
    removedItems: Array<{ name: string; quantity: number; room?: string }>
    garageVerified: boolean | null
    basementVerified: boolean | null
    storageVerified: boolean | null
  }
  access: {
    stairsMatch: boolean
    elevatorMatch: boolean
    parkingMatch: boolean
    carryDistanceMatch: boolean
    restrictions: string[]
  }
  handling: {
    undisclosedHeavyItems: string[]
    unplannedDisassembly: string[]
    missingEquipment: string[]
  }
  capacity: {
    truckPlanAppropriate: boolean
    visualAssessment: 'under_expected' | 'within_expected' | 'over_expected'
    note?: string
  }
  evidence: Array<{ url: string; kind: 'image' | 'video'; label?: string }>
  note?: string
}

function label(item: InventoryItem) {
  return (item.name || item.item || 'Unnamed item').trim()
}

function itemKey(item: InventoryItem, index: number) {
  return item.id || `${(item.room || 'unassigned').toLowerCase()}::${label(item).toLowerCase()}::${index + 1}`
}

function disassemblyRequired(item: InventoryItem) {
  const flags = item.handlingProfile?.flags || []
  return Boolean(item.handlingProfile?.disassemblyLikelihood && item.handlingProfile.disassemblyLikelihood >= 0.5) ||
    flags.some(flag => /disassembl/i.test(flag)) || /disassembl/i.test(item.notes || '')
}

export function buildMoveScopeSnapshot(
  lead: CRMLead,
  quote: CRMQuote,
  generatedAt = new Date().toISOString(),
  acceptance?: MoveScopeSnapshot['acceptance']
): MoveScopeSnapshot {
  const included = (lead.inventory || []).filter(item => item.included !== false)
  const excluded = (lead.inventory || []).filter(item => item.included === false)
  const inventory = included.map((item, index): MoveScopeItem => {
    const quantity = Math.max(1, Number(item.qty || 1))
    const cubicFeetEach = Number(item.cubicFeet || 0) > 0 ? Number(item.cubicFeet) : null
    const weightLbsEach = Number(item.weightLbs || 0) > 0 ? Number(item.weightLbs) : null
    const requiresDisassembly = disassemblyRequired(item)
    const unknowns = [
      cubicFeetEach === null ? 'cubic_feet' : '',
      weightLbsEach === null ? 'weight_lbs' : '',
      item.status === 'needs_confirmation' ? 'customer_confirmation' : '',
    ].filter(Boolean)
    return {
      key: itemKey(item, index),
      name: label(item),
      room: item.room || 'Unassigned',
      quantity,
      cubicFeetEach,
      weightLbsEach,
      expectedCubicFeet: cubicFeetEach === null ? null : cubicFeetEach * quantity,
      expectedWeightLbs: weightLbsEach === null ? null : weightLbsEach * quantity,
      source: item.source || 'unknown',
      confidence: Number.isFinite(Number(item.confidence)) ? Number(item.confidence) : null,
      status: item.status || 'unreviewed',
      disassemblyRequired: requiresDisassembly,
      reassemblyRequired: requiresDisassembly && lead.jobFactors?.disassemblyMode !== 'disassemble_only',
      handlingLevel: item.handlingProfile?.level || 'standard',
      specialEquipment: [...(item.handlingProfile?.specialEquipment || [])],
      unknowns,
    }
  })
  const unknowns = [
    !lead.originAddress ? 'origin_address' : '',
    lead.moveType !== 'labor-only' && lead.quoteType !== 'labor_only' && !lead.destAddress ? 'destination_address' : '',
    !lead.inventoryVerification?.completedAt ? 'customer_inventory_confirmation' : '',
    ...hiddenInventoryCoverage(lead.jobFactors).filter(area => !area.resolved).map(area => `hidden_inventory:${area.key}`),
    ...inventory.flatMap(item => item.unknowns.map(field => `inventory:${item.key}:${field}`)),
  ].filter(Boolean)
  const evidence: ScopeEvidenceReference[] = (lead.mediaAssets || [])
    .filter(asset => !asset.removed)
    .map(asset => ({ id: asset.id, kind: asset.kind, url: asset.url, room: asset.room, source: asset.source, capturedAt: asset.uploadedAt }))
  if (lead.supabaseListing) evidence.push({ id: `listing:${lead.supabaseListing.zpid}`, kind: 'listing', source: 'mls', capturedAt: lead.supabaseListing.furniture_scan_date || undefined })

  return {
    schemaVersion: MOVE_SCOPE_SCHEMA_VERSION,
    leadId: lead.id,
    quoteId: quote.id,
    generatedAt,
    customer: { name: lead.name, phone: lead.phone, email: lead.email },
    schedule: { moveDate: quote.moveDate || lead.moveDate, moveTime: quote.moveTime, moveType: quote.moveType || lead.moveType, quoteType: quote.quoteType || lead.quoteType },
    route: {
      origin: { address: quote.originAddress || lead.originAddress, city: quote.originCity || lead.originCity, access: lead.originAccess },
      destination: { address: quote.destAddress || lead.destAddress, city: quote.destCity || lead.destCity, access: lead.destAccess },
      additionalStops: Number(lead.additionalStops || 0),
      legs: quote.legs || [],
    },
    inventory,
    inventoryTotals: {
      itemCount: inventory.reduce((sum, item) => sum + item.quantity, 0),
      expectedCubicFeet: inventory.reduce((sum, item) => sum + (item.expectedCubicFeet || 0), 0),
      expectedWeightLbs: inventory.reduce((sum, item) => sum + (item.expectedWeightLbs || 0), 0),
      unknownDimensionItemCount: inventory.filter(item => item.cubicFeetEach === null || item.weightLbsEach === null).reduce((sum, item) => sum + item.quantity, 0),
      estimatedBoxes: Number(lead.jobFactors?.estimatedBoxes || 0),
    },
    jobFactors: lead.jobFactors,
    assumptions: {
      crewSize: quote.crewSize,
      truckCount: quote.truckCount,
      truckSize: lead.truckSize,
      estimatedHours: quote.estimatedHours,
      billingModel: quote.billingModel,
      tripAssumption: quote.truckCount && quote.truckCount > 1 ? `${quote.truckCount} trucks; one planned trip` : quote.conditionalClause || 'One truck; one planned trip unless otherwise stated',
    },
    commercialTerms: {
      lineItems: quote.lineItems.map(item => ({ ...item })),
      discountAmount: Number(quote.discountAmount || 0),
      subtotal: quote.subtotal,
      hst: quote.hst,
      total: quote.total,
      deposit: quote.deposit,
      balance: quote.balance,
      servicesDescription: quote.moveDescription,
      conditionalClause: quote.conditionalClause,
    },
    evidence,
    unknowns,
    exclusions: excluded.map(item => ({ name: label(item), room: item.room || 'Unassigned', reason: item.exclusionReason || item.policyReason || 'Excluded from scope' })),
    acceptance,
  }
}

export function validateWalkthrough(input: WalkthroughVerification) {
  const errors: string[] = []
  if (!input.scopeVersionId?.trim()) errors.push('scope version is required')
  if (!Number.isFinite(input.inventory.expectedBoxes) || input.inventory.expectedBoxes < 0) errors.push('expected box count is invalid')
  if (!Number.isFinite(input.inventory.observedBoxes) || input.inventory.observedBoxes < 0) errors.push('observed box count is invalid')
  if (input.evidence.length === 0) errors.push('at least one arrival photo or video is required')
  const discrepancy = !input.inventory.materiallyMatches ||
    input.inventory.expectedBoxes !== input.inventory.observedBoxes ||
    input.inventory.addedItems.length > 0 || input.inventory.removedItems.length > 0 ||
    !input.access.stairsMatch || !input.access.elevatorMatch || !input.access.parkingMatch || !input.access.carryDistanceMatch ||
    input.handling.undisclosedHeavyItems.length > 0 || input.handling.unplannedDisassembly.length > 0 || input.handling.missingEquipment.length > 0 ||
    !input.capacity.truckPlanAppropriate || input.capacity.visualAssessment === 'over_expected'
  return { valid: errors.length === 0, errors, outcome: discrepancy ? 'discrepancy' as const : 'match' as const }
}
