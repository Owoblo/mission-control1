import { NextResponse } from 'next/server'
import { formatDate } from '@/lib/sales'
import { listSalesLeads, listSalesQuotes, saveSalesLead } from '@/lib/server/sales-repository'
import { getTruckPlanLabel, TRUCK_VENDOR_LABELS } from '@/lib/operations'
import type { CRMLead, CRMQuote, CrewPayoutEntry } from '@/lib/types'
import { listSubcontractorOffers } from '@/lib/server/subcontractors'
import { buildLiveCrewBriefing } from '@/lib/crew-briefing-view'

function findCrewAssignment(leads: CRMLead[], token: string) {
  for (const lead of leads) {
    const entry = (lead.crewPayouts || []).find(item => item.dispatchToken === token)
    if (entry) return { lead, entry }
  }
  return null
}

function publicJobPayload(lead: CRMLead, quote: CRMQuote | null, entry: CrewPayoutEntry, awardedBrief?: string) {
  return {
    leadId: lead.id,
    customerName: lead.name,
    moveDate: lead.moveDate ? formatDate(lead.moveDate) : 'TBD',
    origin: [lead.originAddress, lead.originCity].filter(Boolean).join(', ') || 'Origin TBD',
    destination: [lead.destAddress, lead.destCity].filter(Boolean).join(', ') || 'Destination TBD',
    access: {
      origin: lead.originAccess || '',
      destination: lead.destAccess || '',
      parking: lead.parkingNotes || '',
    },
    truck: {
      plan: getTruckPlanLabel(lead, quote),
      vendor: lead.truckVendor ? TRUCK_VENDOR_LABELS[lead.truckVendor] : '',
      pickupLocation: lead.truckPickupLocation || '',
      pickupTime: lead.truckPickupTime || '',
      returnLocation: lead.truckReturnLocation || '',
      reservationNumber: lead.truckReservationNumber || '',
      notes: lead.truckReservationNotes || '',
    },
    crew: {
      workerName: entry.workerName,
      role: entry.role,
      expectedHours: entry.approvedHours || quote?.estimatedHours || null,
      status: entry.dispatchStatus || 'pending',
    },
    job: {
      crewSize: quote?.crewSize || null,
      truckCount: quote?.truckCount || null,
      estimatedHours: quote?.estimatedHours || null,
      crewNote: lead.crewNote || '',
      equipmentReady: !!lead.opsChecklist?.toolsReady,
      briefingReady: !!lead.opsChecklist?.jobPacketReady,
      crewBriefing: awardedBrief || '',
      partnerWorkspaceEnabled: !!entry.subcontractorId,
    },
    briefing: buildLiveCrewBriefing(lead, quote, awardedBrief || ''),
  }
}

export async function GET(_: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = params.token?.trim()
  if (!token) return NextResponse.json({ error: 'Invalid dispatch link' }, { status: 400 })

  const [leads, quotes, offers] = await Promise.all([listSalesLeads(), listSalesQuotes(), listSubcontractorOffers().catch(() => [])])
  const match = findCrewAssignment(leads, token)
  if (!match) return NextResponse.json({ error: 'Dispatch link not found' }, { status: 404 })

  const quote = quotes.find(item => item.id === match.lead.quoteId || item.leadId === match.lead.id) || null
  const awardedBrief = offers.find(item => item.id === match.entry.subcontractorOfferId)?.awardedCrewBriefing
  return NextResponse.json({ job: publicJobPayload(match.lead, quote, match.entry, awardedBrief) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = params.token?.trim()
  if (!token) return NextResponse.json({ error: 'Invalid dispatch link' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { action?: string }
  if (body.action !== 'confirm' && body.action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const leads = await listSalesLeads()
  const match = findCrewAssignment(leads, token)
  if (!match) return NextResponse.json({ error: 'Dispatch link not found' }, { status: 404 })

  const now = new Date().toISOString()
  const savedLead = await saveSalesLead({
    ...match.lead,
    crewPayouts: (match.lead.crewPayouts || []).map(entry => {
      if (entry.dispatchToken !== token) return entry
      return {
        ...entry,
        dispatchStatus: body.action === 'confirm' ? 'confirmed' : 'declined',
        dispatchConfirmedAt: body.action === 'confirm' ? now : entry.dispatchConfirmedAt,
        dispatchDeclinedAt: body.action === 'decline' ? now : entry.dispatchDeclinedAt,
      }
    }),
    lastTouchedAt: now,
  })

  const updatedEntry = savedLead.crewPayouts?.find(entry => entry.dispatchToken === token) || match.entry
  return NextResponse.json({ ok: true, status: updatedEntry.dispatchStatus || 'pending' })
}
