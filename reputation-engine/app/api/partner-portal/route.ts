import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { createPartnerResource, getPartner360, updatePartnerResource } from '@/lib/server/partner-platform'

function allowed(role?: string, resource?: string, write = false) {
  if (!role?.startsWith('partner_')) return false
  if (!write) return true
  if (role === 'partner_admin') return ['member','vehicle','availability','document','claim','assignment'].includes(resource || '')
  if (role === 'partner_dispatcher') return ['availability','claim','assignment'].includes(resource || '')
  return ['claim','assignment'].includes(resource || '')
}

export async function GET() {
  const session = await getSessionUser(); if (!session?.partnerId || !allowed(session.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const data = await getPartner360(session.partnerId); if (!data) return NextResponse.json({ error: 'Partner not found' }, { status: 404 })
  if (session.role === 'partner_crew') return NextResponse.json({ ...data, ledger: [], balances: undefined, rates: [], audits: [], members: data.members.filter((item: any) => item.id === session.partnerMemberId), assignments: data.assignments.filter((item: any) => !session.partnerMemberId || item.member_ids?.includes(session.partnerMemberId)) })
  if (session.role === 'partner_dispatcher') return NextResponse.json({ ...data, ledger: [], balances: undefined, rates: [], audits: [] })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const session = await getSessionUser(); const body = await request.json().catch(() => ({})) as { resource?: string; input?: any }
  if (!session?.partnerId || !allowed(session.role, body.resource, true) || !body.resource || !body.input) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const input = body.resource === 'claim' ? { ...body.input, status: 'reported' } : body.input
  try { return NextResponse.json({ item: await createPartnerResource(session.partnerId, body.resource, input, { userId: session.userId, name: session.name }) }, { status: 201 }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create resource' }, { status: 400 }) }
}

export async function PATCH(request: Request) {
  const session = await getSessionUser(); const body = await request.json().catch(() => ({})) as { resource?: string; resourceId?: string; patch?: any }
  if (!session?.partnerId || !allowed(session.role, body.resource, true) || !body.resource || !body.resourceId || !body.patch) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const patch = session.role === 'partner_crew' && body.resource === 'assignment' ? { status: body.patch.status } : body.patch
  try { return NextResponse.json({ item: await updatePartnerResource(session.partnerId, body.resource, body.resourceId, patch, { userId: session.userId, name: session.name }) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update resource' }, { status: 400 }) }
}
