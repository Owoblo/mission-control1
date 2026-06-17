import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { defaultFollowUpDate } from '@/lib/marketing'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { activateAffiliatePartner } from '@/lib/server/affiliate-bridge'

type QuickAction =
  | 'active_partner'
  | 'drop_cards'
  | 'meeting_requested'
  | 'needs_follow_up'
  | 'not_interested'
  | 'wrong_number'

const ACTIONS: Record<QuickAction, {
  label: string
  outcomeCode: string
  nextStep: string | null
  contactUpdates: (now: string) => Record<string, unknown>
}> = {
  active_partner: {
    label: 'Active partner',
    outcomeCode: 'partnership_secured',
    nextStep: 'Keep warm and send referrals to partner portal.',
    contactUpdates: now => ({
      decision: 'agreed',
      stage: 'partnership_active',
      pipeline_phase: 'maintenance',
      sequence_paused: true,
      sequence_paused_reason: 'quick_action:active_partner',
      partnership_outcome: 'secured',
      partnership_outcome_at: now,
      partnership_started_at: now,
      account_status: 'active',
      next_follow_up: null,
    }),
  },
  drop_cards: {
    label: 'Drop cards',
    outcomeCode: 'field_visit_requested',
    nextStep: 'Add to field visit list and drop cards/flyers at their office.',
    contactUpdates: now => ({
      stage: 'qualified',
      pipeline_phase: 'field_visit',
      sequence_paused: true,
      sequence_paused_reason: 'quick_action:drop_cards',
      next_follow_up: defaultFollowUpDate(now, 3),
    }),
  },
  meeting_requested: {
    label: 'Meeting requested',
    outcomeCode: 'meeting_requested',
    nextStep: 'Book or confirm a meeting time.',
    contactUpdates: now => ({
      stage: 'qualified',
      pipeline_phase: 'field_visit',
      sequence_paused: true,
      sequence_paused_reason: 'quick_action:meeting_requested',
      next_follow_up: defaultFollowUpDate(now, 1),
    }),
  },
  needs_follow_up: {
    label: 'Needs follow-up',
    outcomeCode: 'follow_up_due',
    nextStep: 'Follow up manually from the partnership inbox.',
    contactUpdates: now => ({
      stage: 'follow_up_due',
      pipeline_phase: 'nurture',
      sequence_paused: true,
      sequence_paused_reason: 'quick_action:needs_follow_up',
      next_follow_up: defaultFollowUpDate(now, 2),
    }),
  },
  not_interested: {
    label: 'Not interested',
    outcomeCode: 'replied_negative',
    nextStep: null,
    contactUpdates: now => ({
      decision: 'rejected',
      stage: 'closed_lost',
      pipeline_phase: 'removed',
      sequence_paused: true,
      sequence_paused_reason: 'quick_action:not_interested',
      partnership_outcome: 'declined',
      partnership_outcome_at: now,
      account_status: 'closed',
      next_follow_up: null,
    }),
  },
  wrong_number: {
    label: 'Wrong number',
    outcomeCode: 'bad_number',
    nextStep: null,
    contactUpdates: () => ({
      decision: 'bad_number',
      stage: 'dnc',
      pipeline_phase: 'removed',
      sequence_paused: true,
      sequence_paused_reason: 'quick_action:wrong_number',
      account_status: 'closed',
      next_follow_up: null,
    }),
  },
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json().catch(() => ({})) as { action?: QuickAction; notes?: string }
  const action = body.action
  if (!action || !ACTIONS[action]) {
    return NextResponse.json({ error: 'action is required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()
  const config = ACTIONS[action]

  const latestRes = await fetch(
    `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(id)}&direction=eq.inbound&select=id,notes,created_at,channel&order=created_at.desc&limit=1`,
    { headers, cache: 'no-store' }
  )
  const [latestInbound] = (latestRes.ok ? await latestRes.json() : []) as Array<{
    id: string
    notes: string | null
    created_at: string
    channel: string | null
  }>

  const updates: Record<string, unknown> = {
    ...config.contactUpdates(now),
    last_touch_at: now,
  }

  const touchNotes = [
    `Quick action: ${config.label}.`,
    body.notes?.trim() ? `Rep note: ${body.notes.trim()}` : '',
    latestInbound?.notes ? `Latest reply: ${latestInbound.notes}` : '',
  ].filter(Boolean).join('\n')

  const updateRes = await fetch(`${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=*`, {
    method: 'PATCH',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify(updates),
  })

  if (!updateRes.ok) {
    return NextResponse.json({ error: 'Could not update contact' }, { status: 500 })
  }

  const [contact] = await updateRes.json()

  await Promise.all([
    fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${encodeURIComponent(id)}&status=eq.pending`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status: 'cancelled' }),
    }),
    fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: id,
        channel: latestInbound?.channel || 'sms',
        direction: 'internal',
        notes: touchNotes,
        outcome_code: config.outcomeCode,
        next_step: config.nextStep,
        next_follow_up_on: typeof updates.next_follow_up === 'string' ? updates.next_follow_up : null,
        metadata: {
          source: 'partnership_inbox_quick_action',
          action,
          latest_inbound_touch_id: latestInbound?.id ?? null,
        },
        created_by: session.name ?? 'Rep',
        created_at: now,
      }),
    }),
  ])

  if (action === 'active_partner') {
    void activateAffiliatePartner(id).catch(() => {})
  }

  return NextResponse.json({ ok: true, action, label: config.label, contact })
}
