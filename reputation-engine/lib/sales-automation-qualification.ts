import type { CRMLead, LeadQualificationState } from '@/lib/types'

export function hasStreetNumber(value?: string) {
  return /\d{1,6}/.test(value || '')
}

export function hasCanadianPostalCode(value?: string) {
  return /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/i.test(value || '')
}

export function hasUnitMarker(value?: string) {
  const text = value || ''
  return (
    /\b(unit|suite|ste|apt|apartment|condo|#\s*[a-z0-9]|ph\b|penthouse)\b/i.test(text) ||
    /\b\d{1,5}\s*-\s*\d{1,6}\b/.test(text)
  )
}

export function hasStreetType(value?: string) {
  return /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|cres|crescent|ct|court|ln|lane|way|pkwy|parkway|pl|place|terrace|trail|circle|cir|sq|square|hwy|highway)\b/i.test(value || '')
}

export function hasCompleteMoveAddress(value?: string) {
  const text = (value || '').replace(/\s+/g, ' ').trim()
  if (!text) return false
  if (!hasStreetNumber(text)) return false
  return hasStreetType(text) || hasCanadianPostalCode(text)
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

export function hasAnyAccessDetails(
  lead: Pick<CRMLead, 'originAccess' | 'destAccess' | 'parkingNotes' | 'jobFactors'>
) {
  return (
    !!lead.originAccess ||
    !!lead.destAccess ||
    !!lead.parkingNotes ||
    lead.jobFactors?.originFloors !== undefined ||
    lead.jobFactors?.destFloors !== undefined ||
    lead.jobFactors?.originHasElevator !== undefined ||
    lead.jobFactors?.destHasElevator !== undefined ||
    lead.jobFactors?.originParkingOk !== undefined ||
    lead.jobFactors?.destParkingOk !== undefined ||
    lead.jobFactors?.originElevatorReserved !== undefined ||
    lead.jobFactors?.destElevatorReserved !== undefined
  )
}

export function addressNeedsAccessConfirmation(address?: string, propertyType?: CRMLead['propertyType']) {
  const text = address || ''
  if (propertyType === 'apartment' || propertyType === 'condo' || propertyType === 'commercial' || propertyType === 'storage_unit') {
    return true
  }
  return (
    hasUnitMarker(text) ||
    /\b(condo|apartment|apt|suite|tower|building|high[- ]?rise|elevator|storage|commercial|office|loading dock)\b/i.test(text)
  )
}

export function leadNeedsAccessBeforeAutomatedQuote(
  lead: Pick<CRMLead, 'originAddress' | 'destAddress' | 'propertyType' | 'originAccess' | 'destAccess' | 'parkingNotes' | 'jobFactors'>
) {
  if (hasAnyAccessDetails(lead)) return false
  return (
    addressNeedsAccessConfirmation(lead.originAddress, lead.propertyType) ||
    addressNeedsAccessConfirmation(lead.destAddress, lead.propertyType)
  )
}

export function getAutomationMissingFields(lead: CRMLead) {
  const missing: string[] = []
  const moveDateKnown = !!lead.moveDate || !!lead.moveDateFlexible
  const routeKnown = hasCompleteRouteAddresses(lead)
  const inventoryKnown =
    (!!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt) &&
    !hasMlsDraftInventoryNeedingConfirmation(lead)
  const accessKnown = hasAnyAccessDetails(lead)

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

export type FastLaneReadinessIssue =
  | 'move_date'
  | 'origin_address'
  | 'origin_city'
  | 'destination_address'
  | 'destination_city'
  | 'route_confirmation'
  | 'inventory'
  | 'access'

function normalizedRouteValue(value?: string) {
  return (value || '').toLowerCase().replace(/\b(?:on|ontario|canada)\b/g, '').replace(/[^a-z0-9]/g, '')
}

function addressContainsScheduleText(value?: string) {
  return /\b(today|tomorrow|tonight|january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(value || '')
}

export function getFastLaneReadinessIssues(lead: CRMLead, now = new Date()) {
  const issues: FastLaneReadinessIssue[] = []
  const moveDate = lead.moveDate ? new Date(`${lead.moveDate}T12:00:00`) : null
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (!moveDate || Number.isNaN(moveDate.getTime()) || moveDate < today) issues.push('move_date')
  if (!hasCompleteMoveAddress(lead.originAddress) || addressContainsScheduleText(lead.originAddress)) issues.push('origin_address')
  if (!lead.originCity?.trim()) issues.push('origin_city')
  if (!hasCompleteMoveAddress(lead.destAddress) || addressContainsScheduleText(lead.destAddress)) issues.push('destination_address')
  if (!lead.destCity?.trim()) issues.push('destination_city')

  const origin = normalizedRouteValue(`${lead.originAddress || ''}${lead.originCity || ''}`)
  const destination = normalizedRouteValue(`${lead.destAddress || ''}${lead.destCity || ''}`)
  if (origin && destination && origin === destination) issues.push('route_confirmation')

  const inventoryKnown = !!lead.totalItems || !!lead.totalCubicFeet || !!(lead.inventory || []).length || !!lead.surveyCompletedAt
  if (!inventoryKnown || hasMlsDraftInventoryNeedingConfirmation(lead)) issues.push('inventory')
  if (!hasAnyAccessDetails(lead)) issues.push('access')
  return Array.from(new Set(issues))
}

export const FAST_LANE_ISSUE_LABELS: Record<FastLaneReadinessIssue, string> = {
  move_date: 'Confirm a current move date',
  origin_address: 'Confirm the exact pickup address',
  origin_city: 'Confirm the pickup city',
  destination_address: 'Confirm the exact destination address',
  destination_city: 'Confirm the destination city',
  route_confirmation: 'Confirm that pickup and destination are different, or document a same-site move',
  inventory: 'Record the items and quantities being moved',
  access: 'Confirm stairs, elevators, parking, and carrying distance',
}

export function hasConfirmedAutomatedEstimateScope(lead: Pick<CRMLead, 'qualificationState'>) {
  return lead.qualificationState?.lastIntent === 'estimate_scope_confirmed'
}

export function isEstimateScopeConfirmation(message?: string) {
  const text = String(message || '').trim().toLowerCase().replace(/[.!?]+$/g, '').trim()
  if (!text) return false
  if (/^(yes|yep|yeah|yup|correct|confirmed|accurate|that'?s right|looks right|sounds right|all correct|go ahead|please do|send it|send the estimate|send the quote)$/.test(text)) return true
  return /\b(details|information|scope|addresses|inventory|access).{0,30}\b(correct|accurate|right|confirmed)\b|\b(yes|correct|confirmed).{0,30}\b(send|prepare|create).{0,20}\b(estimate|quote)\b/.test(text)
}

export function automatedEstimateSendingIsPaused() {
  return true
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
      hasAnyAccessDetails(lead),
    surveyRequested: !!lead.surveyRequestedAt,
    surveyCompleted: !!lead.surveyCompletedAt,
    quoteReady: missingFields.length === 0 || (missingFields.length === 1 && missingFields[0] === 'access'),
    activeCustomer: lead.stage === 'booked' || lead.stage === 'completed' || lead.stage === 'customer_success',
    missingFields,
    addressVerification: Object.prototype.hasOwnProperty.call(overrides, 'addressVerification')
      ? overrides.addressVerification
      : lead.qualificationState?.addressVerification,
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
