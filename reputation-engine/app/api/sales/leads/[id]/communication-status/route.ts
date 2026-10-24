import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesLeadForUpdate } from '@/lib/server/sales-repository'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { customerLocalDate } from '@/lib/sales-automation-context'
import { completeCallback } from '@/lib/server/conversation-integrity'

async function access(request: Request, id: string) {
  const session = await getRequestSessionUser(request)
  if (!session) return { error: Response.json({ error: 'Unauthorized' }, { status: 401 }) }
  const lead = await getSalesLead(id)
  if (!lead || !canHandleLeadCommunications(session, lead)) return { error: Response.json({ error: 'Not found' }, { status: 404 }) }
  return { session, lead }
}
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params, checked = await access(request, id)
  if (checked.error) return checked.error
  const { url, headers } = requireSupabaseEnv()
  const reads = [
    ['sms', 'sms_messages', { lead_id: `eq.${id}`, direction: 'eq.outbound', delivery_status: 'in.(failed,undelivered,delivery_failed,sending_failed)', select: 'id,twilio_sid,created_at,delivery_status,to_number', order: 'created_at.desc', limit: '10' }],
    ['quoteChannels', 'quote_send_jobs', { lead_id: `eq.${id}`, status: 'in.(failed,sent,pending,processing)', select: 'id,quote_id,channel,status,recipient,sent_at,created_at', order: 'created_at.desc', limit: '20' }],
  ] as const
  const data: Record<string, unknown> = {}
  for (const [key, table, query] of reads) {
    const response = await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`, { headers, cache: 'no-store' })
    if (!response.ok) return Response.json({ error: 'Communication status is temporarily unavailable' }, { status: 503 })
    const rows = await response.json()
    if (key === 'quoteChannels') {
      const seen = new Set<string>()
      data[key] = rows.filter((row: { quote_id: string; channel: string }) => { const key = `${row.quote_id}:${row.channel}`; if (seen.has(key)) return false; seen.add(key); return true })
    } else {
      data[key] = rows.filter((row: { twilio_sid: string }) => checked.lead!.deliveryFailureReview?.status !== 'resolved' || row.twilio_sid !== checked.lead!.deliveryFailureReview.messageKey)
    }
  }
  return Response.json(data, { headers: { 'Cache-Control': 'private, no-store' } })
}
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params, checked = await access(request, id)
  if (checked.error) return checked.error
  const body = await request.json() as { action?: string; date?: string; note?: string }
  if (!['confirm-date','resolve-review','complete-callback','resolve-delivery'].includes(body.action || '') || (body.note || '').trim().length < 12) return Response.json({ error: 'Record the customer evidence for this decision (at least 12 characters).' }, { status: 400 })
  if (body.action === 'confirm-date' && (!body.date || !/^20\d{2}-\d{2}-\d{2}$/.test(body.date) || !Number.isFinite(Date.parse(body.date)) || new Date(body.date).toISOString().slice(0,10) !== body.date || body.date < customerLocalDate())) return Response.json({ error: 'Choose a valid current or future move date.' }, { status: 400 })
  const current = await getSalesLeadForUpdate(id)
  if (!current || !canHandleLeadCommunications(checked.session!, current.lead)) return Response.json({ error: 'Not found' }, { status: 404 })
  if (body.action === 'complete-callback') {
    if (Date.parse(current.lead.callbackCommitment?.notBefore || '') > Date.now()) return Response.json({ error: 'The customer requested a later callback. Wait for their window or record their new request.' }, { status: 409 })
    await completeCallback(current.lead, new Date().toISOString(), body.note!.trim())
    return Response.json({ lead: await getSalesLead(id) })
  }
  const key = body.action === 'resolve-delivery' ? current.lead.deliveryFailureReview?.messageKey : current.lead.conversationReview?.key
  if (body.action === 'resolve-delivery' && !key) return Response.json({ error: 'No delivery failure is awaiting review' }, { status: 409 })
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/rpc/resolve_crm_communication_review`, { method: 'POST', headers, body: JSON.stringify({ p_lead: id, p_key: key || '', p_action: body.action, p_note: body.note!.trim(), p_actor: checked.session!.name || 'Representative', p_date: body.date || null }) })
  if (!response.ok) return Response.json({ error: 'The customer review changed or needs a confirmed date. Refresh before saving.' }, { status: 409 })
  return Response.json({ lead: await response.json() })
}
