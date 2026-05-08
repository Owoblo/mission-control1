import { NextResponse } from 'next/server'
import { normalizeFollowUp, uid } from '@/lib/sales'
import { canAccessSalesWorkspace, canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, getSalesQuote, saveFollowUpLog, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import type { FollowUpLog } from '@/lib/types'

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as Partial<FollowUpLog> & { followUpDate?: string }
    if (!payload.type) {
      return NextResponse.json({ error: 'type is required' }, { status: 400 })
    }

    const targetLeadId =
      payload.leadId ||
      (payload.quoteId
        ? (await getSalesQuote(payload.quoteId))?.leadId
        : undefined)

    if (targetLeadId) {
      const currentLead = await getSalesLead(targetLeadId)
      if (!currentLead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }

      if (!canHandleLeadCommunications(session, currentLead)) {
        return NextResponse.json({ error: 'You do not have permission to log follow-ups on this lead.' }, { status: 403 })
      }
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

    if (targetLeadId && payload.followUpDate) {
      const currentLead = await getSalesLead(targetLeadId)
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
