import { NextResponse } from 'next/server'
import { isBookedLikeStage } from '@/lib/sales'
import { getSessionUser } from '@/lib/server/session'
import { leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { listBookedSalesLeads, listOperationalSalesQuotes } from '@/lib/server/sales-repository'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Manager/owner can see all jobs; crew sees only assigned ones
    const [bookedLeads, quotes] = await Promise.all([listBookedSalesLeads(), listOperationalSalesQuotes()])
    const allLeads = bookedLeads
      .filter(lead => isBookedLikeStage(lead.stage))
      .filter(lead => leadMatchesSessionBranch(lead, session))
      .sort((a, b) => (a.moveDate || '9999').localeCompare(b.moveDate || '9999'))

  // For crew members — filter to only their assigned jobs
    const isCrewOnly = session.role === 'crew'
    const filtered = isCrewOnly
      ? allLeads.filter(lead => {
          const crew = lead.assignedCrew ?? []
          return crew.includes(session.userId ?? '')
        })
      : allLeads

    const quoteByLead = new Map(quotes
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(quote => [quote.leadId, quote] as const))

    const jobs = filtered.map(lead => {
      const quote = quoteByLead.get(lead.id) ?? null
      return { lead, quote }
    })

    return NextResponse.json({ jobs })
  } catch (error) {
    console.error('[crew/jobs] Operational job read failed', error)
    return NextResponse.json({
      error: 'Jobs could not be loaded right now. No job data was changed. Retry in a moment.',
      code: 'JOB_READ_UNAVAILABLE',
      retryable: true,
    }, { status: 503, headers: { 'Retry-After': '2' } })
  }
}
