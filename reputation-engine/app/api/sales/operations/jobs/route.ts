import { NextResponse } from 'next/server'
import { isBookedLikeStage } from '@/lib/sales'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const branchFilter = searchParams.get('branch') || session?.branch || null

  const [leads, quotes] = await Promise.all([listSalesLeads(), listSalesQuotes()])

  const bookedLeads = leads.filter(l => {
    if (!isBookedLikeStage(l.stage) && l.paymentStatus !== 'deposit_received' && l.paymentStatus !== 'paid_in_full') {
      return false
    }
    // operations_lead: filter to their branch (from session or query param)
    if (branchFilter && l.branch && l.branch !== branchFilter) return false
    return true
  })

  const jobs = bookedLeads.map(lead => ({
    lead,
    quote: quotes.find(q => q.leadId === lead.id && (q.status === 'accepted' || q.status === 'sent' || q.status === 'invoiced')) || null,
  })).sort((a, b) => {
    const dateA = a.quote?.moveDate || a.lead.moveDate || '9999'
    const dateB = b.quote?.moveDate || b.lead.moveDate || '9999'
    return dateA.localeCompare(dateB)
  })

  return NextResponse.json({ jobs, branch: branchFilter })
}
