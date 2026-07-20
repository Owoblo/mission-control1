import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, listFollowUpLogsForLead } from '@/lib/server/sales-repository'

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const quoteIds = Array.from(new Set([lead.quoteId, ...(lead.quoteIds || [])].filter(Boolean))) as string[]
    const followUps = await listFollowUpLogsForLead(lead.id, quoteIds)
    return NextResponse.json({ followUps })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load lead follow-ups' },
      { status: 500 }
    )
  }
}
