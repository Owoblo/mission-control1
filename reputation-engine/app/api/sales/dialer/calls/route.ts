import { NextResponse } from 'next/server'
import { getSalesLead, saveCrmCallSidMapping, saveSalesLead, setInboundLeadHandoff, updateLeadCallLogEntry } from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { logTelephonyCallOutcome } from '@/lib/server/telephony-monitoring'
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
      branchNumber?: string
      direction?: 'inbound' | 'outbound'
      durationSeconds?: number
      callSid?: string
      answered?: boolean
      callOutcome?: string
      answeredBy?: 'browser' | 'mobile' | 'sip' | 'unknown'
      audioConnected?: boolean
      errorCode?: number | null
      errorMessage?: string | null
      failureReason?: string | null
    }

    const sessionUser = await getSessionUser()

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
    const callOutcome =
      payload.callOutcome ||
      (answered ? 'completed' : payload.failureReason === 'failed_media_connection' ? 'failed_media_connection' : 'no_answer')
    const duration = answered ? formatDuration(durationSeconds) : callOutcome.replaceAll('_', ' ')
    const phone = payload.phone || lead.phone || ''
    const branchNumber = payload.branchNumber || undefined
    const callSid = payload.callSid || undefined
    const now = new Date().toISOString()
    const audioConnected = typeof payload.audioConnected === 'boolean' ? payload.audioConnected : answered

    const repTag = sessionUser?.name ? ` · ${sessionUser.name}` : ''
    const notes =
      direction === 'inbound'
        ? `Inbound call ${phone ? `from ${phone} ` : ''}- ${duration}${repTag}.${answered && callSid ? ' Recording processing…' : ''}`.replace(' -', ' —')
        : `Outbound call ${phone ? `to ${phone} ` : ''}- ${duration}${repTag}.${answered && callSid ? ' Recording processing…' : ''}`.replace(' -', ' —')

    const existingLog = callSid
      ? (lead.callLogs || []).find(entry => entry.callSid === callSid)
      : null

    if (existingLog) {
      const updated = await updateLeadCallLogEntry(lead.id, existingLog.id, {
        notes,
        phone,
        branchNumber,
        duration,
        durationSeconds: answered ? durationSeconds : undefined,
        direction,
        source: 'manual',
        callOutcome,
        answeredBy: payload.answeredBy || 'browser',
        audioConnected,
        errorCode: payload.errorCode ?? undefined,
        errorMessage: payload.errorMessage || undefined,
        failureReason: payload.failureReason || undefined,
        repId: sessionUser?.userId || undefined,
        repName: sessionUser?.name || undefined,
      } as any)

      void logTelephonyCallOutcome({
        leadId: updated.id,
        repId: sessionUser?.userId || null,
        timestamp: now,
        properties: {
          callSid,
          phoneNumber: phone,
          sourceNumber: branchNumber || null,
          branchNumber: branchNumber || null,
          direction,
          outcome: callOutcome,
          answered,
          failed: !answered,
          missed: !answered,
          answerChannel: payload.answeredBy || 'browser',
          audioConnected,
          durationSeconds,
          errorCode: payload.errorCode ?? null,
          errorMessage: payload.errorMessage || null,
          failureReason: payload.failureReason || null,
          repName: sessionUser?.name || null,
        },
      })

      if (callSid) {
        try {
          await saveCrmCallSidMapping(callSid, updated.id, existingLog.id)
        } catch {
          // Mapping is best-effort so recording processing does not block call logging.
        }
      }

      return NextResponse.json(updated)
    }

    const nextLead: CRMLead = {
      ...lead,
      stage: answered ? nextStage(lead.stage) : lead.stage,
      lastHumanOutboundAt: direction === 'outbound' && answered ? now : lead.lastHumanOutboundAt,
      callLogs: [
        {
          id: callLogId,
          type: 'call',
          notes,
          date: now,
          phone,
          branchNumber,
          duration,
          durationSeconds: answered ? durationSeconds : undefined,
          callSid,
          direction,
          source: 'manual',
          callOutcome,
          answeredBy: payload.answeredBy || 'browser',
          audioConnected,
          errorCode: payload.errorCode ?? undefined,
          errorMessage: payload.errorMessage || undefined,
          failureReason: payload.failureReason || undefined,
          repId: sessionUser?.userId || undefined,
          repName: sessionUser?.name || undefined,
        },
        ...(lead.callLogs || []),
      ],
    }

    const saved = await saveSalesLead(nextLead)

    void logTelephonyCallOutcome({
      leadId: saved.id,
      repId: sessionUser?.userId || null,
      timestamp: now,
      properties: {
        callSid,
        phoneNumber: phone,
        sourceNumber: branchNumber || null,
        branchNumber: branchNumber || null,
        direction,
        outcome: callOutcome,
        answered,
        failed: !answered,
        missed: !answered,
        answerChannel: payload.answeredBy || 'browser',
        audioConnected,
        durationSeconds,
        errorCode: payload.errorCode ?? null,
        errorMessage: payload.errorMessage || null,
        failureReason: payload.failureReason || null,
        repName: sessionUser?.name || null,
      },
    })

    if (callSid) {
      try {
        await saveCrmCallSidMapping(callSid, saved.id, callLogId)
      } catch {
        // Mapping is best-effort so recording processing does not block call logging.
      }
    }

    // Auto-clear from inbox when rep makes an outbound call
    if (direction === 'outbound' && saved.inboundId) {
      void setInboundLeadHandoff(saved.inboundId).catch(() => {})
    }

    return NextResponse.json(saved)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to log dialer call' },
      { status: 400 }
    )
  }
}
