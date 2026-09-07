import { NextResponse } from 'next/server'
import { uid } from '@/lib/sales'
import { normalizePhone } from '@/lib/sales-phones'
import type { CallLogEntry } from '@/lib/types'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getRequestSessionUser } from '@/lib/server/request-session'
import {
  getSalesLeadByContact,
  listSalesLeads,
  saveCrmCallSidMapping,
  saveSalesLead,
} from '@/lib/server/sales-repository'

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${seconds % 60}s`
}

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const leads = await listSalesLeads()
  const calls = leads
    .filter(lead => canHandleLeadCommunications(session, lead))
    .flatMap(lead => (lead.callLogs || []).map(call => ({
      id: call.id,
      leadId: lead.id,
      name: lead.name || call.phone || lead.phone || 'Customer',
      phone: normalizePhone(call.phone || lead.phone),
      date: call.date,
      direction: call.direction || 'outbound',
      duration: call.duration || (call.audioConnected ? 'completed' : 'no answer'),
      answered: call.audioConnected ?? call.callOutcome === 'completed',
      repName: call.repName || '',
      branchNumber: call.branchNumber || '',
      recordingAvailable: Boolean(call.recordingUrl || call.cloudflareUrl),
      transcriptAvailable: Boolean(call.transcript),
      notes: call.notes || '',
    })))
    .filter(call => Boolean(call.phone))
    .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')))
    .slice(0, 100)

  return NextResponse.json({ calls })
}

export async function POST(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session?.userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await request.json() as {
    phone?: string
    direction?: 'inbound' | 'outbound'
    durationSeconds?: number
    callSid?: string
    branchNumber?: string
    notes?: string
    answered?: boolean
    disposition?: string
    followUpDate?: string
  }
  const phone = normalizePhone(payload.phone)
  if (!phone) return NextResponse.json({ error: 'Phone is required' }, { status: 400 })

  const lead = await getSalesLeadByContact(phone, null, null, { includeClosed: true })
  if (!lead) return NextResponse.json({ ok: true, matched: false })
  if (!canHandleLeadCommunications(session, lead)) {
    return NextResponse.json({ error: 'You do not have access to this customer' }, { status: 403 })
  }

  const callSid = payload.callSid?.trim() || undefined
  const durationSeconds = Math.max(0, Math.floor(Number(payload.durationSeconds || 0)))
  const answered = payload.answered !== false && durationSeconds > 0
  const direction: CallLogEntry['direction'] = payload.direction === 'inbound' ? 'inbound' : 'outbound'
  const repTag = session.name ? ` · ${session.name}` : ''
  const userNotes = payload.notes?.trim()
  const disposition = payload.disposition?.trim().replace(/_/g, ' ')
  const summary = `${direction === 'inbound' ? 'Inbound call from' : 'Outbound call to'} ${phone} — ${answered ? formatDuration(durationSeconds) : 'no answer'}${repTag}.`
  const notes = [summary, disposition ? `Disposition: ${disposition}.` : '', userNotes ? `Rep notes: ${userNotes}` : '']
    .filter(Boolean)
    .join('\n')
  const existing = callSid
    ? (lead.callLogs || []).find(log => log.callSid === callSid)
    : undefined
  const logId = existing?.id || uid('cl')
  const callLog: CallLogEntry = {
    ...(existing || {}),
    id: logId,
    type: 'call' as const,
    notes,
    date: existing?.date || new Date().toISOString(),
    phone,
    branchNumber: payload.branchNumber || existing?.branchNumber,
    duration: answered ? formatDuration(durationSeconds) : 'no answer',
    durationSeconds: answered ? durationSeconds : undefined,
    callSid,
    direction,
    source: 'manual' as const,
    callOutcome: payload.disposition || (answered ? 'completed' : 'no_answer'),
    answeredBy: 'mobile' as const,
    audioConnected: answered,
    repId: session.userId,
    repName: session.name,
  }
  const callLogs = existing
    ? (lead.callLogs || []).map(log => log.id === existing.id ? callLog : log)
    : [callLog, ...(lead.callLogs || [])]
  const saved = await saveSalesLead({
    ...lead,
    stage: answered && (lead.stage === 'new' || lead.stage === 'nurture') ? 'contacted' : lead.stage,
    lastHumanOutboundAt: direction === 'outbound' && answered
      ? new Date().toISOString()
      : lead.lastHumanOutboundAt,
    ...(payload.disposition === 'follow_up' ? {
      followUpDate: /^\d{4}-\d{2}-\d{2}$/.test(payload.followUpDate || '')
        ? payload.followUpDate
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      followUpNote: userNotes || `Follow up after ${direction} call`,
      followUpStatus: 'pending' as const,
      assignedRepUserId: lead.assignedRepUserId || session.userId,
      assignedRepName: lead.assignedRepName || session.name,
      assignedRep: lead.assignedRep || session.name,
    } : {}),
    callLogs,
  })
  if (callSid) {
    await saveCrmCallSidMapping(callSid, saved.id, logId).catch(() => undefined)
  }

  return NextResponse.json({ ok: true, matched: true, leadId: saved.id })
}
