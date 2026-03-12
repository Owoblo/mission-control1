export type ReviewStatus = 'pending' | 'sent' | 'feedback-received' | 'in-progress' | 'complete' | 'flagged'
export type ReviewKey = 'google' | 'yelp' | 'facebook' | 'media'

export interface Reviews {
  google: boolean
  yelp: boolean
  facebook: boolean
  media: boolean
}

export interface Job {
  id: string
  customerName: string
  customerEmail: string
  customerPhone: string
  moveDate: string
  moveFrom: string
  moveTo: string
  crewLead: string
  referralPartnerId?: string
  referralPartnerName?: string
  status: ReviewStatus
  feedbackRating?: number
  feedbackComment?: string
  reviews: Reviews
  reviewConfirmedAt: Partial<Record<ReviewKey, string>>
  incentiveEarned: boolean
  incentivePaid: boolean
  proofSentToPartner: boolean
  createdAt: string
  reviewSentAt?: string
}

export type PartnerType = 'realtor' | 'property-manager' | 'builder' | 'supply-chain' | 'other'

export interface Partner {
  id: string
  name: string
  type: PartnerType
  email: string
  phone?: string
  company?: string
  totalJobsReferred: number
  totalIncentiveOwed: number
  createdAt: string
}

export type SalesLeadStage = 'new' | 'contacted' | 'pricing' | 'quoted' | 'nurture' | 'booked' | 'lost'
export type MoveType = 'residential' | 'long-distance' | 'commercial' | 'senior' | 'labor-only' | 'packing'
export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'invoiced'
export type FollowUpType = 'note' | 'call' | 'sms' | 'email' | 'visit' | 'view' | 'accept' | 'decline' | 'consultation'

export interface CallLogEntry {
  id: string
  type: string
  notes?: string
  date: string
  phone?: string
  duration?: string
  durationSeconds?: number
  callSid?: string
  recordingUrl?: string
  recordingSid?: string
  recordingDuration?: number
  transcript?: string
  source?: 'dialer' | 'inbound' | 'consultation' | 'manual'
  aiSummary?: {
    summary?: string
    leadConcern?: string
    decisionMaker?: string
    nextAction?: string
    followUpDays?: number
    followUpReason?: string
    coachingTip?: string
    moveReadiness?: 'hot' | 'warm' | 'cold'
  }
}

export interface InventoryItem {
  id?: string
  room?: string
  name?: string
  item?: string
  qty?: number
  cubicFeet?: number
  weightLbs?: number
  included?: boolean
  exclusionReason?: string
}

export interface ListingMatch {
  zpid: string
  address: string
  city?: string
  is_furnished?: boolean | null
  furniture_scan_date?: string | null
  carouselphotos?: Array<{ url: string } | string>
}

export interface InventoryScanDraft {
  inventory: InventoryItem[]
  totalItems: number
  totalCubicFeet: number
  totalWeightLbs?: number
  roomBreakdown?: Record<string, number>
  source: 'existing_scan' | 'mls_photo_ai'
  confidence?: 'low' | 'medium' | 'high'
  specialtyFlags?: string[]
  notes?: string
}

export interface CRMLead {
  id: string
  name: string
  stage: SalesLeadStage
  inboundId?: string
  inboundMessage?: string
  source?: string
  phone?: string
  email?: string
  moveDate?: string
  moveType?: MoveType
  originAddress?: string
  originCity?: string
  originAccess?: string
  destAddress?: string
  destCity?: string
  destAccess?: string
  parkingNotes?: string
  supabaseListing?: ListingMatch | null
  moveReason?: string
  notes?: string
  followUpDate?: string
  followUpNote?: string
  quoteId?: string
  leadScore?: number
  directMailAttributed?: boolean
  inventory?: InventoryItem[]
  totalItems?: number
  totalCubicFeet?: number
  totalWeightLbs?: number
  roomBreakdown?: Record<string, number>
  callLogs?: CallLogEntry[]
  lostReason?: string
  lostAt?: string
  createdAt: string
}

export interface CRMClient {
  id: string
  name: string
  phone?: string
  email?: string
  type?: string
  company?: string
  createdAt: string
}

export interface QuoteLineItem {
  description: string
  details?: string
  amount: number
}

export interface CRMQuote {
  id: string
  number: string
  clientId: string
  leadId?: string
  moveDate?: string
  moveType?: string
  originAddress?: string
  originCity?: string
  destCity?: string
  crewSize?: number
  estimatedHours?: number
  truckCount?: number
  estimatedWeightLbs?: number
  longDistanceDistanceKm?: number
  longDistanceTruckCost?: number
  longDistanceGasCost?: number
  longDistanceInsuranceCost?: number
  longDistanceMiscCost?: number
  longDistanceMarkupRate?: number
  status: QuoteStatus
  validDays?: number
  acceptToken?: string
  lineItems: QuoteLineItem[]
  discountAmount?: number
  discountLabel?: string
  subtotal: number
  hst: number
  total: number
  deposit: number
  balance: number
  createdAt: string
  sentAt?: string
  viewedAt?: string
  acceptedAt?: string
  respondedAt?: string
}

export interface FollowUpLog {
  id: string
  quoteId?: string
  leadId?: string
  type: FollowUpType
  date: string
  createdAt: string
  notes?: string
}

export interface SalesDashboardSummary {
  totalLeads: number
  leadsDueToday: number
  overdueLeads: number
  quotedLeads: number
  bookedLeads: number
  quotedPipelineValue: number
  bookedRevenue: number
  totalOpenQuotes: number
}

export interface InboundLead {
  id: string
  source: string
  name?: string
  phone?: string
  email?: string
  message?: string
  raw_data?: Record<string, unknown> | string | null
  linkedLeadId?: string
  created_at: string
  claimed: boolean
  claimed_at?: string
}

export interface CRMEmail {
  id: string
  leadId?: string | null
  quoteId?: string | null
  to: string
  from: string
  subject: string
  body: string
  templateType?: string | null
  direction: 'outbound' | 'inbound'
  status: 'sent' | 'failed' | 'opened'
  sentAt: string
}

export interface QuoteDocumentPayload {
  quote: CRMQuote
  clientName?: string
  leadName?: string
}
