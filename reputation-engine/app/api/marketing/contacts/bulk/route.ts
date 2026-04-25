import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

interface BulkContact {
  name: string
  company?: string
  title?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  industry?: string
  website?: string
  notes?: string
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { batch_id: string; contacts: BulkContact[] }

  if (!body.batch_id || !Array.isArray(body.contacts) || body.contacts.length === 0) {
    return NextResponse.json({ error: 'batch_id and contacts required' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()

  const batchRes = await fetch(
    `${url}/rest/v1/market_campaigns?id=eq.${body.batch_id}&select=id,name,industry,city`,
    { headers, cache: 'no-store' }
  )
  const [batch] = batchRes.ok ? await batchRes.json() : []
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const rows = body.contacts
    .filter(c => c.name?.trim())
    .map(c => ({
      name: c.name.trim(),
      company: c.company?.trim() || null,
      title: c.title?.trim() || null,
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
      address: c.address?.trim() || null,
      city: c.city?.trim() || (batch.city as string) || null,
      industry: c.industry?.trim() || (batch.industry as string) || null,
      website: c.website?.trim() || null,
      notes: c.notes?.trim() || null,
      stage: 'target',
      pipeline_phase: 'outreach',
      sequence_step: 0,
      sequence_paused: false,
      batch_id: body.batch_id,
      created_at: new Date().toISOString(),
    }))

  if (rows.length === 0) {
    return NextResponse.json({ error: 'No valid contacts (name required)' }, { status: 400 })
  }

  let inserted = 0
  const errors: string[] = []

  for (let i = 0; i < rows.length; i += 50) {
    const chunk = rows.slice(i, i + 50)
    const res = await fetch(`${url}/rest/v1/market_contacts`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(chunk),
    })
    if (res.ok) {
      inserted += chunk.length
    } else {
      errors.push(`Chunk ${i}-${i + chunk.length} failed`)
    }
  }

  return NextResponse.json({ ok: true, inserted, total: rows.length, errors })
}
