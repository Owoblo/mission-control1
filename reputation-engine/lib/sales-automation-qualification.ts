import type { CRMLead, LeadQualificationState } from '@/lib/types'

export function hasStreetNumber(value?: string) {
  return /\d{1,6}/.test(value || '')
}

export function hasCompleteMoveAddress(value?: string) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (!hasStreetNumber(text)) return false
  return /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|ln|lane|way|pkwy|parkway|pl|place|terrace|trail|circle|cir|sq|square|hwy|highway|unit|suite|apt|apartment|#)\b/i.test(text)
}

export function getExactAddressMissingFields(lead: Pick<CRMLead, 'originAddress' | 'destAddress'>) {
  const missing: string[] = []
  if (!hasCompleteMoveAddress(lead.originAddress)) missing.push('origin_address')
  if (!hasCompleteMoveAddress(lead.destAddress)) missing.push('destination_address')
  return missing
}

export function hasCompleteRouteAddresses(lead: Pick<CRMLead, 'originAddress' | 'destAddress'>) {
  return getExactAddressMissingFields(lead).length === 0
}

export function hasVerifiedInventory(lead: Pick<CRMLead, 'inventoryVerification' | 'surveyCompletedAt'>) {
  return !!lead.surveyCompletedAt || !!lead.inventoryVerification?.completedAt
}

export function hasMlsDraftInventoryNeedingConfirmation(
  lead: Pick<CRMLead, 'inventory' | 'inventoryVerification' | 'lastAutoEnrichmentAt' | 'listingScanSnapshot' | 'surveyCompletedAt'>
) {
  const hasInventory = !!(lead.inventory || []).filter(item =>
    item.included !== false &&
    ['mls', 'mls_photo_ai', 'existing_scan', 'fallback_scan'].includes(String(item.source || ''))
  ).length
  const hasListingDraft = !!lead.listingScanSnapshot || !!lead.lastAutoEnrichmentAt
  return hasInventory && hasListingDraft && !hasVerifiedInventory(lead)
}

export function getAutomationMissingFields(lead: CRMLead) {
  const missing: string[] = []
  const moveDateKnown = !!lead.moveDate || !!lead.moveDateFlexible
  const routeKnown = hasCompleteRouteAddresses(lead)
  const inventoryKnown =
    (!!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt) &&
    !hasMlsDraftInventoryNeedingConfirmation(lead)
  const accessKnown =
    !!lead.originAccess ||
    !!lead.destAccess ||
    !!lead.jobFactors?.originFloors ||
    !!lead.jobFactors?.destFloors ||
    !!lead.jobFactors?.originHasElevator ||
    !!lead.jobFactors?.destHasElevator

  if (!lead.moveDate && !lead.moveDateFlexible) missing.push('move_date')
  if (!lead.originCity && !lead.originAddress) missing.push('origin')
  else if (!hasCompleteMoveAddress(lead.originAddress)) missing.push('origin_address')
  if (!lead.destCity && !lead.destAddress) missing.push('destination')
  else if (!hasCompleteMoveAddress(lead.destAddress)) missing.push('destination_address')
  if (hasMlsDraftInventoryNeedingConfirmation(lead)) missing.push('inventory_confirmation')
  else if (!lead.totalItems && !lead.totalCubicFeet && !(lead.inventory || []).length && !lead.surveyCompletedAt) missing.push('inventory')
  if (!lead.email && moveDateKnown && routeKnown && inventoryKnown) missing.push('customer_email')
  if (!accessKnown) missing.push('access')
  return missing
}

export function buildLeadQualificationState(
  lead: CRMLead,
  overrides: Partial<LeadQualificationState> = {}
): LeadQualificationState {
  const missingFields =
    Object.prototype.hasOwnProperty.call(overrides, 'missingFields')
      ? overrides.missingFields || []
      : getAutomationMissingFields(lead)

  return {
    moveDateKnown: !!lead.moveDate || !!lead.moveDateFlexible,
    routeKnown: hasCompleteRouteAddresses(lead),
    inventoryKnown:
      (!!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt) &&
      !hasMlsDraftInventoryNeedingConfirmation(lead),
    accessKnown:
      !!lead.originAccess ||
      !!lead.destAccess ||
      !!lead.jobFactors?.originFloors ||
      !!lead.jobFactors?.destFloors ||
      !!lead.jobFactors?.originHasElevator ||
      !!lead.jobFactors?.destHasElevator,
    surveyRequested: !!lead.surveyRequestedAt,
    surveyCompleted: !!lead.surveyCompletedAt,
    quoteReady: missingFields.length === 0 || (missingFields.length === 1 && missingFields[0] === 'access'),
    activeCustomer: lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success',
    missingFields,
    nextBestAction:
      overrides.nextBestAction ||
      (missingFields[0] === 'move_date'
        ? 'collect_move_date'
        : missingFields[0] === 'origin' ||
            missingFields[0] === 'destination' ||
            missingFields[0] === 'origin_address' ||
            missingFields[0] === 'destination_address'
          ? 'collect_route'
          : missingFields[0] === 'inventory'
            ? 'collect_inventory'
            : missingFields[0] === 'inventory_confirmation'
              ? 'confirm_inventory'
            : missingFields[0] === 'access'
              ? 'collect_access'
              : 'hand_off_for_quote'),
    lastIntent: overrides.lastIntent,
    capturedSummary: overrides.capturedSummary,
  }
}
