import { NextResponse } from 'next/server'
import { calculateLeadScore, normalizeLead, uid } from '@/lib/sales'
import { recordLeadCreatedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { listSalesLeads, saveSalesLead } from '@/lib/server/sales-repository'
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
    const payload = (await request.json()) as Partial<CRMLead>
    const validated = validateLeadPayload(payload)
    const existingLead = findMatchingActiveLead(await listSalesLeads(), validated.phone, validated.email)

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
      })

      const saved = await saveSalesLead({
        ...mergedLead,
        leadScore: calculateLeadScore(mergedLead),
      })
      await recordLeadUpdateAudit(existingLead, saved)
      return NextResponse.json(saved)
    }

    const lead = normalizeLead({
      id: payload.id || uid('lead'),
      name: validated.name,
      stage: payload.stage || 'new',
      source: payload.source || 'other',
      inboundId: payload.inboundId,
      inboundMessage: payload.inboundMessage?.trim(),
      phone: validated.phone,
      email: validated.email,
      moveDate: payload.moveDate,
      moveType: validated.moveType || 'residential',
      originAddress: payload.originAddress?.trim(),
      originCity: payload.originCity?.trim(),
      destCity: payload.destCity?.trim(),
      supabaseListing: payload.supabaseListing || null,
      moveReason: payload.moveReason?.trim(),
      notes: payload.notes?.trim(),
      followUpDate: payload.followUpDate,
      quoteId: payload.quoteId,
      directMailAttributed: payload.directMailAttributed || false,
      inventory: payload.inventory || [],
      totalItems: payload.totalItems || 0,
      totalCubicFeet: payload.totalCubicFeet || 0,
      totalWeightLbs: payload.totalWeightLbs || 0,
      roomBreakdown: payload.roomBreakdown || {},
      callLogs: payload.callLogs || [],
      createdAt: payload.createdAt || new Date().toISOString().slice(0, 10),
      leadScore: 0,
    })

    const saved = await saveSalesLead({
      ...lead,
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
