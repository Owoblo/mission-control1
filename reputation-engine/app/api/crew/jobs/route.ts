import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { CRMLead, CRMQuote } from '@/lib/types'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Manager/owner can see all jobs; crew sees only assigned ones
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/crm_leads?stage=eq.booked&deleted=eq.false&order=move_date.asc&select=id,data`,
    { headers, cache: 'no-store' }
  )

  if (!res.ok) return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 })

  const rows = (await res.json()) as { id: string; data: CRMLead }[]
  const allLeads = rows.map(r => ({ ...r.data, id: r.id }))

  // For crew members — filter to only their assigned jobs
  const isCrewOnly = session.role === 'crew'
  const filtered = isCrewOnly
    ? allLeads.filter(lead => {
        const crew = (lead as CRMLead & { assignedCrew?: string[] }).assignedCrew ?? []
        return crew.includes(session.userId ?? '')
      })
    : allLeads

  // Get matching quotes
  const quotesRes = await fetch(
    `${url}/rest/v1/crm_quotes?deleted=eq.false&select=id,data`,
    { headers, cache: 'no-store' }
  )
  const quoteRows = quotesRes.ok
    ? ((await quotesRes.json()) as { id: string; data: CRMQuote }[])
    : []
  const quotes = quoteRows.map(r => ({ ...r.data, id: r.id }))

  const jobs = filtered.map(lead => {
    const quote = quotes.find(q => q.leadId === lead.id && q.status !== 'declined') ?? null
    return { lead, quote }
  })

  return NextResponse.json({ jobs })
}
