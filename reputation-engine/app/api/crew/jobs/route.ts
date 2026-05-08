import { NextResponse } from 'next/server'
import { isBookedLikeStage } from '@/lib/sales'
import { getSessionUser } from '@/lib/server/session'
import { listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Manager/owner can see all jobs; crew sees only assigned ones
  const allLeads = (await listSalesLeads())
    .filter(lead => isBookedLikeStage(lead.stage))
    .sort((a, b) => (a.moveDate || '9999').localeCompare(b.moveDate || '9999'))

  // For crew members — filter to only their assigned jobs
  const isCrewOnly = session.role === 'crew'
  const filtered = isCrewOnly
    ? allLeads.filter(lead => {
        const crew = lead.assignedCrew ?? []
        return crew.includes(session.userId ?? '')
      })
    : allLeads

  // Get matching quotes
  const quotes = await listSalesQuotes()

  const jobs = filtered.map(lead => {
    const quote = quotes.find(q => q.leadId === lead.id && q.status !== 'declined') ?? null
    return { lead, quote }
  })

  return NextResponse.json({ jobs })
}
