import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { addLeadToCampaign, removeLeadFromCampaign, getLeadStatus } from '@/lib/server/instantly'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const campaignId = searchParams.get('campaign_id')
  const email = searchParams.get('email')
  if (!campaignId || !email) return NextResponse.json({ error: 'campaign_id and email required' }, { status: 400 })

  try {
    const lead = await getLeadStatus(campaignId, email)
    return NextResponse.json({ ok: true, lead })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    contact_id: string
    campaign_id: string
    email: string
    first_name?: string
    last_name?: string
    company_name?: string
    phone?: string
    website?: string
    custom_variables?: Record<string, string>
  }

  if (!body.contact_id || !body.campaign_id || !body.email) {
    return NextResponse.json({ error: 'contact_id, campaign_id and email required' }, { status: 400 })
  }

  try {
    const lead = await addLeadToCampaign(body.campaign_id, {
      email: body.email,
      first_name: body.first_name,
      last_name: body.last_name,
      company_name: body.company_name,
      phone: body.phone,
      website: body.website,
      custom_variables: body.custom_variables,
    })

    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/market_contacts?id=eq.${body.contact_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        instantly_campaign_id: body.campaign_id,
        instantly_lead_id: lead.id ?? null,
        instantly_status: 'active',
      }),
    })

    await fetch(`${url}/rest/v1/market_touches`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({
        contact_id: body.contact_id,
        channel: 'email',
        direction: 'outbound',
        notes: `Added to Instantly campaign`,
        created_by: session.name ?? 'Rep',
        created_at: new Date().toISOString(),
        metadata: { source: 'instantly', campaign_id: body.campaign_id },
      }),
    })

    return NextResponse.json({ ok: true, lead })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { contact_id: string; campaign_id: string; email: string }
  if (!body.contact_id || !body.campaign_id || !body.email) {
    return NextResponse.json({ error: 'contact_id, campaign_id and email required' }, { status: 400 })
  }

  try {
    await removeLeadFromCampaign(body.campaign_id, body.email)

    const { url, headers } = requireSupabaseEnv()
    await fetch(`${url}/rest/v1/market_contacts?id=eq.${body.contact_id}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ instantly_status: 'removed', instantly_campaign_id: null, instantly_lead_id: null }),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}
