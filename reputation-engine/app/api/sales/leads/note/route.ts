import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { saveFollowUpLog } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

export async function POST(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) return new Response('Unauthorized', { status: 401 })

  const { leadId, text, type } = await request.json() as { leadId: string; text: string; type?: string }
  if (!leadId || !text?.trim()) return NextResponse.json({ error: 'leadId and text required' }, { status: 400 })

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
