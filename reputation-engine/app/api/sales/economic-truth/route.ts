import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { listSalesLeads, listSalesQuotes } from '@/lib/server/sales-repository'
import { loadEconomicTraces } from '@/lib/server/economic-truth'

export const dynamic = 'force-dynamic'
export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session || (session.role !== 'owner' && session.role !== 'manager')) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const branch = new URL(request.url).searchParams.get('branch')
  if (branch && !['windsor', 'london', 'waterloo', 'ottawa', 'unassigned'].includes(branch)) return NextResponse.json({ error: 'Invalid branch' }, { status: 400 })
  try {
    const [allLeads, allQuotes] = await Promise.all([listSalesLeads(), listSalesQuotes()])
    const leads = allLeads.filter(lead => leadMatchesSessionBranch(lead, session) && (!branch || (lead.branch || 'unassigned') === branch))
    const ids = new Set(leads.map(lead => lead.id))
    const rows = await loadEconomicTraces(leads, allQuotes.filter(q => q.leadId && ids.has(q.leadId)))
    return NextResponse.json({ checkedAt: new Date().toISOString(), rows,
      note: 'Recorded quote revenue and posted costs are provisional. Legacy outcome completeness is not finance sign-off. Final contribution requires a verified closeout; that workflow is not yet connected.' },
    { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Economic review is unavailable. A required record source could not be loaded; no zero-cost assumptions were made.' }, { status: 502 })
  }
}
