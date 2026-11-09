import type { CRMLead, CRMQuote } from './types'

// Display-only projections. Never use these records as replacements in writes.
// The list obtains the full record before opening a lifecycle editing dialog.
export const SALES_LIST_LEAD_FIELDS = [
  'assignedRep',
  'assignedRepName',
  'assignedRepUserId',
  'branch',
  'callLogs',
  'commercialDisposition',
  'contextFlag',
  'createdAt',
  'depositAmount',
  'destAccess',
  'destAddress',
  'destCity',
  'email',
  'followUpDate',
  'followUpNote',
  'id',
  'intelligence',
  'inventory',
  'jobFactors',
  'lastInboundAt',
  'lastMissedCallAt',
  'lastOutboundAt',
  'lastTouchedAt',
  'leadKind',
  'lostNotes',
  'lostReason',
  'mergedIntoLeadId',
  'moveDate',
  'moveDateFlexible',
  'moveDateFlexibleReason',
  'moveType',
  'name',
  'nurtureCheckIns',
  'nurtureIntervalDays',
  'nurtureLastCheckInAt',
  'nurtureReturnWindowDays',
  'opportunityCity',
  'originAccess',
  'originAddress',
  'originCity',
  'parkingNotes',
  'paymentStatus',
  'phone',
  'primaryContactRole',
  'propertyType',
  'quoteId',
  'realtorBrokerage',
  'realtorOutreachStartedAt',
  'source',
  'stage',
  'stageHistory',
  'tentativeDecisionDate',
  'tentativeReason',
  'tentativeReservationStatus',
  'totalItems',
  'verificationHistory',
] as const satisfies readonly (keyof CRMLead)[]
export const SALES_LIST_QUOTE_FIELDS = [
  'acceptedAt',
  'clientId',
  'createdAt',
  'depositPaidAmount',
  'depositPaidAt',
  'depositStripePaymentIntentId',
  'id',
  'leadId',
  'lineItems',
  'moveDate',
  'sentAt',
  'status',
  'total',
  'validDays',
  'viewedAt',
] as const satisfies readonly (keyof CRMQuote)[]

export function pickListFields<T extends object>(record: T, fields: readonly (keyof T)[]): T {
  return Object.fromEntries(fields.filter(key => record[key] !== undefined).map(key => [key, record[key]])) as T
}

// The list only asks whether inventory exists. It never edits its contents.
// Preserve the existing guidance truth condition without transferring inventory.
export function projectSalesList<T extends { leads: CRMLead[]; quotes: CRMQuote[]; clients: unknown[] }>(payload: T): T {
  return {
    ...payload,
    leads: payload.leads.map(lead => ({
      ...pickListFields(lead, SALES_LIST_LEAD_FIELDS.filter(key => key !== 'inventory')),
      totalItems: lead.totalItems || lead.inventory?.length || 0,
      ...(lead.intelligence ? { intelligence: pickListFields(lead.intelligence, ['personaBadges', 'detectedConcerns', 'keyInsights', 'winFactors', 'lastAnalyzedAt', 'suggestedSalesLanguage']) } : {}),
    })),
    quotes: payload.quotes.map(quote => pickListFields(quote, SALES_LIST_QUOTE_FIELDS)),
    clients: [],
  }
}
