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
  crmLeadId?: string
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

export type SalesLeadStage = 'new' | 'contacted' | 'estimate_scheduled' | 'estimate_completed' | 'pricing' | 'quoted' | 'nurture' | 'booked' | 'lost'
export type MoveType = 'residential' | 'long-distance' | 'commercial' | 'senior' | 'labor-only' | 'packing'
export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'invoiced'
export type PaymentStatus = 'pending' | 'deposit_received' | 'paid_in_full'
export type FollowUpType = 'note' | 'call' | 'sms' | 'email' | 'visit' | 'view' | 'accept' | 'decline' | 'consultation' | 'status_change'
export type SalesBranch = 'windsor' | 'waterloo' | 'london' | 'ottawa'
export type LeadKind = 'customer' | 'realtor_opportunity'
export type LeadContactRole = 'customer' | 'realtor'
export type RealtorLookupStatus = 'not_checked' | 'matched' | 'partial' | 'missing'
export type DestinationOpportunityStatus = 'outside_area' | 'no_match' | 'generated' | 'linked_existing'
export type RealtorWarmth = 'warm' | 'cold' | 'unknown'
export type RealtorOutreachStatus = 'not_started' | 'queued' | 'sent' | 'responded' | 'closed'
export type AutomationStatus = 'idle' | 'active' | 'paused' | 'handoff' | 'do_not_contact'
export type LeadOwnerStatus = 'unassigned' | 'assigned' | 'reassigned' | 'handoff'
export type ConversationChannel = 'sms' | 'email'
export type ConversationThreadStatus = 'open' | 'human_handoff' | 'closed'
export type AutomationJobKind = 'lead_response' | 'quote_followup' | 'survey_followup' | 'move_reminder' | 'stale_reactivation'
export type AutomationJobStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'

export interface AISummary {
  summary?: string
  sentiment?: 'positive' | 'neutral' | 'negative'
  intent?: string
  leadConcern?: string
  decisionMaker?: string
  nextAction?: string
  followUpDays?: number
  followUpReason?: string
  coachingTip?: string
  moveReadiness?: 'hot' | 'warm' | 'cold'
}

export interface LeadQualificationState {
  moveDateKnown?: boolean
  routeKnown?: boolean
  inventoryKnown?: boolean
  accessKnown?: boolean
  surveyRequested?: boolean
  surveyCompleted?: boolean
  quoteReady?: boolean
  activeCustomer?: boolean
  missingFields?: string[]
  lastIntent?: string
  nextBestAction?: string
  capturedSummary?: string
}

export interface CallLogEntry {
  id: string
  type: string
  notes?: string
  date: string
  phone?: string
  branchNumber?: string
  duration?: string
  durationSeconds?: number
  direction?: 'inbound' | 'outbound'
  callSid?: string
  recordingUrl?: string
  recordingSid?: string
  recordingDuration?: number
  transcript?: string
  isVoicemail?: boolean
  source?: 'dialer' | 'inbound' | 'consultation' | 'manual'
  aiSummary?: AISummary
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
  notes?: string
  size?: string
}

export interface LeadMediaAsset {
  id: string
  url: string
  kind: 'image' | 'video'
  source: 'survey' | 'rep_upload' | 'mms'
  room?: string
  filename?: string
  mimeType?: string
  uploadedAt: string
  uploadedByUserId?: string
  uploadedByName?: string
  notes?: string
}

export interface ListingMatch {
  zpid: string
  address: string
  city?: string
  brokername?: string | null
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

export interface JobPenalty {
  label: string
  hours: number
  isFlagOnly?: boolean
  category?: 'access' | 'disassembly' | 'specialty' | 'packing' | 'hidden_inventory' | 'warning'
  details?: string[]
}

export interface EstimateRouteContext {
  routeCategory?: 'local' | 'medium' | 'long-distance'
  pricingStatus?: 'ready' | 'provisional'
  billableDriveHours?: number
  operationalDriveHours?: number
  originToDestinationHours?: number
  yardToOriginHours?: number
  returnTripHours?: number
  originToDestinationDistanceKm?: number
  yardToOriginDistanceKm?: number
  returnTripDistanceKm?: number
  billableDistanceKm?: number
  operationalDistanceKm?: number
  missingRequirements?: string[]
}

export interface PricingBreakdown {
  loadHours: number       // wrap + disassemble + carry out + load truck
  driveHours: number      // customer-facing billable drive time
  operationalDriveHours: number
  unloadHours: number     // carry in + unwrap + reassemble + place
  baseHours: number       // loadHours + driveHours + unloadHours (pre-penalties)
  penaltyHours: number
  driveBufferHours: number
  loadUnloadBufferHours: number
  bufferHours: number
  totalHours: number
  operationalHours: number
  crewSize: number
  crewRatePerHour: number
  truckCount: number
  truckRateMultiplier: number
  tripStrategy: 'single_truck' | 'single_truck_two_trips' | 'two_trucks' | 'three_trucks'
  pricingStatus: 'ready' | 'provisional'
  routeCategory: 'local' | 'medium' | 'long-distance'
  billableDistanceKm?: number
  operationalDistanceKm?: number
  baseCubicFeet: number
  extraCubicFeet: number
  totalCubicFeet: number
  penalties: JobPenalty[]
  adjustmentBreakdown: Array<{
    category: 'access' | 'disassembly' | 'specialty' | 'packing' | 'hidden_inventory'
    label: string
    hours: number
  }>
  internalCostEstimate: {
    laborCost: number
    truckDailyCost: number
    truckFuelMileageCost: number
    truckOpsCost: number
    totalCost: number
    grossProfit: number
    grossMarginPct: number
    computedRevenue: number
  }
  disassemblyItems: string[]     // item names detected as needing disassembly/reassembly
  specialtyItemFlags: string[]   // piano, safe, etc. that are included in the move
  intelligenceFlags: {
    twoTruckRequired: boolean    // volume >= 1,400 cu ft (full 26ft truck)
    twoTripZone: boolean         // local move, 900–1,399 cu ft — second trip possible
    threeTruckReview: boolean
    threeHourMinApplied: boolean // natural estimate < 3h, billing at floor
    fullDayFlag: boolean         // estimated hours >= 14 — heads-up for customer
    missingDestination: boolean
    twoTripComparison?: {
      crewSize: number
      totalHours: number
      totalAmount: number
      savings: number
      extraHours: number
      note: string
    } | null
    multiTruckOption?: {
      totalHours: number
      totalAmount: number
      truckCount: number
      note: string
    } | null
    packingDayEstimate?: {
      crewSize: number
      hours: number
      amountBeforeHst: number
      total: number
      note: string
    }
    twoDayMoveEstimate?: {
      day1Hours: number
      day2Hours: number
      note: string
    } | null
  }
}

export interface JobFactors {
  // Origin access
  originFloors?: number
  originHasElevator?: boolean
  originElevatorReserved?: boolean
  originParkingOk?: boolean

  // Destination access
  destFloors?: number
  destHasElevator?: boolean
  destElevatorReserved?: boolean
  destParkingOk?: boolean

  // Hidden inventory (not visible in MLS photos)
  garageCubicFeet?: number
  basementCubicFeet?: number
  shedCubicFeet?: number
  estimatedBoxes?: number

  // Packing status
  packingStatus?: 'packed' | 'partial' | 'not-started'

  // Specialty items
  hasPiano?: boolean
  hasSafe?: boolean
  disassemblyItemCount?: number
  // Controls what dis/reassembly service is included for flagged items
  // 'both' = full service (default), 'disassemble_only' = dis at origin only, 'reassemble_only' = re at dest only
  disassemblyMode?: 'both' | 'disassemble_only' | 'reassemble_only'

  // Items we do NOT move (flag only — do not price, alert the rep)
  hasHotTub?: boolean
  hasPoolTable?: boolean

  // Manual overrides
  truckCountOverride?: number   // rep can force 1 or 2 trucks
  crewSizeOverride?: number     // rep can force crew size (2/3/4/5 movers)

  // Free notes from rep
  specialtyNotes?: string
}

export interface CRMLead {
  id: string
  name: string
  stage: SalesLeadStage
  branch?: SalesBranch   // which Saturn Star location handles this lead
  leadKind?: LeadKind
  primaryContactRole?: LeadContactRole
  inboundId?: string
  inboundMessage?: string
  source?: string
  phone?: string
  email?: string
  moveDate?: string
  moveDateFlexible?: boolean      // true = date TBD (e.g. waiting on house closing)
  moveDateFlexibleReason?: string // e.g. "Waiting on buyer", "New house not closed yet"
  moveType?: MoveType
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
  additionalStops?: number
  originAddress?: string
  originCity?: string
  originAccess?: string
  destAddress?: string
  destCity?: string
  destAccess?: string
  parkingNotes?: string
  supabaseListing?: ListingMatch | null
  realtorName?: string
  realtorEmail?: string
  realtorPhone?: string
  realtorBrokerage?: string
  realtorWebsite?: string
  realtorContactId?: string
  realtorLookupStatus?: RealtorLookupStatus
  realtorWarmth?: RealtorWarmth
  realtorOutreachStatus?: RealtorOutreachStatus
  realtorEnrichedAt?: string
  realtorOutreachStartedAt?: string
  realtorLastTouchAt?: string
  moveReason?: string
  notes?: string
  followUpDate?: string
  followUpNote?: string
  surveyToken?: string
  surveyTokenExpiresAt?: string
  surveyRequestedAt?: string
  surveyCompletedAt?: string
  surveyPhotoCount?: number
  quoteId?: string
  quoteIds?: string[]   // all quote IDs on this lead (supports multi-job contacts)
  sourceLeadId?: string
  sourceLeadName?: string
  sourceLeadMoveDate?: string
  sourceLeadQuoteId?: string
  opportunityAddress?: string
  opportunityCity?: string
  opportunityDetectedAt?: string
  destinationOpportunityLeadId?: string
  destinationOpportunityStatus?: DestinationOpportunityStatus
  destinationOpportunityLastCheckedAt?: string
  leadScore?: number
  firstResponseAt?: string
  lastInboundAt?: string
  lastOutboundAt?: string
  lastHumanOutboundAt?: string
  lastAutomationOutboundAt?: string
  automationStatus?: AutomationStatus
  automationPausedUntil?: string
  automationPauseReason?: string
  automationHandoffAt?: string
  automationHandoffReason?: string
  automationLastJobAt?: string
  lastMissedCallAt?: string
  lastMissedCallAutoReplyAt?: string
  lastVoicemailAt?: string
  automatedQuoteSentAt?: string
  automatedQuoteId?: string
  automatedQuoteChannel?: ConversationChannel
  lastAutoEnrichmentAt?: string
  qualificationState?: LeadQualificationState
  directMailAttributed?: boolean
  inventory?: InventoryItem[]
  mediaAssets?: LeadMediaAsset[]
  totalItems?: number
  totalCubicFeet?: number
  totalWeightLbs?: number
  roomBreakdown?: Record<string, number>
  callLogs?: CallLogEntry[]
  jobFactors?: JobFactors
  lostReason?: string
  lostNotes?: string
  lostAt?: string
  // Context + assignment
  contextFlag?: string
  assignedRep?: string
  assignedRepName?: string
  assignedRepUserId?: string
  leadOwnerStatus?: LeadOwnerStatus
  ownedAt?: string
  lastTouchedByUserId?: string
  lastTouchedByName?: string
  lastTouchedAt?: string
  // Crew assignment (array of app_user IDs)
  assignedCrew?: string[]
  crewNote?: string
  // Estimate appointment
  estimateDate?: string
  estimateTime?: string
  // Booking + payment
  bookedAt?: string
  depositAmount?: number
  depositMethod?: string
  depositDate?: string
  paymentStatus?: PaymentStatus
  // Cancellation
  cancelledAt?: string
  cancelReason?: string
  // Post-job review lifecycle
  reviewJobId?: string
  reviewSentAt?: string
  reviewCompletedAt?: string
  reviewRating?: number
  reviewNotes?: string
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
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
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
  // Deposit payment tracking
  depositPaidAt?: string
  depositPaidAmount?: number
  depositPaidMethod?: 'stripe' | 'etransfer' | 'cash' | 'cheque' | 'other'
  depositPaidNote?: string
  depositStripeSessionId?: string
  depositStripePaymentIntentId?: string
  depositStripeCustomerId?: string
  depositStripePaymentMethodId?: string
  // Balance charge
  balancePaidAt?: string
  balancePaidAmount?: number
  balancePaidMethod?: 'stripe' | 'etransfer' | 'cash' | 'cheque' | 'other'
  // Overridable fields
  moveDescription?: string  // shown on the quote document
  internalNotes?: string    // crew / internal only, not on quote
  priceOverrideTotal?: number  // if set, this overrides the computed total (incl. HST)
  priceOverrideReason?: string
}

export interface FollowUpLog {
  id: string
  quoteId?: string
  leadId?: string
  type: FollowUpType
  date: string
  createdAt: string
  notes?: string
  aiSummary?: AISummary
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

export interface CRMConversationThread {
  id: string
  leadId: string
  channel: ConversationChannel
  contactValue: string
  contactName?: string
  status: ConversationThreadStatus
  automationStatus: AutomationStatus
  automationOwner?: 'automation' | 'human' | 'mixed'
  lastInboundAt?: string
  lastOutboundAt?: string
  lastHumanOutboundAt?: string
  lastAutomationOutboundAt?: string
  lastInboundPreview?: string
  lastOutboundPreview?: string
  qualificationState?: LeadQualificationState
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface CRMAutomationJob {
  id: string
  leadId: string
  conversationId?: string | null
  kind: AutomationJobKind
  channel?: ConversationChannel | null
  status: AutomationJobStatus
  dueAt: string
  lockedAt?: string | null
  attempts: number
  dedupeKey?: string | null
  payload?: Record<string, unknown> | null
  result?: Record<string, unknown> | null
  lastError?: string | null
  createdAt: string
  updatedAt: string
  completedAt?: string | null
}

export interface QuoteDocumentPayload {
  quote: CRMQuote
  clientName?: string
  leadName?: string
}
