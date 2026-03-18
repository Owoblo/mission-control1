/**
 * Saturn Star Analytics — Event Logging Layer
 *
 * Every meaningful action fires logEvent() in the background.
 * Data accumulates silently in analytics_events table.
 * After 6+ months you can export everything and feed it to an LLM
 * to find patterns: close rates by source, best call times, pricing sweet spots,
 * which objections kill deals, rep performance, seasonal trends, and more.
 *
 * NEVER throws — always best-effort so it never breaks normal app flow.
 */

import { requireSupabaseEnv } from '@/lib/server/runtime'
import { uid } from '@/lib/sales'
import type { CRMLead, CRMQuote } from '@/lib/types'

export type EventType =
  | 'lead_created'
  | 'lead_stage_changed'
  | 'lead_lost'
  | 'lead_assigned'
  | 'job_booked'
  | 'call_completed'
  | 'voicemail_left'
  | 'consultation_completed'
  | 'quote_created'
  | 'quote_sent'
  | 'quote_viewed'
  | 'quote_accepted'
  | 'quote_declined'
  | 'sms_sent'
  | 'sms_received'
  | 'email_sent'
  | 'note_added'
  | 'follow_up_scheduled'
  | 'job_outcome_recorded'

interface EventProperties {
  // Lead context
  lead_source?: string
  lead_stage?: string
  lead_prev_stage?: string
  lead_score?: number
  move_type?: string
  move_type_detail?: string // 'residential' | 'long-distance' etc
  origin_city?: string
  dest_city?: string
  move_date?: string
  days_since_created?: number
  days_in_stage?: number // how long they were in the previous stage
  assigned_rep?: string

  // Quote context
  quote_id?: string
  quote_total?: number
  quote_deposit?: number
  crew_size?: number
  estimated_hours?: number
  truck_count?: number
  total_cubic_feet?: number
  inventory_item_count?: number
  discount_amount?: number
  discount_pct?: number
  has_specialty_items?: boolean
  floors_origin?: number
  floors_dest?: number
  has_elevator?: boolean
  move_distance_km?: number

  // Call context
  call_direction?: 'inbound' | 'outbound'
  call_duration_seconds?: number
  is_voicemail?: boolean
  move_readiness?: 'hot' | 'warm' | 'cold'
  ai_sentiment?: string
  ai_intent?: string
  ai_lead_concern?: string
  ai_next_action?: string
  call_number?: number // nth call with this lead

  // SMS/Email context
  channel?: 'sms' | 'email'
  message_direction?: 'inbound' | 'outbound'
  message_length?: number
  thread_length?: number // how many messages in thread so far
  has_ai_summary?: boolean

  // Lost context
  lost_reason?: string
  lost_notes?: string
  touchpoint_count?: number // total interactions before loss
  days_from_lead_to_loss?: number
  quotes_sent_before_loss?: number

  // Booked context
  days_from_lead_to_booked?: number
  touchpoints_to_close?: number
  deposit_method?: string
  deposit_amount?: number

  // Job outcome context
  actual_hours?: number
  estimated_vs_actual_hours_delta?: number
  actual_crew?: number
  damage_flag?: boolean
  customer_rating?: number
  review_left?: boolean
  referral_generated?: boolean
  net_profit?: number
  margin_pct?: number

  // Misc
  [key: string]: unknown
}

interface AnalyticsEvent {
  id: string
  event_type: EventType
  lead_id?: string
  rep_id?: string
  ts: string
  properties: EventProperties
  created_at: string
}

export async function logEvent(
  eventType: EventType,
  options: {
    leadId?: string
    repId?: string
    lead?: CRMLead
    quote?: CRMQuote
    properties?: EventProperties
  } = {}
): Promise<void> {
  try {
    const { url, headers } = requireSupabaseEnv()
    const now = new Date().toISOString()

    // Auto-enrich properties from lead if provided
    const enriched: EventProperties = {}

    if (options.lead) {
      const l = options.lead
      enriched.lead_source = l.source
      enriched.lead_stage = l.stage
      enriched.move_type = l.moveType
      enriched.origin_city = l.originCity
      enriched.dest_city = l.destCity
      enriched.move_date = l.moveDate
      enriched.lead_score = l.leadScore
      enriched.assigned_rep = l.assignedRep
      enriched.has_specialty_items = !!(l.jobFactors?.hasPiano || l.jobFactors?.hasSafe || l.jobFactors?.specialtyNotes)
      enriched.floors_origin = l.jobFactors?.originFloors
      enriched.floors_dest = l.jobFactors?.destFloors
      enriched.has_elevator = l.jobFactors?.originHasElevator || l.jobFactors?.destHasElevator
      enriched.inventory_item_count = l.totalItems
      enriched.total_cubic_feet = l.totalCubicFeet

      if (l.createdAt) {
        enriched.days_since_created = Math.floor(
          (Date.now() - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24)
        )
      }
      if (l.callLogs) {
        enriched.call_number = l.callLogs.filter(c => c.type === 'call').length
      }
    }

    if (options.quote) {
      const q = options.quote
      enriched.quote_id = q.id
      enriched.quote_total = q.total
      enriched.quote_deposit = q.deposit
      enriched.crew_size = q.crewSize
      enriched.estimated_hours = q.estimatedHours
      enriched.truck_count = q.truckCount
      enriched.discount_amount = q.discountAmount
      if (q.discountAmount && q.subtotal) {
        enriched.discount_pct = Math.round((q.discountAmount / q.subtotal) * 100)
      }
    }

    const event: AnalyticsEvent = {
      id: uid('ev'),
      event_type: eventType,
      lead_id: options.leadId || options.lead?.id,
      rep_id: options.repId || options.lead?.assignedRep,
      ts: now,
      properties: { ...enriched, ...options.properties },
      created_at: now,
    }

    await fetch(`${url}/rest/v1/analytics_events`, {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(event),
    })
  } catch {
    // Silently swallow — analytics must NEVER break the app
  }
}

/**
 * Helper: compute days between two ISO date strings
 */
export function daysBetween(a: string | undefined, b: string | undefined): number | undefined {
  if (!a || !b) return undefined
  const diff = new Date(b).getTime() - new Date(a).getTime()
  return Math.round(diff / (1000 * 60 * 60 * 24))
}
