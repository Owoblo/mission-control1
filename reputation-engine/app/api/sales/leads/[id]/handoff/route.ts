import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const current = await getSalesLead(params.id)
    if (!current) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (current.leadKind !== 'realtor_opportunity') {
      return NextResponse.json({ error: 'Lead is not a realtor opportunity' }, { status: 400 })
    }

    const body = (await request.json()) as {
      name?: string
      phone?: string
      email?: string
    }

    const clientName = body.name?.trim()
    const clientPhone = body.phone?.trim()
    const clientEmail = body.email?.trim().toLowerCase()

    if (!clientName) {
      return NextResponse.json({ error: 'Client name is required' }, { status: 400 })
    }

    if (!clientPhone && !clientEmail) {
      return NextResponse.json({ error: 'Client phone or email is required' }, { status: 400 })
    }

    const referringRealtorName = current.realtorName || current.realtorBrokerage || 'listing-side contact'
    const saved = await saveSalesLead({
      ...current,
      name: clientName,
      phone: clientPhone || undefined,
      email: clientEmail || undefined,
      primaryContactRole: 'customer',
      stage: current.stage === 'new' ? 'contacted' : current.stage,
      source: 'realtor_referral',
      realtorName: referringRealtorName,
      realtorPhone: current.realtorPhone || undefined,
      realtorEmail: current.realtorEmail || undefined,
    })

    const log = await saveFollowUpLog({
      id: uid('fu'),
      leadId: saved.id,
      type: 'note',
      date: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      notes: `Listing-side referral — ${referringRealtorName} handed off client. Active contact switched to ${clientName}. Source tagged as realtor_referral (20% discount eligible).`,
    })

    return NextResponse.json({ lead: saved, log })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to hand off realtor opportunity lead' },
      { status: 400 }
    )
  }
}
