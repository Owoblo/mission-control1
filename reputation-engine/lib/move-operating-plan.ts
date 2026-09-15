import type { CRMLead, CRMQuote, CrewPayoutEntry } from './types'
import { assemblyText, buildAssemblyPlan, COMPLEX_ASSEMBLY } from './assembly-planning'
import { recommendTruckLoadPlan } from './truck-planning'

export interface OperatingReview {
  fingerprint: string
  reviewedAt: string
  reviewedBy: string
  rationale: string
  plannedHours: number
  snapshot?: {
    scope: Record<string, unknown>
    truckPlan?: ReturnType<typeof recommendTruckLoadPlan>
    assembly: ReturnType<typeof buildAssemblyPlan>
    reasons: string[]
  }
}

export function crewAcknowledgedPlan(entry: CrewPayoutEntry, fingerprint: string) {
  return entry.dispatchStatus === 'confirmed' && entry.dispatchPlanFingerprint === fingerprint
}

/** A stable scope identifier for change detection, not an authentication token. */
export function planningFingerprint(value: unknown): string {
  function canonical(v: any): any {
    if (Array.isArray(v)) return v.map(canonical)
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canonical(v[k])]))
    return v
  }
  const text = JSON.stringify(canonical(value))
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return `ops-v1-${(hash >>> 0).toString(16)}`
}

export function buildMoveOperatingPlan(lead: CRMLead, quote?: CRMQuote | null) {
  const inventory = (lead.inventory || []).filter(item => item.included !== false)
  const volume = inventory.reduce((sum, item) => sum + Number(item.cubicFeet || 0) * Math.max(1, Number(item.qty || 1)), 0)
  const weight = inventory.reduce((sum, item) => sum + Number(item.weightLbs || 0) * Math.max(1, Number(item.qty || 1)), 0)
  const serviceType = quote?.quoteType || lead.quoteType
  const noTruck = serviceType ? ['labor_only', 'packing_only'].includes(serviceType) : ['labor-only', 'packing'].includes(lead.moveType || '')
  const truckPlan = noTruck ? undefined : recommendTruckLoadPlan({ totalCubicFeet: volume, totalWeightLbs: weight,
    truckCount: quote?.truckCount || lead.truckCountConfirmed, committedSize: lead.truckSize || quote?.truckSize, inventory })
  const assembly = buildAssemblyPlan(lead.inventory || [], lead.jobFactors?.disassemblyMode)
  const reasons = [...assembly.reviewReasons, ...(truckPlan?.reviewReasons || [])]
  const invalidInventory = inventory.some(item => (item.qty !== undefined && (!Number.isFinite(item.qty) || item.qty <= 0)) ||
    [item.cubicFeet, item.weightLbs].some(value => value !== undefined && (!Number.isFinite(value) || value < 0)))
  if (invalidInventory) reasons.push('Inventory has invalid quantities, volume or weight. Correct the item values before approval.')
  for (const item of lead.inventory || []) {
    if (item.included === false && !item.exclusionReason?.trim()) reasons.push(`${item.name || item.item || 'Excluded item'}: record why it is excluded and the customer/source evidence.`)
    if (item.included === false && item.status === 'confirmed') reasons.push(`${item.name || item.item || 'Excluded item'}: confirmed inventory is marked excluded; reconcile the customer's instructions.`)
  }
  const significant = inventory.some(item => COMPLEX_ASSEMBLY.test(assemblyText(item)) || Number(item.weightLbs) >= 100 || /sofa|sectional|hutch|bbq|grill|basement/i.test(assemblyText(item) + ' ' + item.room))
  const originKnown = Boolean(lead.originAccess?.trim())
  const destinationKnown = Boolean(lead.destAccess?.trim())
  if (significant && !originKnown) reasons.push('Origin carrying route is unknown: confirm floors, stairs/walkout, turns and carry distance.')
  if (significant && !destinationKnown) reasons.push('Destination carrying route is unknown: confirm floors, stairs/elevator, turns and carry distance.')
  if (significant && !lead.parkingNotes?.trim()) reasons.push('Parking and truck-to-door carrying distance are unconfirmed.')
  if (/pull[ -]?out|trundle/i.test([lead.notes, ...(lead.removedInventoryItemKeys || [])].join(' ')) &&
    inventory.some(item => /day[ -]?bed/i.test(assemblyText(item))) && !inventory.some(item => /pull[ -]?out|trundle/i.test(assemblyText(item)))) {
    reasons.push('Customer history mentions a pullout/trundle, but retained inventory does not. Reconcile the component and preserve its handling details.')
  }
  if (quote?.truckSize && lead.truckSize && quote.truckSize !== lead.truckSize) reasons.push(`Quote truck ${quote.truckSize} differs from dispatch ${lead.truckSize}; reconcile the committed plan.`)
  if (quote?.truckCount && lead.truckCountConfirmed && quote.truckCount !== lead.truckCountConfirmed) reasons.push(`Quote truck count ${quote.truckCount} differs from confirmed dispatch count ${lead.truckCountConfirmed}; reconcile the committed plan.`)
  if (truckPlan && lead.truckReservationStatus === 'not_needed') reasons.push('Truck move is incorrectly marked “no truck needed”; confirm reservation.')
  const crew = quote?.crewSize || 0
  if (assembly.tasks.some(task => task.workers > crew)) reasons.push('Assembly task requires more workers than the planned crew.')
  const scope = { serviceType, moveType: lead.moveType, legs: quote?.legs, originCity: lead.originCity, destCity: lead.destCity, inventory: lead.inventory, factors: lead.jobFactors, moveDate: lead.moveDate || quote?.moveDate,
    moveTime: lead.moveTime || quote?.moveTime, origin: lead.originAddress, destination: lead.destAddress,
    originAccess: lead.originAccess, destAccess: lead.destAccess, parking: lead.parkingNotes,
    truckSize: lead.truckSize || quote?.truckSize, truckCount: quote?.truckCount || lead.truckCountConfirmed,
    quotedTruckSize: quote?.truckSize, confirmedTruckCount: lead.truckCountConfirmed,
    truckReservationStatus: lead.truckReservationStatus, truckVendor: lead.truckVendor,
    truckPickupLocation: lead.truckPickupLocation, truckPickupTime: lead.truckPickupTime,
    truckReturnLocation: lead.truckReturnLocation, truckReservationNumber: lead.truckReservationNumber,
    truckReservationNotes: lead.truckReservationNotes,
    crew, hours: quote?.estimatedHours, billing: quote?.billingModel, subtotal: quote?.subtotal, discount: quote?.discountAmount,
    lineItems: quote?.lineItems,
    removed: lead.removedInventoryItemKeys, notes: lead.notes }
  const fingerprint = planningFingerprint(scope)
  const reviewCurrent = lead.operatingReview?.fingerprint === fingerprint
  const reviewRequired = reasons.length > 0 || Boolean(truckPlan)
  return { fingerprint, reviewCurrent, reviewRequired, ready: !invalidInventory && (!reviewRequired || reviewCurrent) && (!truckPlan || (truckPlan.fits && lead.truckReservationStatus !== 'not_needed')),
    invalidInventory,
    snapshot: structuredClone({ scope, truckPlan, assembly, reasons: Array.from(new Set(reasons)) }),
    reasons: Array.from(new Set(reasons)), assembly, truckPlan, originKnown, destinationKnown,
    plannedHours: reviewCurrent ? lead.operatingReview!.plannedHours : quote?.estimatedHours }
}

export function buildCurrentCrewBrief(lead: CRMLead, quote?: CRMQuote | null) {
  const plan = buildMoveOperatingPlan(lead, quote)
  const billing = quote?.billingModel || (quote?.number?.startsWith('FL-') ? 'hourly_minimum' : 'binding')
  return [
    'CURRENT OPERATIONS BRIEF',
    `Customer: ${lead.name}`,
    `Move: ${lead.moveDate || quote?.moveDate || 'Date unconfirmed'} at ${lead.moveTime || quote?.moveTime || 'time unconfirmed'}`,
    `Route: ${lead.originAddress || 'Origin unconfirmed'} → ${lead.destAddress || 'Destination unconfirmed'}`,
    `Billing: ${billing === 'binding' ? 'BINDING — record actual time; office handles any separately authorized scope changes.' : 'HOURLY — record actual hours and breaks.'}`,
    `Crew: ${quote?.crewSize || '?'} movers. Truck: ${plan.truckPlan?.summary || 'Customer supplies transport / no truck service'}.`,
    `Working plan: ${plan.plannedHours || '?'} crew-clock hours. Assembly below is included in planning, not extra billing.`,
    `Origin access: ${lead.originAccess || 'UNCONFIRMED'}. Destination access: ${lead.destAccess || 'UNCONFIRMED'}. Parking: ${lead.parkingNotes || 'UNCONFIRMED'}.`,
    `Operations review: ${plan.ready ? 'CURRENT' : 'REQUIRED — do not treat this packet as cleared for dispatch'}.`,
    ...plan.reasons.map(reason => `CHECK: ${reason}`),
    ...(plan.reviewCurrent ? [`Operations decision: ${lead.operatingReview!.rationale}`] : []),
    'ASSEMBLY TASKS (sequential allowances; coordinate workers before overlapping with loading):',
    ...plan.assembly.tasks.map(task => `${task.quantity} × ${task.itemLabel}: ${task.end === 'origin' ? 'disassemble' : 'reassemble'}, ${task.minutes} min, ${task.workers} worker(s)${task.provisional ? ' — provisional' : ''}. ${task.tools}`),
    'INVENTORY:',
    ...(lead.inventory || []).map(item => `${item.included === false ? 'EXCLUDED' : 'MOVE'}: ${item.qty || 1} × ${item.name || item.item}${item.room ? ` [${item.room}]` : ''}${item.notes ? ` — ${item.notes}` : ''}`),
  ].join('\n')
}
