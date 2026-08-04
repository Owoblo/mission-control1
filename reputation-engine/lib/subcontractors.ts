import type { CRMLead, CRMQuote } from './types'

export type Subcontractor = {
  id: string
  company_name: string
  contact_name: string
  phone: string
  email?: string | null
  status: 'active' | 'paused' | 'blocked'
  branches: string[]
  service_cities: string[]
  truck_sizes: string[]
  max_crew_size?: number | null
  insured: boolean
  insurance_expires_at?: string | null
  notes?: string | null
  created_at: string
  updated_at: string
}

export type SubcontractorOffer = {
  id: string
  lead_id: string
  quote_id?: string | null
  branch?: string | null
  move_date?: string | null
  origin_city: string
  destination_city: string
  distance_km?: number | null
  estimated_hours_min?: number | null
  estimated_hours_max?: number | null
  suggested_truck?: string | null
  crew_size?: number | null
  inventory: Array<{ name: string; qty: number; room?: string }>
  access_summary: { origin?: string; destination?: string; parking?: string }
  scope_notes?: string | null
  offered_payout: number
  currency: string
  status: 'draft' | 'open' | 'awarded' | 'cancelled' | 'expired'
  expires_at?: string | null
  awarded_subcontractor_id?: string | null
  awarded_at?: string | null
  created_at: string
  updated_at: string
}

export type SubcontractorOfferRecipient = {
  id: string
  offer_id: string
  subcontractor_id: string
  token: string
  status: 'pending' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'discussion' | 'not_awarded' | 'send_failed'
  sent_at?: string | null
  viewed_at?: string | null
  responded_at?: string | null
  response_note?: string | null
  sms_error?: string | null
}

function cityOnly(value?: string) {
  return String(value || '').split(',')[0].trim()
}

function safeAccess(value?: string) {
  return String(value || '')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.' -]+(?:street|st|road|rd|avenue|ave|drive|dr|boulevard|blvd|lane|ln|court|ct)\b/gi, 'address withheld')
    .replace(/\b(?:unit|suite|apt|apartment)\s*#?\s*[A-Za-z0-9-]+\b/gi, 'unit withheld')
    .trim()
}

export function buildSanitizedSubcontractorScope(lead: CRMLead, quote: CRMQuote | null) {
  const estimated = Number(quote?.estimatedHours || lead.crewHours?.[0]?.hours || 0)
  const minHours = Number(quote?.minimumBillableHours || (estimated ? Math.max(1, estimated - 1) : 0))
  const maxHours = Number(quote?.maximumEstimatedHours || (estimated ? estimated + 1.5 : 0))
  return {
    lead_id: lead.id,
    quote_id: quote?.id || null,
    branch: lead.branch || null,
    move_date: lead.moveDate || quote?.moveDate || null,
    origin_city: cityOnly(lead.originCity) || 'Origin area',
    destination_city: cityOnly(lead.destCity) || 'Destination area',
    distance_km: Number(
      quote?.longDistanceDistanceKm ||
      quote?.legs?.reduce((sum, leg) => sum + Number(leg.operationalDistanceKm || leg.distanceKm || 0), 0) ||
      0
    ) || null,
    estimated_hours_min: minHours || null,
    estimated_hours_max: maxHours || null,
    suggested_truck: lead.truckSize || (quote?.truckCount ? `${quote.truckCount} × 26ft truck` : null),
    crew_size: Number(quote?.crewSize || 0) || null,
    inventory: (lead.inventory || [])
      .filter(item => item.included !== false)
      .map(item => ({ name: item.name || item.item || 'Item', qty: Math.max(1, Number(item.qty || 1)), room: item.room || undefined })),
    access_summary: {
      origin: safeAccess(lead.originAccess),
      destination: safeAccess(lead.destAccess),
      parking: safeAccess(lead.parkingNotes),
    },
  }
}
