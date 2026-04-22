import { NextResponse } from 'next/server'
import { canControlAutomation, canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const lead = await getSalesLead(params.id)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    if (!canControlAutomation(session, lead)) {
      return NextResponse.json({ error: 'You cannot change automation on a lead you do not own.' }, { status: 403 })
    }

    const body = (await request.json()) as {
      automationStatus?: 'idle' | 'active' | 'paused' | 'handoff' | 'do_not_contact'
      pauseHours?: number
      pauseUntil?: string | null
      pauseReason?: string | null
      handoffReason?: string | null
      clearPause?: boolean
    }

    const pauseUntil =
      body.clearPause
        ? undefined
        : body.pauseUntil === null
          ? undefined
          : body.pauseUntil || (body.pauseHours ? new Date(Date.now() + body.pauseHours * 60 * 60 * 1000).toISOString() : lead.automationPausedUntil)

    const next = await saveSalesLead({
      ...lead,
      automationStatus: body.automationStatus || lead.automationStatus || 'active',
      automationPausedUntil: pauseUntil,
      automationPauseReason:
        body.clearPause
          ? undefined
          : body.pauseReason === null
            ? undefined
            : body.pauseReason || lead.automationPauseReason,
      automationHandoffAt:
        body.automationStatus === 'handoff'
          ? new Date().toISOString()
          : body.automationStatus
            ? undefined
            : lead.automationHandoffAt,
      automationHandoffReason:
        body.automationStatus === 'handoff'
          ? body.handoffReason || lead.automationHandoffReason
          : body.automationStatus
            ? undefined
            : lead.automationHandoffReason,
    })

    return NextResponse.json(next)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update automation state' },
      { status: 400 }
    )
  }
}
