import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv, readEnv } from '@/lib/server/runtime'
import { addLeadToCampaign } from '@/lib/server/instantly'

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
  category?: string
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    batch_id: string
    contacts: BulkContact[]
    instantly_campaign_id?: string  // auto-route emails to this campaign
    auto_route?: boolean             // if true, email → Instantly, phone → call queue
  }

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
      category: c.category?.trim() || (batch.category as string) || null,
      outreach_tier: c.category ? (batch.tier as number ?? null) : null,
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

  // Auto-routing: push email contacts to Instantly campaign
  let instantly_added = 0
  if (body.auto_route && body.instantly_campaign_id && readEnv('INSTANTLY_API_KEY')) {
    // Fetch the contacts we just inserted to get their IDs
    const insertedRes = await fetch(
      `${url}/rest/v1/market_contacts?batch_id=eq.${body.batch_id}&select=id,name,email,phone,company&order=created_at.desc&limit=${inserted}`,
      { headers, cache: 'no-store' }
    )
    const insertedContacts = (insertedRes.ok ? await insertedRes.json() : []) as Array<{
      id: string; name: string; email: string | null; phone: string | null; company: string | null
    }>

    const withEmail = insertedContacts.filter(c => c.email?.trim())
    for (const contact of withEmail) {
      try {
        const nameParts = (contact.name || '').trim().split(' ')
        await addLeadToCampaign(body.instantly_campaign_id!, {
          email: contact.email!,
          first_name: nameParts[0] || '',
          last_name: nameParts.slice(1).join(' ') || '',
          company_name: contact.company || '',
        })
        // Update contact with Instantly campaign ID
        await fetch(`${url}/rest/v1/market_contacts?id=eq.${contact.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ instantly_campaign_id: body.instantly_campaign_id, instantly_status: 'active' }),
        })
        instantly_added++
      } catch { /* non-fatal */ }
    }
  }

  return NextResponse.json({ ok: true, inserted, total: rows.length, errors, instantly_added })
}
