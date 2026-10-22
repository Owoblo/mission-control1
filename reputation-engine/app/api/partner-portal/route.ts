import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { createPartnerResource, getPartner360, updatePartnerResource } from '@/lib/server/partner-platform'
import { isPortalRole, portalResource, portalView } from '@/lib/partner-portal-policy'

export async function GET() {
  const session = await getSessionUser()
  if (!session?.partnerId || !isPortalRole(session.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (session.role === 'partner_crew' && !session.partnerMemberId) return NextResponse.json({ error: 'Crew member identity required' }, { status: 403 })
  const data = await getPartner360(session.partnerId)
  if (!data) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  return NextResponse.json(portalView(data, session.role, session.partnerMemberId))
}
async function mutate(request: Request, method: 'POST' | 'PATCH') {
  const session = await getSessionUser()
  if (!session?.partnerId || !isPortalRole(session.role) || (session.role === 'partner_crew' && !session.partnerMemberId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const body = await request.json().catch(() => null)
  if (!body || typeof body.resource !== 'string' || (method === 'PATCH' && typeof body.resourceId !== 'string')) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const actor = { userId: session.userId, name: session.name, portalRole: session.role, partnerMemberId: session.partnerMemberId }
  try {
    const item = method === 'POST'
      ? await createPartnerResource(session.partnerId, body.resource, body.input, actor)
      : await updatePartnerResource(session.partnerId, body.resource, body.resourceId, body.patch, actor)
    return NextResponse.json({ item: portalResource(body.resource, item) }, { status: method === 'POST' ? 201 : 200 })
  } catch {
    return NextResponse.json({ error: 'Update not permitted or resource changed. Reload and check the submitted fields.' }, { status: 400 })
  }
}
export async function POST(request: Request) { return mutate(request, 'POST') }
export async function PATCH(request: Request) { return mutate(request, 'PATCH') }
