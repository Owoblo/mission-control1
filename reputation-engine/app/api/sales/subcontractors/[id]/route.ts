import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { createPartnerPortalUser, createPartnerResource, getPartner360, updatePartnerResource } from '@/lib/server/partner-platform'

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(); if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params
  try { const partner = await getPartner360(id); return partner ? NextResponse.json(partner) : NextResponse.json({ error: 'Partner not found' }, { status: 404 }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not load partner' }, { status: 500 }) }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(); if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params; const body = await request.json().catch(() => ({})) as { resource?: string; input?: any }
  if (!body.resource || !body.input) return NextResponse.json({ error: 'Resource and input are required' }, { status: 400 })
  try {
    const actor = { userId: session?.userId, name: session?.name }
    const item = body.resource === 'portal_user'
      ? (session?.role === 'owner' ? await createPartnerPortalUser(id, body.input, actor) : null)
      : await createPartnerResource(id, body.resource, body.input, actor)
    if (!item) return NextResponse.json({ error: 'Only an owner can provision partner access.' }, { status: 403 })
    return NextResponse.json({ item }, { status: 201 })
  }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create resource' }, { status: 400 }) }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSessionUser(); if (!canAccessOperationsWorkspace(session)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await context.params; const body = await request.json().catch(() => ({})) as { resource?: string; resourceId?: string; patch?: any }
  if (!body.resource || !body.resourceId || !body.patch) return NextResponse.json({ error: 'Resource, resourceId, and patch are required' }, { status: 400 })
  try { return NextResponse.json({ item: await updatePartnerResource(id, body.resource, body.resourceId, body.patch, { userId: session?.userId, name: session?.name }) }) }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not update resource' }, { status: 400 }) }
}
