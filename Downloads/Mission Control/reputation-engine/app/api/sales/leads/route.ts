import { NextResponse } from 'next/server'
import { calculateLeadScore, normalizeLead, uid } from '@/lib/sales'
import { saveSalesLead } from '@/lib/server/sales-repository'
import { validateLeadPayload } from '@/lib/server/sales-validation'
import type { CRMLead } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<CRMLead>
    const validated = validateLeadPayload(payload)

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

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create lead' },
      { status: 400 }
    )
  }
}
