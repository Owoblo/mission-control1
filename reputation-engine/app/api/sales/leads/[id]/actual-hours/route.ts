import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { getSalesLead, saveSalesLead, saveFollowUpLog } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSessionUser()
    if (!session) return new Response('Unauthorized', { status: 401 })

    const { id } = await params
    const body = (await request.json()) as {
      actualHours: number
      actualHoursNote?: string
    }

    if (!body.actualHours || body.actualHours <= 0) {
      return NextResponse.json({ error: 'actualHours must be a positive number' }, { status: 400 })
    }

    const lead = await getSalesLead(id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const now = new Date().toISOString()

    const updated = await saveSalesLead({
      ...lead,
      actualHours: body.actualHours,
      actualHoursNote: body.actualHoursNote,
      actualHoursLoggedAt: now,
      actualHoursLoggedBy: session.name || session.userId || 'unknown',
    })

    await saveFollowUpLog({
      id: uid('fu'),
      leadId: id,
      type: 'note',
      date: now,
      createdAt: now,
      notes: `Actual hours logged: ${body.actualHours}h${body.actualHoursNote ? ` — ${body.actualHoursNote}` : ''} (by ${session.name || 'crew lead'})`,
    })

    return NextResponse.json({ ok: true, lead: updated })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to log actual hours' },
      { status: 500 }
    )
  }
}
