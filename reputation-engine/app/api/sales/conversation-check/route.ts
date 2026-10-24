import { getRequestSessionUser } from '@/lib/server/request-session'
import { canAccessSalesWorkspace, canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLeadByContact } from '@/lib/server/sales-repository'
import { callbackHold } from '@/lib/conversation-integrity'

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!canAccessSalesWorkspace(session)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const phone = new URL(request.url).searchParams.get('phone') || ''
  if (phone.replace(/\D/g, '').length < 10) return Response.json({ error: 'A complete phone number is required' }, { status: 400 })
  const lead = await getSalesLeadByContact(phone, null, null, { includeClosed: true })
  if (!lead) return Response.json({ hold: null })
  if (!canHandleLeadCommunications(session, lead)) return Response.json({ error: 'Not found' }, { status: 404 })
  return Response.json({ hold: callbackHold(lead), review: lead.conversationReview?.status === 'open' ? lead.conversationReview : null })
}
