import { NextResponse } from 'next/server'
import { getSalesLead, saveCrmCallSidMapping, saveSalesLead } from '@/lib/server/sales-repository'
import { uid } from '@/lib/sales'
import type { CRMLead } from '@/lib/types'

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

function nextStage(current?: CRMLead['stage']): CRMLead['stage'] {
  if (!current || current === 'new' || current === 'nurture') return 'contacted'
  return current
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      leadId?: string
      phone?: string
      direction?: 'inbound' | 'outbound'
      durationSeconds?: number
      callSid?: string
      answered?: boolean
    }

    if (!payload.leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
    }

    const lead = await getSalesLead(payload.leadId)
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const durationSeconds = Math.max(0, Number(payload.durationSeconds || 0))
    const callLogId = uid('cl')
    const answered = payload.answered !== false && durationSeconds > 0
    const direction = payload.direction || 'outbound'
    const duration = answered ? formatDuration(durationSeconds) : 'no answer'
    const phone = payload.phone || lead.phone || ''
    const callSid = payload.callSid || undefined

    const notes =
      direction === 'inbound'
        ? `Inbound call ${phone ? `from ${phone} ` : ''}- ${duration}.${answered && callSid ? ' Recording processing…' : ''}`.replace(' -', ' —')
        : `Outbound call ${phone ? `to ${phone} ` : ''}- ${duration}.${answered && callSid ? ' Recording processing…' : ''}`.replace(' -', ' —')

    const nextLead: CRMLead = {
      ...lead,
      stage: answered ? nextStage(lead.stage) : lead.stage,
      callLogs: [
        {
          id: callLogId,
          type: 'call',
          notes,
          date: new Date().toISOString(),
          phone,
          duration,
          callSid,
        },
        ...(lead.callLogs || []),
      ],
    }

    const saved = await saveSalesLead(nextLead)

    if (callSid && answered) {
      try {
        await saveCrmCallSidMapping(callSid, saved.id, callLogId)
      } catch {
        // Mapping is best-effort so recording processing does not block call logging.
      }
    }

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log dialer call' },
      { status: 400 }
    )
  }
}
