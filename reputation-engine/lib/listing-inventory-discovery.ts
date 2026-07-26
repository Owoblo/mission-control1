import type { CRMLead } from './types'

export function listingInventoryScanDedupeKey(leadId: string, listingId: string) {
  return `listing_inventory_scan:${leadId}:${listingId}`
}

export function listingInventoryScanInProgress(lead: Pick<CRMLead, 'qualificationState'>) {
  const status = lead.qualificationState?.inventoryDiscovery?.status
  return status === 'queued' || status === 'scanning'
}

export function listingInventoryFallbackAllowed(lead: Pick<CRMLead, 'qualificationState' | 'inventory' | 'totalCubicFeet' | 'surveyRequestedAt' | 'surveyCompletedAt'>) {
  if ((lead.inventory || []).length > 0 || Number(lead.totalCubicFeet || 0) > 0) return false
  if (listingInventoryScanInProgress(lead)) return false
  if (lead.surveyRequestedAt || lead.surveyCompletedAt) return false
  return true
}
