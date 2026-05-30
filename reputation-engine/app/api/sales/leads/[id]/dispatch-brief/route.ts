import { NextResponse } from 'next/server'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote } from '@/lib/server/sales-repository'
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

    const quote = lead.quoteId ? await getSalesQuote(lead.quoteId).catch(() => null) : null
    const brief = await generateCrewBrief({ lead, quote })
    return NextResponse.json({ brief })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate dispatch brief' },
      { status: 500 }
    )
  }
}
