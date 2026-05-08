import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { defaultFollowUpDate } from '@/lib/marketing'
import { requireSupabaseEnv } from '@/lib/server/runtime'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await request.json() as { decision: string; notes?: string }
  const { decision, notes } = body

  if (!['agreed', 'indifferent', 'rejected'].includes(decision)) {
    return NextResponse.json({ error: 'decision must be agreed | indifferent | rejected' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const now = new Date().toISOString()

  const stageMap: Record<string, string> = {
    agreed: 'partnership_active',
    indifferent: 'dormant',
    rejected: 'closed_lost',
  }
  const phaseMap: Record<string, string> = {
    agreed: 'maintenance',
    indifferent: 'nurture',
    rejected: 'removed',
  }

  const updates: Record<string, unknown> = {
    decision,
    sequence_paused: true,
    sequence_paused_reason: `rep:${decision}`,
    stage: stageMap[decision],
    pipeline_phase: phaseMap[decision],
    last_touch_at: now,
    next_follow_up: decision === 'indifferent' ? defaultFollowUpDate(now, 30) : null,
  }

  if (decision === 'agreed') {
    updates.partnership_outcome = 'secured'
    updates.partnership_outcome_at = now
    updates.partnership_started_at = now
    updates.account_status = 'active'
  } else if (decision === 'rejected') {
    updates.partnership_outcome = 'declined'
    updates.partnership_outcome_at = now
    updates.account_status = 'closed'
  }

  await Promise.all([
    // Cancel pending sequence jobs
    fetch(`${url}/rest/v1/sequence_jobs?contact_id=eq.${id}&status=eq.pending`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ status: 'cancelled' }),
    }),
    // Update contact
    fetch(`${url}/rest/v1/market_contacts?id=eq.${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify(updates),
    }),
    // Log touch
    notes ? fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: id,
        channel: 'phone',
        direction: 'inbound',
        notes: `Decision logged: ${decision}. ${notes}`,
        outcome_code: decision === 'agreed' ? 'partnership_secured' : decision === 'rejected' ? 'replied_negative' : '',
        created_by: session.name ?? 'Rep',
        created_at: now,
      }),
    }) : Promise.resolve(),
  ])

  return NextResponse.json({ ok: true, decision, stage: stageMap[decision], phase: phaseMap[decision] })
}
