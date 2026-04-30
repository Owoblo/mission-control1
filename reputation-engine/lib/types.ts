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
  disassemblyHours?: number      // pre-computed from per-item times; overrides count-based flat calc
  disassemblyDetails?: string[]  // per-item breakdown for display (e.g. "Queen Bed: 10 dis + 15 re")

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
  jobFactors?: JobFactors
  lostReason?: string
  lostNotes?: string
  lostAt?: string
  // Context + assignment
  contextFlag?: string
  assignedRep?: string
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
  // Move execution
  startTime?: string          // scheduled start time e.g. "08:00"
  actualHours?: number        // hours logged by crew lead after move
  actualHoursNote?: string    // reason if over/under estimate (extra items, etc.)
  actualHoursLoggedAt?: string
  actualHoursLoggedBy?: string
  // Truck logistics
  truckReserved?: boolean
  truckCompany?: string
  truckReservationNumber?: string
  truckPickupTime?: string
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
  // Customer-facing notes (shown on quote — extras, inclusions, special offers)
  customerNotes?: string
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

export interface QuoteDocumentPayload {
  quote: CRMQuote
  clientName?: string
  leadName?: string
}

export type WorkerRole = 'mover' | 'driver' | 'lead' | 'packer'
export type WorkerCity = 'kitchener' | 'windsor' | 'toronto' | 'hamilton' | 'ottawa' | 'london' | 'other'

export interface CRMWorker {
  id: string
  name: string
  phone: string
  city: WorkerCity
  role: WorkerRole
  available: boolean   // false = currently inactive / not taking jobs
  notes?: string
  createdAt: string
}
