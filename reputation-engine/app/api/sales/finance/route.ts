import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

interface JobCost {
  id: string
  lead_id: string
  category: string
  description: string | null
  amount_cents: number
  cost_date: string
  created_at: string
  created_by: string
}

function uid() {
  return 'jc_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

// GET /api/sales/finance?lead_id=xxx  — costs for one job
// GET /api/sales/finance               — all costs (for finance overview)
export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { url, headers } = requireSupabaseEnv()
  const { searchParams } = new URL(request.url)
  const leadId = searchParams.get('lead_id')

  const filter = leadId ? `&lead_id=eq.${leadId}` : ''
  const res = await fetch(
    `${url}/rest/v1/job_costs?select=*${filter}&order=cost_date.desc&limit=200`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return NextResponse.json({ error: 'Failed to load costs' }, { status: 500 })
  return NextResponse.json(await res.json())
}

// POST /api/sales/finance — create a cost entry
export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await request.json()) as {
    lead_id?: string
    category: string
    description?: string
    amount_cents: number
    cost_date: string
  }

  if (!body.category || !body.amount_cents || !body.cost_date) {
    return NextResponse.json({ error: 'category, amount_cents, cost_date required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/job_costs`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      id: uid(),
      lead_id: body.lead_id ?? 'overhead',
      category: body.category,
      description: body.description?.trim() || null,
      amount_cents: Math.round(body.amount_cents),
      cost_date: body.cost_date,
      created_by: session.userId ?? session.role,
    }),
  })
  if (!res.ok) return NextResponse.json({ error: 'Failed to save cost' }, { status: 500 })
  const [row] = (await res.json()) as JobCost[]
  return NextResponse.json(row)
}

// DELETE /api/sales/finance?id=xxx
export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { url, headers } = requireSupabaseEnv()
  await fetch(`${url}/rest/v1/job_costs?id=eq.${id}`, { method: 'DELETE', headers })
  return NextResponse.json({ ok: true })
}
