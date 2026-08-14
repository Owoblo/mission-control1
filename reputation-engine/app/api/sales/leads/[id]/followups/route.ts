import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace, leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLeadAccessSnapshot, listFollowUpLogsForLead } from '@/lib/server/sales-repository'

export async function GET(_: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLeadAccessSnapshot(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    if (!leadMatchesSessionBranch(lead, session)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const followUps = await listFollowUpLogsForLead(lead.id)
    return NextResponse.json({ followUps })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load lead follow-ups' },
      { status: 500 }
    )
  }
}
