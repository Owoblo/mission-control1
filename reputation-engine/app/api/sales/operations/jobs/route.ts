import { NextResponse } from 'next/server'
import { isBookedLikeStage } from '@/lib/sales'
import { canAccessOperationsWorkspace, canAccessSalesWorkspace, isLeadOwnedBySession } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { listBookedSalesLeads, listOperationalSalesQuotes } from '@/lib/server/sales-repository'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session) && !canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const branchFilter = session?.branch || searchParams.get('branch') || null

  const [leads, quotes] = await Promise.all([listBookedSalesLeads(), listOperationalSalesQuotes()])

  const bookedLeads = leads.filter(l => {
    if (!isBookedLikeStage(l.stage)) return false
    // operations_lead: filter to their branch (from session or query param)
    if (branchFilter && l.branch && l.branch !== branchFilter) return false
    if (session?.role === 'sales_rep' && !isLeadOwnedBySession(l, session)) return false
    return true
  })

  const quoteRank = (quote: (typeof quotes)[number]) => {
    if (quote.status === 'invoiced') return 0
    if (quote.status === 'accepted') return 1
    if (quote.status === 'sent') return 2
    return 3
  }

  const jobs = bookedLeads.map(lead => ({
    lead,
    quote: quotes
      .filter(q =>
        q.leadId === lead.id &&
        (
          q.id === lead.quoteId ||
          q.status === 'accepted' ||
          q.status === 'sent' ||
          q.status === 'invoiced'
        )
      )
      .sort((a, b) => quoteRank(a) - quoteRank(b) || b.createdAt.localeCompare(a.createdAt))[0] || null,
  })).sort((a, b) => {
    const dateA = a.lead.moveDate || a.quote?.moveDate || '9999'
    const dateB = b.lead.moveDate || b.quote?.moveDate || '9999'
    return dateA.localeCompare(dateB)
  })

  return NextResponse.json({ jobs, branch: branchFilter })
}
