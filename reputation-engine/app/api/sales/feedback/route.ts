import type { CRMLead } from '@/lib/types'
import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { leadMatchesSessionBranch } from '@/lib/server/sales-permissions'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { summarizeFeedback, type CustomerFeedback } from '@/lib/customer-feedback'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session || !['owner', 'manager'].includes(session.role || '')) return NextResponse.json({ error: 'Management access required.' }, { status: 403 })
  const start = new URL(request.url).searchParams.get('start') || new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start)) || new Date(start).toISOString().slice(0, 10) !== start) return NextResponse.json({ error: 'Invalid start date.' }, { status: 400 })
  const end = new Date(Date.parse(start) + 7 * 86400000).toISOString()
  try {
    const { url, headers } = requireSupabaseEnv()
    type Row = { id: string; name: string; branch: CRMLead['branch']; originCity: string; originAddress: string; destCity: string; destAddress: string; source: string; feedback: CustomerFeedback }
    const rows: Row[] = []
    for (let offset = 0; ; offset += 500) {
      const query = new URLSearchParams({ select: 'id,name:data->>name,branch:data->>branch,originCity:data->>originCity,originAddress:data->>originAddress,destCity:data->>destCity,destAddress:data->>destAddress,source:data->>source,feedback:data->customerFeedback', deleted: 'eq.false', and: `(data->customerFeedback->>reviewedAt.gte.${start}T00:00:00.000Z,data->customerFeedback->>reviewedAt.lt.${end})`, order: 'id.asc', limit: '500', offset: String(offset) })
      const response = await fetch(`${url}/rest/v1/crm_leads?${query}`, { headers, cache: 'no-store', signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('Could not load report.')
      const batch = await response.json() as Row[]
      rows.push(...batch.filter(row => leadMatchesSessionBranch(row, session)))
      if (batch.length < 500) break
      if (offset >= 10000) throw new Error('Report is too large to load safely.')
    }
    const records = rows.map(row => ({ id: row.id, name: row.name, market: row.originCity || row.branch || 'Unknown', source: row.source || 'Unknown', feedback: row.feedback }))
    return NextResponse.json({ start, end, summary: summarizeFeedback(records), records })
  } catch { return NextResponse.json({ error: 'Report could not load completely. Please retry.' }, { status: 503 }) }
}
