import { NextResponse } from 'next/server'
import { buildInboundQueueSummary, decorateInboundLead } from '@/lib/inbound-inbox'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { listAllInboundLeads, listSalesLeadIdentitySnapshots } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

// Lightweight count — polled by header every 30s for the badge
export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) return NextResponse.json({ count: 0 })

  const [items, leads] = await Promise.all([listAllInboundLeads(), listSalesLeadIdentitySnapshots()])
  const linkedLeadIds = new Map(
    leads.filter(lead => lead.inboundId).map(lead => [lead.inboundId as string, lead.id] as const)
  )
  const hydrated = items.map(item => decorateInboundLead({
    ...item,
    linkedLeadId: linkedLeadIds.get(item.id),
  }))
  return NextResponse.json({ count: buildInboundQueueSummary(hydrated).queue })
}
