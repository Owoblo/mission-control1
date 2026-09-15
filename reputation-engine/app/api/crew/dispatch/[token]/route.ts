import { buildCurrentCrewBrief, buildMoveOperatingPlan, crewAcknowledgedPlan } from '@/lib/move-operating-plan'
import { NextResponse } from 'next/server'
import { formatDate } from '@/lib/sales'
import { getSalesLeadForUpdate, listSalesLeads, listSalesQuotes, saveSalesLead } from '@/lib/server/sales-repository'
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
      status: entry.dispatchStatus === 'confirmed' && !crewAcknowledgedPlan(entry, buildMoveOperatingPlan(lead, quote).fingerprint) ? 'pending' : entry.dispatchStatus || 'pending',
    },
    job: {
      planFingerprint: buildMoveOperatingPlan(lead, quote).fingerprint,
      crewSize: quote?.crewSize || null,
      truckCount: quote?.truckCount || null,
      estimatedHours: quote?.estimatedHours || null,
      crewNote: buildCurrentCrewBrief(lead, quote),
      equipmentReady: !!lead.opsChecklist?.toolsReady,
      briefingReady: buildMoveOperatingPlan(lead, quote).ready,
      crewBriefing: '',
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
  let match = findCrewAssignment(leads, token)
  if (!match) return NextResponse.json({ error: 'Dispatch link not found' }, { status: 404 })

  const quote = quotes.find(item => item.id === match.lead.quoteId) || quotes.find(item => item.leadId === match.lead.id) || null
  const awardedBrief = offers.find(item => item.id === match.entry.subcontractorOfferId)?.awardedCrewBriefing
  return NextResponse.json({ job: publicJobPayload(match.lead, quote, match.entry, awardedBrief) }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}

export async function POST(request: Request, props: { params: Promise<{ token: string }> }) {
  const params = await props.params;
  const token = params.token?.trim()
  if (!token) return NextResponse.json({ error: 'Invalid dispatch link' }, { status: 400 })

  const body = await request.json().catch(() => ({})) as { action?: string; planFingerprint?: string }
  if (body.action !== 'confirm' && body.action !== 'decline') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const leads = await listSalesLeads()
  let match = findCrewAssignment(leads, token)
  if (!match) return NextResponse.json({ error: 'Dispatch link not found' }, { status: 404 })
  const record = await getSalesLeadForUpdate(match.lead.id)
  match = record ? findCrewAssignment([record.lead], token) : null
  if (!match) return NextResponse.json({ error: 'Dispatch link changed. Reload before responding.' }, { status: 409 })

  const quotes = await listSalesQuotes()
  const quote = quotes.find(q => q.id === match.lead.quoteId) || quotes.find(q => q.leadId === match.lead.id) || null
  if (body.action === 'confirm' && (body.planFingerprint !== buildMoveOperatingPlan(match.lead, quote).fingerprint || !buildMoveOperatingPlan(match.lead, quote).ready)) {
    return NextResponse.json({ error: 'Operations must review the current truck, assembly and access plan before crew confirmation.' }, { status: 409 })
  }
  const now = new Date().toISOString()
  let savedLead: CRMLead
  try { savedLead = await saveSalesLead({
    ...match.lead,
    crewPayouts: (match.lead.crewPayouts || []).map(entry => {
      if (entry.dispatchToken !== token) return entry
      return {
        ...entry,
        dispatchStatus: body.action === 'confirm' ? 'confirmed' : 'declined',
        dispatchConfirmedAt: body.action === 'confirm' ? now : entry.dispatchConfirmedAt,
        dispatchPlanFingerprint: body.action === 'confirm' ? body.planFingerprint : entry.dispatchPlanFingerprint,
        dispatchAcknowledgements: body.action === 'confirm' && !crewAcknowledgedPlan(entry, body.planFingerprint!)
          ? [...(entry.dispatchAcknowledgements || []), { fingerprint: body.planFingerprint!, acknowledgedAt: now, actor: entry.workerName }]
          : entry.dispatchAcknowledgements,
        dispatchDeclinedAt: body.action === 'decline' ? now : entry.dispatchDeclinedAt,
      }
    }),
    lastTouchedAt: now,
  }, record!.updatedAt) } catch {
    return NextResponse.json({ error: 'The dispatch changed while saving. Reload before responding.' }, { status: 409 })
  }

  const updatedEntry = savedLead.crewPayouts?.find(entry => entry.dispatchToken === token) || match.entry
  return NextResponse.json({ ok: true, status: updatedEntry.dispatchStatus || 'pending' })
}
