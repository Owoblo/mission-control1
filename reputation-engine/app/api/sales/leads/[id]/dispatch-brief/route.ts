import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote, listFollowUpLogs } from '@/lib/server/sales-repository'
import { generateCrewBrief } from '@/lib/server/crew-dispatch'
import { getSessionUser } from '@/lib/server/session'

export const maxDuration = 60

export async function POST(_: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const [quote, allFollowUps] = await Promise.all([
      lead.quoteId ? getSalesQuote(lead.quoteId).catch(() => null) : Promise.resolve(null),
      listFollowUpLogs().catch(() => []),
    ])

    // Filter follow-up logs for this lead
    const leadFollowUps = allFollowUps.filter(f => f.leadId === lead.id)

    const brief = await generateCrewBrief({ lead, quote, followUps: leadFollowUps })
    return NextResponse.json({ brief })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate dispatch brief' },
      { status: 500 }
    )
  }
}
