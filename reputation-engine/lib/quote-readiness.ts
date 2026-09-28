import type { CRMLead, CRMQuote, HiddenInventoryArea, HiddenInventoryCoverage, JobFactors } from './types'
import { calculateMoveAccessPlan } from './access-profile'
import { confirmedMoveAccess } from './access-intelligence'

export const HIDDEN_INVENTORY_AREAS: Array<{ key: HiddenInventoryArea; label: string; prompt: string }> = [
  { key: 'basement', label: 'Basement', prompt: "I don't see the full basement. Is it finished or unfinished, and what is currently down there that is moving?" },
  { key: 'garage', label: 'Garage', prompt: 'What is in the garage—shelving, tools, tires, bikes, lawn equipment, or stored boxes?' },
  { key: 'outdoor', label: 'Outdoor / patio / shed', prompt: 'Are patio furniture, a barbecue, shed contents, planters, or outdoor equipment moving?' },
  { key: 'storage', label: 'Closets / storage', prompt: 'Are there storage rooms, lockers, walk-in closets, or utility areas containing anything to move?' },
  { key: 'boxes', label: 'Boxes / loose contents', prompt: 'How many packed boxes exist now, and how many do you expect once packing is complete?' },
]

export function coverageResolved(value?: HiddenInventoryCoverage) {
  if (!value || value.state === 'unknown') return false
  if (value.state === 'customer_confirmed_empty' || value.state === 'not_applicable') return true
  if (value.state === 'customer_confirmed') return true
  const hasBasis = Boolean(value.note?.trim())
  if (value.state === 'estimated') {
    return hasBasis && (Number.isFinite(value.estimatedCubicFeet) || Number.isFinite(value.estimatedCountMin) || Number.isFinite(value.estimatedCountMax))
  }
  return hasBasis
}

export function hiddenInventoryCoverage(factors?: JobFactors) {
  const coverage = factors?.hiddenInventoryCoverage || {}
  return HIDDEN_INVENTORY_AREAS.map(area => ({ ...area, value: coverage[area.key], resolved: coverageResolved(coverage[area.key]) }))
}

export function resolvedInventoryCoverage(lead: Pick<CRMLead, 'inventory' | 'inventoryVerification' | 'jobFactors'>) {
  const included = (lead.inventory || []).filter(item => item.included !== false && item.status !== 'excluded')
  const completedAt = lead.inventoryVerification?.completedAt
  const fullScopeConfirmed = Boolean(completedAt && included.length && included.every(item => item.status !== 'needs_confirmation' && (item.status === 'confirmed' || item.source === 'customer_verification')))
  return hiddenInventoryCoverage(lead.jobFactors).map(area => {
    // A later explicit question reopens the area; an old template must not undo final verification.
    if (!fullScopeConfirmed || area.resolved || (area.value && area.value.state !== 'unknown') || (area.value?.updatedAt && area.value.updatedAt > completedAt!)) return area
    return { ...area, resolved: true, value: { state: 'customer_confirmed' as const, note: 'Included in the customer-confirmed final inventory.', updatedAt: completedAt } }
  })
}

export function evaluateQuoteReadiness(lead: CRMLead, quote?: Pick<CRMQuote, 'billingModel' | 'quoteType' | 'originAddress' | 'destAddress'>) {
  const factors = lead.jobFactors || {}
  const inventory = (lead.inventory || []).filter(item => item.included !== false)
  const hidden = resolvedInventoryCoverage(lead)
  const blockers: string[] = []
  const warnings: string[] = []
  const isLaborOnly = quote?.quoteType === 'labor_only' || lead.quoteType === 'labor_only' || lead.moveType === 'labor-only'
  const accessProfiles = factors.accessProfiles || []
  const originProfile = accessProfiles.find(profile => profile.stopId === 'primary-origin' || profile.stopRole === 'pickup')
  const destinationProfile = accessProfiles.find(profile => profile.stopId === 'primary-destination' || profile.stopRole === 'dropoff')
  const access = confirmedMoveAccess(lead, isLaborOnly)

  if (!inventory.length) blockers.push('Main inventory has not been captured.')
  if (inventory.some(item => item.status === 'needs_confirmation')) blockers.push('Inventory still contains customer decisions that need confirmation.')
  if (inventory.some(item => Number(item.cubicFeet || 0) <= 0)) blockers.push('One or more included items have unknown volume.')
  for (const area of hidden) if (!area.resolved) blockers.push(`${area.label} has not been explicitly resolved.`)
  if (!factors.packingStatus) blockers.push('Packing status is unknown.')
  if (!access.origin) blockers.push('Origin stairs, elevator, and truck access are incomplete.')
  if (!isLaborOnly && !access.destination) blockers.push('Destination stairs, elevator, and truck access are incomplete.')
  if (!originProfile && factors.originHasElevator && factors.originElevatorReserved !== true) blockers.push('Origin elevator reservation is not confirmed.')
  if (!isLaborOnly && !destinationProfile && factors.destHasElevator && factors.destElevatorReserved !== true) blockers.push('Destination elevator reservation is not confirmed.')
  if (accessProfiles.length) {
    const accessPlan = calculateMoveAccessPlan(accessProfiles.filter(profile => !isLaborOnly || profile.stopRole !== 'dropoff'), { origin: 1, destination: 1 })
    blockers.push(...accessPlan.manualReviewReasons.map(reason => `Manual access review required: ${reason}`))
    warnings.push(...accessPlan.warnings)
  }
  if (!(quote?.originAddress || lead.originAddress)?.trim()) blockers.push(isLaborOnly ? 'Work location is required.' : 'Origin address is required.')
  if (!isLaborOnly && !(quote?.destAddress || lead.destAddress)?.trim()) blockers.push('Destination address is required.')
  if (!lead.inventoryVerification?.completedAt) warnings.push('Customer inventory confirmation is not recorded.')

  const resolvedCoverage = hidden.filter(area => area.resolved).length
  const inventoryConfidence = Math.round(Math.max(0, Math.min(100,
    (inventory.length ? inventory.reduce((sum, item) => sum + (item.status === 'confirmed' || item.source === 'customer_verification' ? 1 : Number(item.confidence ?? 0.45)), 0) / inventory.length : 0) * 70 +
    (resolvedCoverage / HIDDEN_INVENTORY_AREAS.length) * 30
  )))
  return { status: blockers.length ? 'scope_in_progress' as const : 'quote_ready' as const, quoteReady: blockers.length === 0, inventoryConfidence, blockers, warnings, hidden }
}
