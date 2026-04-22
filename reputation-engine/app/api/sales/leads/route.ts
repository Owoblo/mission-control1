import { NextResponse } from 'next/server'
import { applyDetectedBranch } from '@/lib/server/sales-opportunities'
import { calculateLeadScore, getLeadAssignedRepName, normalizeLead, uid } from '@/lib/sales'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { recordLeadCreatedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { listSalesLeads, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { normalizeEmail, validateLeadPayload } from '@/lib/server/sales-validation'
import type { CRMLead } from '@/lib/types'

function digitsOnly(value?: string) {
  return (value || '').replace(/\D/g, '')
}

function findMatchingActiveLead(leads: CRMLead[], phone?: string, email?: string) {
  const phoneDigits = digitsOnly(phone)
  const normalizedEmail = normalizeEmail(email)

  return leads.find(lead => {
    if (lead.stage === 'booked' || lead.stage === 'lost') {
      return false
    }

    const leadPhoneDigits = digitsOnly(lead.phone)
    const leadEmail = normalizeEmail(lead.email)

    if (phoneDigits && leadPhoneDigits && (leadPhoneDigits === phoneDigits || leadPhoneDigits.endsWith(phoneDigits) || phoneDigits.endsWith(leadPhoneDigits))) {
      return true
    }

    return !!normalizedEmail && !!leadEmail && leadEmail === normalizedEmail
  }) || null
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date().toISOString()
    const payload = (await request.json()) as Partial<CRMLead> & { forceNew?: boolean }
    const validated = validateLeadPayload(payload)
    const creatorOwnsLead = session?.role === 'sales_rep'
    const requestedAssignedRepName = payload.assignedRepName?.trim() || payload.assignedRep?.trim()
    const requestedAssignedRepUserId = payload.assignedRepUserId?.trim()
    const assignedRepName = requestedAssignedRepName || (creatorOwnsLead ? session?.name?.trim() : undefined)
    const assignedRepUserId = requestedAssignedRepUserId || (creatorOwnsLead ? session?.userId : undefined)
    const existingLead = payload.forceNew
      || payload.leadKind === 'realtor_opportunity'
      ? null
      : findMatchingActiveLead(await listSalesLeads(), validated.phone, validated.email)

    if (existingLead) {
      const mergedLead = normalizeLead({
        ...existingLead,
        name: existingLead.name || validated.name,
        phone: existingLead.phone || validated.phone,
        email: existingLead.email || validated.email,
        source: existingLead.source || payload.source || 'other',
        moveDate: existingLead.moveDate || payload.moveDate,
        moveType: existingLead.moveType || validated.moveType || 'residential',
        originAddress: existingLead.originAddress || payload.originAddress?.trim(),
        originCity: existingLead.originCity || payload.originCity?.trim(),
        destCity: existingLead.destCity || payload.destCity?.trim(),
        moveReason: existingLead.moveReason || payload.moveReason?.trim(),
        notes: existingLead.notes || payload.notes?.trim(),
        followUpDate: existingLead.followUpDate || payload.followUpDate,
        lastTouchedAt: now,
        lastTouchedByUserId: session?.userId || existingLead.lastTouchedByUserId,
        lastTouchedByName: session?.name?.trim() || existingLead.lastTouchedByName,
      })

      const saved = await saveSalesLead(applyDetectedBranch({
        ...mergedLead,
        leadScore: calculateLeadScore(mergedLead),
      }))
      await recordLeadUpdateAudit(existingLead, saved)
      return NextResponse.json(saved)
    }

    const lead = applyDetectedBranch(normalizeLead({
      id: payload.id || uid('lead'),
      name: validated.name,
      stage: payload.stage || 'new',
      branch: payload.branch,
      leadKind: payload.leadKind || 'customer',
      primaryContactRole: payload.primaryContactRole || 'customer',
      source: payload.source || 'other',
      inboundId: payload.inboundId,
      inboundMessage: payload.inboundMessage?.trim(),
      phone: validated.phone,
      email: validated.email,
      moveDate: payload.moveDate,
      moveType: validated.moveType || 'residential',
      originAddress: payload.originAddress?.trim(),
      originCity: payload.originCity?.trim(),
      destAddress: payload.destAddress?.trim(),
      destCity: payload.destCity?.trim(),
      originAccess: payload.originAccess?.trim(),
      destAccess: payload.destAccess?.trim(),
      parkingNotes: payload.parkingNotes?.trim(),
      supabaseListing: payload.supabaseListing || null,
      moveReason: payload.moveReason?.trim(),
      notes: payload.notes?.trim(),
      followUpDate: payload.followUpDate,
      quoteId: payload.quoteId,
      assignedRep: assignedRepName,
      assignedRepName,
      assignedRepUserId,
      leadOwnerStatus: assignedRepName ? 'assigned' : 'unassigned',
      ownedAt: assignedRepName ? now : undefined,
      lastTouchedAt: now,
      lastTouchedByUserId: session?.userId,
      lastTouchedByName: session?.name?.trim(),
      directMailAttributed: payload.directMailAttributed || false,
      inventory: payload.inventory || [],
      totalItems: payload.totalItems || 0,
      totalCubicFeet: payload.totalCubicFeet || 0,
      totalWeightLbs: payload.totalWeightLbs || 0,
      roomBreakdown: payload.roomBreakdown || {},
      callLogs: payload.callLogs || [],
      createdAt: payload.createdAt || new Date().toISOString().slice(0, 10),
      leadScore: 0,
    }))

    const saved = await saveSalesLead({
      ...lead,
      assignedRep: getLeadAssignedRepName(lead),
      leadScore: calculateLeadScore(lead),
    })
    await recordLeadCreatedAudit(saved)

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create lead' },
      { status: 400 }
    )
  }
}
