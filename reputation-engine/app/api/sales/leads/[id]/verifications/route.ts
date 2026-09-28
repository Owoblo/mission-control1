import { NextResponse } from 'next/server'
import { VERIFICATION_ITEMS, verificationScope, type LeadVerification } from '@/lib/lead-verification'
import { getSessionUser } from '@/lib/server/session'
import { canAccessSalesWorkspace, canEditLead, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSalesLeadForUpdate, saveSalesLead } from '@/lib/server/sales-repository'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await props.params
    const record = await getSalesLeadForUpdate(id)
    if (!record || !leadMatchesSessionBranch(record.lead, session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canEditLead(session, record.lead)) return NextResponse.json({ error: 'You cannot edit this lead.' }, { status: 403 })
    const body = await request.json()
    if (!VERIFICATION_ITEMS.some(item => item.key === body.key) || !['contacted', 'verified', 'needs_follow_up', 'not_applicable'].includes(body.status) || !['call', 'sms', 'email', 'photos_video', 'maps', 'in_person', 'internal'].includes(body.method)) return NextResponse.json({ error: 'Choose a valid item, result, and evidence source.' }, { status: 400 })
    if (typeof body.note !== 'string' || !body.note.trim() || body.note.length > 4000) return NextResponse.json({ error: 'Add an evidence note (up to 4,000 characters).' }, { status: 400 })
    if (body.followUpDate && (typeof body.followUpDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.followUpDate) || !Number.isFinite(Date.parse(body.followUpDate)))) return NextResponse.json({ error: 'Choose a valid follow-up date.' }, { status: 400 })
    const key = body.key as LeadVerification['key']
    const scope = verificationScope(record.lead, key)
    if (body.scope !== scope) return NextResponse.json({ error: 'These move details changed. Save the estimate, reload the lead, and verify the current details.' }, { status: 409 })
    const entry: LeadVerification = { id: crypto.randomUUID(), key, scope, status: body.status, method: body.method, note: body.note.trim(), followUpDate: body.followUpDate || undefined, recordedAt: new Date().toISOString(), actorName: session?.name || 'Sales', actorUserId: session?.userId }
    const lead = await saveSalesLead({ ...record.lead, verificationHistory: [...(record.lead.verificationHistory || []), entry], ...(entry.followUpDate ? { followUpDate: entry.followUpDate, followUpNote: entry.note, followUpStatus: 'pending' as const } : {}) }, record.updatedAt)
    return NextResponse.json({ lead })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save verification.'
    return NextResponse.json({ error: message }, { status: /changed while saving/.test(message) ? 409 : 500 })
  }
}

/** Historical stage changes are read from the original analytics events, not inferred from the current owner. */
export async function GET(_request: Request, props: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const { id } = await props.params
    const record = await getSalesLeadForUpdate(id)
    if (!record || !leadMatchesSessionBranch(record.lead, session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const { requireSupabaseEnv } = await import('@/lib/server/runtime')
    const { url, headers } = requireSupabaseEnv()
    const history = [...(record.lead.stageHistory || [])]
    for (let offset = 0; ; offset += 200) {
      const query = new URLSearchParams({ select: 'id,ts,properties', lead_id: `eq.${id}`, event_type: 'eq.lead_stage_changed', order: 'ts.asc,id.asc', limit: '200', offset: String(offset) })
      const response = await fetch(`${url}/rest/v1/analytics_events?${query}`, { headers, cache: 'no-store' })
      if (!response.ok) return NextResponse.json({ error: 'Historical stage events are temporarily unavailable.' }, { status: 502 })
      const rows = await response.json() as Array<{id: string; ts: string; properties: Record<string, string>}>
      for (const row of rows) {
        const p = row.properties
        if (history.some(item => item.from === p.lead_prev_stage && item.to === p.lead_stage && Math.abs(Date.parse(item.at) - Date.parse(row.ts)) < 10000)) continue
        history.push({ id: row.id, at: row.ts, from: p.lead_prev_stage as typeof record.lead.stage, to: p.lead_stage as typeof record.lead.stage, actorName: p.actor_name || 'Actor not recorded', actorUserId: p.actor_user_id, source: 'historical_event', reason: p.lost_reason, evidence: 'Historical analytics event; account attribution as originally recorded.' })
      }
      if (rows.length < 200) break
    }
    return NextResponse.json({ stageHistory: history })
  } catch { return NextResponse.json({ error: 'Could not load historical stage events.' }, { status: 500 }) }
}
