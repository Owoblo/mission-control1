import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { sendPartnershipSmsReply } from '@/lib/server/partnership-sms-reply'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const payload = await request.json().catch(() => ({}))
  return sendPartnershipSmsReply(session, id, payload, Boolean(request.headers.get('authorization')))
}
