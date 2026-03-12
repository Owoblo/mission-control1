import { NextResponse } from 'next/server'
import { normalizeFollowUp, uid } from '@/lib/sales'
import { getSalesLead, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import type { FollowUpLog } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as Partial<FollowUpLog> & { followUpDate?: string }
    if (!payload.type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 })
    }

    const log = normalizeFollowUp({
      id: payload.id || uid('fu'),
      quoteId: payload.quoteId,
      leadId: payload.leadId,
      type: payload.type,
      date: payload.date || new Date().toISOString(),
      createdAt: payload.createdAt || new Date().toISOString(),
      notes: payload.notes,
    })

    const savedLog = await saveFollowUpLog(log)
    let lead = null

    if (payload.leadId && payload.followUpDate) {
      const currentLead = await getSalesLead(payload.leadId)
      if (currentLead) {
        lead = await saveSalesLead({
          ...currentLead,
          followUpDate: payload.followUpDate,
        })
      }
    }

    return NextResponse.json({ log: savedLog, lead })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save follow-up log' },
      { status: 400 }
    )
  }
}
