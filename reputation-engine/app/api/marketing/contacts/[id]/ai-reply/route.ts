import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { suggestPartnershipReply, type PartnershipAssistantContact, type PartnershipAssistantTouch } from '@/lib/server/partnership-reply-assistant'
import { partnershipRecordMatchesSession } from '@/lib/server/partnership-access'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { url, headers } = requireSupabaseEnv()

  const [contactRes, touchesRes] = await Promise.all([
    fetch(
      `${url}/rest/v1/market_contacts?id=eq.${encodeURIComponent(id)}&select=id,name,company,title,email,phone,city,industry,stage,decision,affiliate_partner_id,tracking_code&limit=1`,
      { headers, cache: 'no-store' }
    ),
    fetch(
      `${url}/rest/v1/market_touches?contact_id=eq.${encodeURIComponent(id)}&select=id,channel,direction,notes,created_by,created_at,outcome_code,metadata&order=created_at.asc&limit=40`,
      { headers, cache: 'no-store' }
    ),
  ])

  if (!contactRes.ok) return NextResponse.json({ error: 'Could not load partner' }, { status: 500 })
  if (!touchesRes.ok) return NextResponse.json({ error: 'Could not load conversation' }, { status: 500 })

  const [contact] = await contactRes.json() as PartnershipAssistantContact[]
  if (!contact) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  if (!partnershipRecordMatchesSession(session, contact as unknown as Record<string, unknown>)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const touches = await touchesRes.json() as PartnershipAssistantTouch[]
  const suggestion = await suggestPartnershipReply({ contact, touches })

  return NextResponse.json({
    ok: true,
    contact_id: id,
    suggestion,
  })
}
