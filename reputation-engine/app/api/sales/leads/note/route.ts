import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { queueLeadIntelligenceRefresh } from '@/lib/server/lead-intelligence-refresh'
import { getSalesLead, saveFollowUpLog } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { uid } from '@/lib/sales'

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return new Response('Unauthorized', { status: 401 })

  const { leadId, text, type } = await request.json() as { leadId: string; text: string; type?: string }
  if (!leadId || !text?.trim()) return NextResponse.json({ error: 'leadId and text required' }, { status: 400 })

  const lead = await getSalesLead(leadId)
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  if (!canHandleLeadCommunications(session, lead)) {
    return NextResponse.json({ error: 'You do not have permission to post notes on this lead.' }, { status: 403 })
  }

  const logType = (type === 'incident' ? 'note' : type || 'note') as import('@/lib/types').FollowUpType

  const log = await saveFollowUpLog({
    id: uid('note'),
    leadId,
    type: logType,
    date: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    notes: text.trim(),
  })

  queueLeadIntelligenceRefresh(leadId, new URL(request.url).origin)

  return NextResponse.json({ ok: true, log })
}
