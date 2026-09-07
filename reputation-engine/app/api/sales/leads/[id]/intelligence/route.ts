export const maxDuration = 60

import { NextResponse } from 'next/server'
import { getSalesLead } from '@/lib/server/sales-repository'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getWorkerSharedSecret } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'
import { refreshLeadIntelligence } from '@/lib/server/lead-intelligence-service'

function isInternalRequest(request: Request) {
  const secret = request.headers.get('x-internal-secret')
  const expected = getWorkerSharedSecret()
  return !!secret && !!expected && secret === expected
}

export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session) && !canAccessOperationsWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    return NextResponse.json({ intelligence: lead.intelligence || null })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}

export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const internal = isInternalRequest(_req)
    if (!internal) {
      const session = await getSessionUser()
      if (!canAccessSalesWorkspace(session) && !canAccessOperationsWorkspace(session)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    }

    const saved = await refreshLeadIntelligence(params.id)
    return NextResponse.json({ intelligence: saved.intelligence })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed' },
      { status: 500 }
    )
  }
}
