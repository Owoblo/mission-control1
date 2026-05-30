import { NextResponse } from 'next/server'
import { requireSupabaseEnv } from '@/lib/server/runtime'

async function getLeadByToken(token: string) {
  const { url, headers } = requireSupabaseEnv()
  // Query directly by surveyToken field — never fetch all leads
  const res = await fetch(
    `${url}/rest/v1/crm_leads?select=id,data&data->>surveyToken=eq.${encodeURIComponent(token)}&deleted=not.is.true&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = await res.json() as Array<{ id: string; data: Record<string, unknown> }>
  return rows[0] || null
}

export async function GET(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const row = await getLeadByToken(params.token)
    if (!row) return NextResponse.json({ error: 'Invalid or expired survey link' }, { status: 404 })

    const data = row.data
    const expiresAt = data.surveyTokenExpiresAt as string | undefined
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return NextResponse.json({ error: 'This survey link has expired' }, { status: 410 })
    }

    // Return only safe, customer-facing info
    return NextResponse.json({
      leadId: row.id,
      customerName: (data.name as string || '').split(' ')[0] || 'there',
      originAddress: data.originAddress as string || '',
      originCity: data.originCity as string || '',
      moveDate: data.moveDate as string || '',
      surveyCompletedAt: data.surveyCompletedAt as string || null,
      surveyPhotoCount: (data.surveyPhotoCount as number) || 0,
      existingInventoryCount: Array.isArray(data.inventory) ? (data.inventory as unknown[]).length : 0,
    })
  } catch (err) {
    console.error('[survey] GET error', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

export async function POST(
  _request: Request,
  { params }: { params: { token: string } }
) {
  try {
    const row = await getLeadByToken(params.token)
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { url, headers } = requireSupabaseEnv()
    const updated = { ...row.data, surveyCompletedAt: new Date().toISOString() }
    await fetch(`${url}/rest/v1/crm_leads?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ data: updated }),
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[survey] POST complete error', err)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
