import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, canEditLead } from '@/lib/server/sales-permissions'
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
  if (!canEditLead(session, lead)) {
    return NextResponse.json({ error: 'You can only post notes on leads you own.' }, { status: 403 })
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

  return NextResponse.json({ ok: true, log })
}
