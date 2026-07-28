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

export type SalesLeadStage = 'new' | 'contacted' | 'estimate_scheduled' | 'estimate_completed' | 'pricing' | 'quoted' | 'tentative' | 'nurture' | 'booked' | 'completed' | 'customer_success' | 'lost'
export type MoveType = 'residential' | 'long-distance' | 'commercial' | 'senior' | 'labor-only' | 'packing'
export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'invoiced'
export type PaymentStatus = 'pending' | 'deposit_received' | 'paid_in_full'
export type PromiseChannel = 'call' | 'sms' | 'email' | 'in_person' | 'internal'
export interface CustomerPromise {
  id: string
  action: string
  reason: string
  channel: PromiseChannel
  dueAt: string
  intendedOutcome: string
  ownerUserId?: string
  ownerName: string
  status: 'open' | 'completed' | 'cancelled'
  createdAt: string
  completedAt?: string
  completionEvidence?: string
}
export type QuotePaymentTerms =
  | 'deposit_required'
  | 'approval_invoice'
  | 'invoice_net_7'
  | 'invoice_net_15'
  | 'invoice_net_30'
  | 'po_required'
export type LeadFollowUpStatus = 'pending' | 'following_up' | 'followed_up' | 'no_response'
export type FollowUpType = 'note' | 'call' | 'sms' | 'email' | 'visit' | 'view' | 'accept' | 'decline' | 'consultation' | 'status_change'
export type SalesBranch = 'windsor' | 'waterloo' | 'london' | 'ottawa'
export type LeadKind = 'customer' | 'realtor_opportunity'
export type LeadContactRole = 'customer' | 'realtor'
export type RealtorLookupStatus = 'not_checked' | 'matched' | 'partial' | 'missing'
export type DestinationOpportunityStatus = 'outside_area' | 'no_match' | 'generated' | 'linked_existing'
export type RealtorWarmth = 'warm' | 'cold' | 'unknown'
export type RealtorOutreachStatus = 'not_started' | 'queued' | 'sent' | 'responded' | 'closed'
export type RealtorContactKind = 'listing_agent' | 'sales_representative' | 'brokerage_office' | 'unknown'
export type AutomationStatus = 'idle' | 'active' | 'paused' | 'handoff' | 'do_not_contact'
export type LeadOwnerStatus = 'unassigned' | 'assigned' | 'reassigned' | 'handoff'
export type ConversationChannel = 'sms' | 'email'
export type ConversationThreadStatus = 'open' | 'human_handoff' | 'closed'
export type InboundLeadDisposition = 'open' | 'junk' | 'lost' | 'not_interested'
export type InboundLeadStatus = 'needs_action' | 'recent_handoff' | 'closed' | 'archived'
export type InboundLeadFocusFilter = 'needs_action' | 'web_qr' | 'calls' | 'sms' | 'high_intent' | 'answered'
export type InboundClosedFilter = 'all' | 'junk' | 'lost' | 'not_interested'
export type InventoryVerificationDecision = 'going' | 'not_going' | 'unsure'
export type LeadInboxChannel = 'sms' | 'email' | 'calls' | 'webforms'
export type AutomationJobKind =
  | 'lead_response'
  | 'lost_feedback'
  | 'quote_followup'
  | 'quote_viewed_followup'
  | 'quote_expiry_followup'
  | 'survey_followup'
  | 'consultation_reminder'
  | 'move_reminder'
  | 'stale_reactivation'
export type AutomationJobStatus = 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'

export interface LeadIntelligenceFollowUp {
  dueDate: string        // ISO date
  channel: 'call' | 'sms' | 'email'
  script: string         // exact suggested message or talking point
  isCloseAttempt: boolean
}

export interface LeadPersonaBadge {
  label: string
  confidence: number
  source: string
  lastUpdated: string
  explanation: string
}

export interface LeadAutomationSettings {
  nudgeIfQuoteNotOpened?: boolean
  nudgeIfSurveyNotCompleted?: boolean
  nudgeIfQuoteViewedNoResponse?: boolean
  nudgeBeforeQuoteExpires?: boolean
}

export interface InboxChannelState {
  lastReadAt?: string
  lastReadByUserId?: string
  lastReadByName?: string
  lastActionAt?: string
  lastActionByUserId?: string
  lastActionByName?: string
}

export interface LeadInboxState {
  sms?: InboxChannelState
  email?: InboxChannelState
  calls?: InboxChannelState
  webforms?: InboxChannelState
}

export interface LeadIntelligence {
  temperature: 'hot' | 'warm' | 'cold'
  bookingProbability: number       // 0–100
  stageSuggestion?: SalesLeadStage
  stageSuggestionReason?: string
  followUpAt?: string              // ISO datetime extracted from conversation
  followUpNote?: string
  nextAction: string
  nextActionDetail?: string
  keyInsights: string[]            // bullet points from timeline synthesis
  detectedConcerns: string[]       // objections / risks surfaced
  winFactors: string[]             // positive buying signals
  coachingNote?: string
  processGaps: string[]            // steps from the call framework that were missed
  suggestedTactic?: string         // which of the 5 closing tactics applies right now
  authorityTakeoverFlag?: boolean  // should John be looped in?
  followUpSchedule: LeadIntelligenceFollowUp[]   // next 2–3 touches with scripts
  sentimentTrend: 'improving' | 'stable' | 'declining'
  signalSummary: string            // narrative: "2 calls, 4 SMS, 1 email"
  personaBadges?: LeadPersonaBadge[]
  suggestedSalesLanguage?: string
  lastAnalyzedAt: string
  signalCount: number
}

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
  capturedName?: string
  moveDate?: string
  moveDateFlexible?: boolean
  moveDateFlexibleReason?: string
  moveType?: CRMLead['moveType']
  originAddress?: string
  originCity?: string
  destAddress?: string
  destCity?: string
  depositConfirmed?: boolean
  depositAmount?: number
  depositMethod?: string
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
  addressVerification?: {
    pending?: {
      field: 'originAddress' | 'destAddress'
      original: string
      suggestion: string
      city?: string
      placeId?: string
      promptedAt: string
    }
    confirmedAt?: string
    lastConfirmedField?: 'originAddress' | 'destAddress'
    lastConfirmedAddress?: string
  }
  inventoryDiscovery?: {
    status: 'queued' | 'scanning' | 'completed' | 'unavailable' | 'failed'
    listingId?: string
    queuedAt?: string
    startedAt?: string
    completedAt?: string
    failedAt?: string
    error?: string
  }
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
  recordingStatus?: 'received' | 'uploaded' | 'verified' | 'transcribed' | 'failed' | 'twilio_deleted' | 'unavailable'
  recordingSize?: number
  recordingContentType?: string
  storageProvider?: 'r2' | 's3' | 'supabase' | string
  cloudflareObjectKey?: string
  cloudflareUrl?: string
  recordingUnavailable?: boolean
  recordingUnavailableAt?: string
  recordingUnavailableReason?: string
  transcript?: string
  isVoicemail?: boolean
  source?: 'dialer' | 'inbound' | 'consultation' | 'manual'
  callOutcome?: string
  answeredBy?: 'browser' | 'mobile' | 'sip' | 'unknown'
  repId?: string
  repName?: string
  audioConnected?: boolean
  errorCode?: number
  errorMessage?: string
  failureReason?: string
  aiSummary?: AISummary
}

export type MovePolicyCategory = 'blocked' | 'hazardous' | 'manual_review' | 'specialty_fee' | 'default_exclude'

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
  confidence?: number
  status?: 'confirmed' | 'needs_confirmation' | 'excluded'
  confirmReason?: string
  sourcePhotoRoom?: string
  policyCategory?: MovePolicyCategory
  policyReason?: string
  policyOverride?: 'include'
  source?: 'mls' | 'survey_ai' | 'rep_upload' | 'customer_verification' | 'manual'
  icon?: string
  owner?: 'person_a' | 'person_b'
}

export interface InventoryVerificationItemChoice {
  itemKey: string
  decision: InventoryVerificationDecision
  note?: string
  updatedAt: string
  updatedBy?: 'customer' | 'rep'
}

export interface InventoryVerificationAddedItem {
  id: string
  room: string
  name: string
  qty: number
  note?: string
  createdAt: string
  createdBy?: 'customer' | 'rep'
}

export interface InventoryVerification {
  startedAt?: string
  lastUpdatedAt?: string
  completedAt?: string
  addressConfirmed?: boolean
  addressMismatchNote?: string
  itemChoices?: InventoryVerificationItemChoice[]
  addedItems?: InventoryVerificationAddedItem[]
}

export interface LeadMediaAsset {
  id: string
  url: string
  kind: 'image' | 'video' | 'document'
  source: 'survey' | 'rep_upload' | 'mms' | 'receipt_upload'
  room?: string
  filename?: string
  mimeType?: string
  category?: 'customer_media' | 'receipt'
  uploadedAt: string
  uploadedByUserId?: string
  uploadedByName?: string
  notes?: string
  partyLabel?: string
  removed?: boolean
  removedAt?: string
  analysisStatus?: 'pending' | 'scanned' | 'skipped' | 'failed'
  analysisNotes?: string
  detectedItemCount?: number
  linkedCostId?: string
  linkedCostCategory?: string
  linkedCostAmountCents?: number
  linkedAt?: string
}

export interface ListingMatch {
  zpid: string
  address: string
  city?: string
  bedrooms?: number | string | null
  bathrooms?: number | string | null
  beds?: number | string | null
  baths?: number | string | null
  homeStatus?: string | null
  brokername?: string | null
  is_furnished?: boolean | null
  furniture_scan_date?: string | null
  description?: string | null
  propertyDescription?: string | null
  parkingFeatures?: string[] | string | null
  basement?: string | null
  livingArea?: number | string | null
  lotSize?: number | string | null
  yearBuilt?: number | string | null
  streetViewMetadataUrl?: string | null
  streetViewUrl?: string | null
  carouselphotos?: Array<{ url: string } | string>
}

export interface InventoryScanDraft {
  inventory: InventoryItem[]
  needsConfirmation?: InventoryItem[]
  totalItems: number
  totalCubicFeet: number
  totalWeightLbs?: number
  roomBreakdown?: Record<string, number>
  source: 'existing_scan' | 'mls_photo_ai'
  confidence?: 'low' | 'medium' | 'high'
  specialtyFlags?: string[]
  confirmationQuestions?: string[]
  duplicateRisks?: string[]
  mlsDisclaimer?: string
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
  uhaulRatePerKm?: number
  uhaulChargeEstimate?: number
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
    commissionCost?: number
    suppliesCost?: number
    commercialProtectionCost?: number
    commercialLiabilityCost?: number
    commercialAdminCost?: number
    commercialOtherDirectCost?: number
    commercialDirectCost?: number
    commercialMarkupAmount?: number
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
      // Option C: 1 truck, 3 movers, 1 trip (optimistic — fits in one run)
      oneTripHours: number
      oneTripAmount: number
      oneTripSavingsVsTwoTrip: number
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
    packingMaterialsEstimate?: {
      plannedBoxes: number
      recommendedDeliveryBoxes: number
      recommendedBufferBoxes: number
      source: 'customer_estimate' | 'inventory_boxes' | 'volume_inference'
      lines: Array<{
        presetId: string
        label: string
        quantity: number
        unitPrice: number
        amount: number
        note?: string
      }>
      subtotal: number
      total: number
      note: string
      billingNote: string
    } | null
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

  // Conjoint / combined move (two origins → one destination)
  conjointMove?: boolean
  personALabel?: string
  personBLabel?: string
  personBPhone?: string
  personBOriginFloors?: number
  personBOriginHasElevator?: boolean
  personBOriginElevatorReserved?: boolean
  personBOriginParkingOk?: boolean

  // Planning constraints used by move logistics intelligence
  destinationKeysTime?: string
  earliestLoadTime?: string
  latestFinishTime?: string
  planningScenario?: 'standard' | 'conjoint' | 'multi_stop' | 'storage_staged' | 'labor_only' | 'long_distance' | 'commercial' | 'junk_addon'
  preferredOperatingPlan?: 'one_truck_sequence' | 'one_truck_shuttle' | 'two_trucks_parallel' | 'split_day_storage' | 'needs_review'
  moveConstraintNotes?: string

  // Consultative customer journey — models the whole transition, including
  // uncertain dates, instead of forcing every customer into a single move day.
  destinationTiming?: 'same_day' | 'known_gap' | 'unknown'
  temporaryStorageNeeded?: boolean
  storageDurationKnown?: boolean
  storageEstimatedMonths?: number
  storageMonthlyAllowance?: number
  packingPreference?: 'self' | 'partial_help' | 'full_service' | 'undecided'
  cleaningPreference?: 'none' | 'move_out' | 'move_in' | 'both' | 'undecided'
  protectionPreference?: 'standard' | 'enhanced' | 'undecided'
  consultationNotes?: string

  // Commercial scope controls
  commercialJobCategory?: 'office' | 'retail' | 'warehouse' | 'government' | 'building_internal' | 'commercial_labor_only' | 'commercial_junk'
  commercialCompanyName?: string
  commercialSiteContact?: string
  commercialBillingContact?: string
  commercialPoNumber?: string
  commercialAfterHours?: boolean
  commercialAccessWindow?: string
  commercialLoadingDock?: boolean
  commercialFreightElevator?: boolean
  commercialCOIRequired?: boolean
  commercialLabelingRequired?: boolean
  commercialITEquipment?: boolean
  commercialDisposalRequired?: boolean
  commercialProtectionCost?: number
  commercialLiabilityCost?: number
  commercialAdminCost?: number
  commercialOtherDirectCost?: number
  commercialMarkupRate?: number
  commercialScopeNotes?: string
}

export interface LeadAttribution {
  originalSource?: string
  normalizedSource?: string
  landingPage?: string
  landingPath?: string
  referrer?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  fbclid?: string
  msclkid?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
  utmId?: string
  firstCapturedAt?: string
  lastCapturedAt?: string
}

export type TruckReservationStatus =
  | 'not_needed'
  | 'needs_booking'
  | 'booking_in_progress'
  | 'reserved'
  | 'issue'

export type TruckVendor = 'uhaul' | 'penske' | 'budget' | 'enterprise' | 'other'

export interface OpsChecklist {
  crewAssigned?: boolean
  truckReserved?: boolean
  accessConfirmed?: boolean
  parkingConfirmed?: boolean
  toolsReady?: boolean
  jobPacketReady?: boolean
  finalWalkthroughComplete?: boolean
}

export interface CrewHoursEntry {
  userId: string
  name?: string
  role?: string
  hours?: number
}

export type MoveExecutionPhase =
  | 'crew_depart_yard'
  | 'arrive_origin'
  | 'load_complete'
  | 'depart_origin'
  | 'arrive_destination'
  | 'unload_complete'
  | 'return_yard'

export interface MoveExecutionLogEntry {
  id: string
  phase: MoveExecutionPhase
  label: string
  timestamp?: string
  note?: string
  loggedAt?: string
  loggedBy?: string
}

export interface MoveExecutionIssue {
  id: string
  category: 'access' | 'inventory' | 'customer_delay' | 'crew' | 'truck' | 'damage' | 'weather' | 'traffic' | 'other'
  severity: 'low' | 'medium' | 'high'
  note: string
  createdAt: string
  createdBy?: string
}

export interface MoveExecutionLog {
  predictedHours?: number
  actualHours?: number
  varianceHours?: number
  varianceReason?: string
  entries?: MoveExecutionLogEntry[]
  issues?: MoveExecutionIssue[]
  receiptsNote?: string
  customerFeedbackNote?: string
  updatedAt?: string
  updatedBy?: string
}

export type CrewPayoutRole = 'crew_lead' | 'driver' | 'mover' | 'other'
export type CrewPayoutMethod = 'interac' | 'stripe_connect' | 'cash' | 'manual'
export type CrewPayoutStatus = 'draft' | 'submitted' | 'approved' | 'paid'
export type CrewDispatchStatus = 'pending' | 'sent' | 'confirmed' | 'declined'

export interface CrewPayoutEntry {
  id: string
  userId?: string
  workerName: string
  workerEmail?: string
  workerPhone?: string
  role: CrewPayoutRole
  hourlyRate: number
  approvedHours: number
  laborPay: number
  reimbursementAmount?: number
  reimbursementNote?: string
  receiptReference?: string
  paymentMethod?: CrewPayoutMethod
  payoutDestination?: string
  payoutStatus?: CrewPayoutStatus
  dispatchStatus?: CrewDispatchStatus
  dispatchToken?: string
  dispatchSentAt?: string
  dispatchConfirmedAt?: string
  dispatchDeclinedAt?: string
  submittedAt?: string
  approvedAt?: string
  approvedBy?: string
  paidAt?: string
  paidBy?: string
  financeNote?: string
  financeCostId?: string
  createdAt?: string
  updatedAt?: string
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
  referralCustomerName?: string
  partnerReferralContactId?: string
  partnerReferralName?: string
  partnerReferralCompany?: string
  partnerReferralCategory?: string
  partnerReferralEmail?: string
  partnerReferralPhone?: string
  partnerReferralLinkedAt?: string
  attribution?: LeadAttribution
  phone?: string
  email?: string
  identityPhone?: string
  identityEmail?: string
  moveDate?: string
  moveDateFlexible?: boolean      // true = date TBD (e.g. waiting on house closing)
  moveDateFlexibleReason?: string // e.g. "Waiting on buyer", "New house not closed yet"
  moveType?: MoveType
  propertyBedrooms?: 'studio' | '1_bedroom' | '2_bedrooms' | '3_bedrooms' | '4_bedrooms' | '5_plus'
  propertyType?: 'apartment' | 'condo' | 'townhouse' | 'detached_house' | 'commercial' | 'storage_unit'
  originStairFlights?: number
  destStairFlights?: number
  originElevatorAccess?: boolean
  destElevatorAccess?: boolean
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
  listingScanSnapshot?: InventoryScanDraft | null
  realtorName?: string
  realtorEmail?: string
  realtorPhone?: string
  realtorBrokerage?: string
  realtorWebsite?: string
  realtorContactId?: string
  realtorContactKind?: RealtorContactKind
  realtorLookupStatus?: RealtorLookupStatus
  realtorLookupConfidence?: 'high' | 'medium' | 'low'
  realtorWarmth?: RealtorWarmth
  realtorOutreachStatus?: RealtorOutreachStatus
  realtorEnrichedAt?: string
  realtorOutreachStartedAt?: string
  realtorLastTouchAt?: string
  moveReason?: string
  customerPriority?: string
  notes?: string
  followUpDate?: string
  followUpNote?: string
  followUpStatus?: LeadFollowUpStatus
  surveyToken?: string
  surveyTokenExpiresAt?: string
  surveyTokenPartyB?: string
  surveyTokenPartyBExpiresAt?: string
  surveyTokenPartyBLabel?: string
  surveyRequestedAt?: string
  surveyCompletedAt?: string
  surveyPhotoCount?: number
  surveyScannedAt?: string
  inventoryVerification?: InventoryVerification
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
  automationSettings?: LeadAutomationSettings
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
  inboxState?: LeadInboxState
  directMailAttributed?: boolean
  inventory?: InventoryItem[]
  removedInventoryItemKeys?: string[]
  mediaAssets?: LeadMediaAsset[]
  totalItems?: number
  totalCubicFeet?: number
  totalWeightLbs?: number
  roomBreakdown?: Record<string, number>
  callLogs?: CallLogEntry[]
  jobFactors?: JobFactors
  intelligence?: LeadIntelligence
  lostReason?: string
  lostNotes?: string
  lostAt?: string
  tentativeReservationStatus?: 'active' | 'converted' | 'released' | 'expired'
  tentativeReservedAt?: string
  tentativeHoldDate?: string
  tentativeDecisionDate?: string
  tentativeExpiresAt?: string
  tentativeReason?: 'reviewing_estimate' | 'comparing_options' | 'waiting_for_sale' | 'waiting_for_closing' | 'partner_decision' | 'date_uncertain' | 'other'
  tentativeNotes?: string
  tentativeCustomerNotifiedAt?: string
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
  crewHours?: CrewHoursEntry[]
  crewPayouts?: CrewPayoutEntry[]
  moveExecutionLog?: MoveExecutionLog
  truckReservationStatus?: TruckReservationStatus
  truckVendor?: TruckVendor
  truckSize?: string
  truckCountConfirmed?: number
  truckPickupLocation?: string
  truckPickupTime?: string
  truckReturnLocation?: string
  truckReservationNumber?: string
  truckReservationNotes?: string
  truckReservationBookedAt?: string
  truckReservationBookedBy?: string
  opsChecklist?: OpsChecklist
  // Estimate appointment
  estimateDate?: string
  estimateTime?: string
  consultationTriggerReason?: string
  consultationAssignedManagerName?: string
  consultationAssignedManagerId?: string
  consultationCustomerConcern?: string
  consultationPreVisitBrief?: string
  consultationStatus?: 'booked' | 'in_progress' | 'completed'
  consultationBookedAt?: string
  // Booking + payment
  bookedAt?: string
  depositAmount?: number
  depositMethod?: string
  depositDate?: string
  paymentStatus?: PaymentStatus
  promises?: CustomerPromise[]
  // Cancellation
  cancelledAt?: string
  cancelReason?: string
  // Post-job review lifecycle
  reviewJobId?: string
  reviewSentAt?: string
  reviewCompletedAt?: string
  reviewRating?: number
  reviewNotes?: string
  mergedIntoLeadId?: string
  mergedAt?: string
  mergedByUserId?: string
  mergedByName?: string
  mergedReason?: string
  // Manager approval for below-threshold margin overrides
  marginApprovalStatus?: 'pending' | 'approved'
  marginApprovalToken?: string
  marginApprovalRequestedAt?: string
  marginApprovalRequestedBy?: string
  marginApprovalContext?: string  // JSON: { overrideAmount, projectedMargin, note }
  marginApprovedAt?: string
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

export type QuoteLegType = 'move' | 'junk' | 'delivery' | 'storage' | 'storage_delivery'

export interface QuoteChangeEntry {
  id: string
  changedAt: string
  changedBy?: string
  reason: string
  changeType: 'onsite_addition' | 'price_revision' | 'scope_change' | 'customer_request' | 'correction'
  previousTotal?: number
  newTotal?: number
  estimatedExtraCost?: number
  deltaHours?: number
  note?: string
  customerNotified?: boolean
  approvalStatus?: 'pending' | 'approved' | 'declined' | 'not_required'
  approvalRequired?: boolean
  approvedAt?: string
  approvedBy?: string
  approvalMethod?: 'signed_link' | 'sms' | 'email' | 'in_person' | 'phone'
  originalBillingModel?: 'binding' | 'hourly_actuals' | 'hourly_minimum'
}

export interface QuoteLeg {
  id: string
  label: string
  type: QuoteLegType
  originAddress?: string
  originCity?: string
  destAddress?: string
  destCity?: string
  distanceKm?: number
  driveHours?: number
  routeCategory?: EstimateRouteContext['routeCategory']
  pricingStatus?: EstimateRouteContext['pricingStatus']
  billableDistanceKm?: number
  operationalDistanceKm?: number
  billableDriveHours?: number
  operationalDriveHours?: number
  yardToOriginHours?: number
  returnTripHours?: number
  inventorySharePct?: number
  scheduledDate?: string
  notes?: string
}

export interface CRMQuote {
  id: string
  number: string
  clientId: string
  leadId?: string
  moveDate?: string
  moveTime?: string   // e.g. "09:00" — crew start time shown on customer quote
  moveType?: string
  quoteType?: 'standard' | 'labor_only' | 'packing_only' | 'long_distance' | 'storage'
  jobLabel?: string
  originAddress?: string
  originCity?: string
  destAddress?: string
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
  billingModel?: 'binding' | 'hourly_actuals' | 'hourly_minimum'
  paymentTerms?: QuotePaymentTerms
  minimumBillableHours?: number
  maximumEstimatedHours?: number
  hourlyRateOverride?: number
  status: QuoteStatus
  validDays?: number
  acceptToken?: string
  legs?: QuoteLeg[]
  changeLog?: QuoteChangeEntry[]
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
  termsAcceptedAt?: string
  termsAcceptedVersion?: string
  termsAcceptedIp?: string
  termsAcceptedUserAgent?: string
  // Deposit payment tracking
  depositPaidAt?: string
  depositPaidAmount?: number
  depositPaidMethod?: 'stripe' | 'etransfer' | 'cash' | 'cheque' | 'other'
  depositPaidNote?: string
  depositStripeSessionId?: string
  stripeAccountKey?: 'saturn' | 'dexa'
  depositStripePaymentIntentId?: string
  depositStripeCustomerId?: string
  depositStripePaymentMethodId?: string
  depositStripeCardBrand?: string
  depositStripeCardLast4?: string
  // Balance charge
  balancePaidAt?: string
  balancePaidAmount?: number
  balancePaidMethod?: 'stripe' | 'etransfer' | 'cash' | 'cheque' | 'other'
  paymentRecords?: PaymentRecord[]
  // Overridable fields
  moveDescription?: string  // shown on the quote document
  internalNotes?: string    // crew / internal only, not on quote
  priceOverrideTotal?: number  // if set, this overrides the computed total (incl. HST)
  priceOverrideReason?: string
  priceOverrideApprovalCode?: string
  priceOverrideApprovalId?: string
  priceOverrideApprovalStatus?: 'pending' | 'approved' | 'rejected' | 'expired'
  priceOverrideApprovalRequestedAt?: string
  priceOverrideApprovalRequestedBy?: string
  priceOverrideApprovalRequestedByUserId?: string
  priceOverrideApprovalExpiresAt?: string
  priceOverrideApprovalApprovedAt?: string
  priceOverrideApprovalApprovedBy?: string
  priceOverrideApprovalAmount?: number
  priceOverrideApprovalOriginalSubtotal?: number
  priceOverrideApprovalProjectedMargin?: number
  priceOverrideApprovalReason?: string
  // Conditional clause — shown on customer quote (e.g. "if 2nd truck needed, $X extra")
  conditionalClause?: string
}

export type PaymentRecordKind = 'deposit' | 'partial' | 'balance' | 'final' | 'other'
export type PaymentRecordMethod = 'credit_card' | 'debit' | 'etransfer' | 'cash' | 'cheque' | 'bank_transfer' | 'other'

export interface PaymentRecord {
  id: string
  receiptNumber: string
  publicToken: string
  kind: PaymentRecordKind
  method: PaymentRecordMethod
  methodLabel: string
  amount: number
  totalBeforePayment: number
  paidBeforePayment: number
  paidAfterPayment: number
  balanceAfterPayment: number
  paidAt: string
  note?: string
  reference?: string
  cardLast4?: string
  recordedBy?: string
  recordedByUserId?: string
  emailSentAt?: string
  smsSentAt?: string
  status?: 'captured' | 'refunded' | 'partially_refunded'
  refundedAmount?: number
  refundedAt?: string
  refundReference?: string
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
  activeLeads: number
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
  matchedLeadId?: string
  matchedLeadName?: string
  matchedLeadStage?: SalesLeadStage
  inboxDisposition?: InboundLeadDisposition
  inboxStatus?: InboundLeadStatus
  lastActionAt?: string
  created_at: string
  claimed: boolean
  claimed_at?: string
}

export interface InboundLeadQueueSummary {
  queue: number
  priority: number
  webForms: number
  recentHandoffs: number
  closed: number
  focus: Record<InboundLeadFocusFilter, number>
  closedByDisposition: Record<InboundClosedFilter, number>
}

export interface InboundInboxPayload {
  items: InboundLead[]
  summary: InboundLeadQueueSummary
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
  readAt?: string | null
  readByUserId?: string | null
  readByName?: string | null
  actionedAt?: string | null
  actionedByUserId?: string | null
  actionedByName?: string | null
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
