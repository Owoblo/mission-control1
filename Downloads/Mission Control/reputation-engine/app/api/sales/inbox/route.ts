import { NextResponse } from 'next/server'
import { calculateLeadScore, normalizeLead, uid } from '@/lib/sales'
import {
  getInboundLead,
  getSalesLeadByInboundId,
  listInboundJunkLeads,
  listInboundLeads,
  listSalesLeads,
  markInboundLeadClaimed,
  markInboundLeadJunk,
  restoreInboundLead,
  saveCrmCallSidMapping,
  saveSalesLead,
} from '@/lib/server/sales-repository'
import { validateLeadPayload } from '@/lib/server/sales-validation'
import type { CallLogEntry, CRMLead, InboundLead } from '@/lib/types'

function parseRawData(value: InboundLead['raw_data']) {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as Record<string, unknown>
    } catch {
      return null
    }
  }
  return value
}

function buildInboundCallLog(item: InboundLead) {
  const raw = parseRawData(item.raw_data)
  const recordingDuration = Number(raw?.recordingDuration || raw?.duration || 0)
  const aiSummary =
    raw?.aiSummary && typeof raw.aiSummary === 'object'
      ? (raw.aiSummary as CallLogEntry['aiSummary'])
      : undefined

  return {
    id: uid('cl'),
    type:
      item.source === 'twilio_call'
        ? 'call'
        : item.source === 'twilio_sms'
          ? 'sms'
          : item.source === 'email'
            ? 'email'
            : 'note',
    notes: item.message?.trim() || 'Inbound lead created from queue',
    date: item.created_at || new Date().toISOString(),
    phone: item.phone,
    callSid: typeof raw?.callSid === 'string' ? raw.callSid : undefined,
    recordingUrl: typeof raw?.recordingUrl === 'string' ? raw.recordingUrl : undefined,
    recordingSid: typeof raw?.recordingSid === 'string' ? raw.recordingSid : undefined,
    recordingDuration: Number.isFinite(recordingDuration) && recordingDuration > 0 ? recordingDuration : undefined,
    transcript: typeof raw?.transcript === 'string' ? raw.transcript : undefined,
    aiSummary,
  }
}

async function ensureInboundCallMapping(item: InboundLead, lead?: CRMLead) {
  if (!lead?.id || !lead.callLogs?.length) return
  const raw = parseRawData(item.raw_data)
  const callSid = typeof raw?.callSid === 'string' ? raw.callSid : undefined
  if (!callSid) return
  const callLog =
    lead.callLogs.find(entry => entry.callSid === callSid) ||
    lead.callLogs.find(entry => entry.type === 'call')
  if (!callLog?.id) return
  try {
    await saveCrmCallSidMapping(callSid, lead.id, callLog.id)
  } catch {
    // Mapping is best-effort; inbox hydration should not fail on duplicate or missing mapping writes.
  }
}

function getLatestCallIntelligence(lead?: CRMLead) {
  if (!lead?.callLogs?.length) return null
  const sorted = [...lead.callLogs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    sorted.find(entry => entry.recordingUrl || entry.transcript || entry.aiSummary) ||
    sorted.find(entry => entry.type === 'call' || entry.type === 'sms' || entry.type === 'email') ||
    null
  )
}

function mergeInboxRawData(item: InboundLead, lead?: CRMLead): InboundLead['raw_data'] {
  const raw = parseRawData(item.raw_data) || {}
  const latestCall = getLatestCallIntelligence(lead)

  return {
    ...raw,
    originCity: (raw.originCity as string | undefined) || lead?.originCity || '',
    destCity: (raw.destCity as string | undefined) || lead?.destCity || '',
    originAddress: (raw.originAddress as string | undefined) || lead?.originAddress || '',
    estimatedCubicFeet: (raw.estimatedCubicFeet as number | undefined) || lead?.totalCubicFeet || 0,
    moveSize: (raw.moveSize as string | undefined) || lead?.moveType || '',
    recordingUrl: (raw.recordingUrl as string | undefined) || latestCall?.recordingUrl || '',
    recordingSid: (raw.recordingSid as string | undefined) || latestCall?.recordingSid || '',
    transcript: (raw.transcript as string | undefined) || latestCall?.transcript || '',
    aiSummary: raw.aiSummary || latestCall?.aiSummary || undefined,
    lastCallAt: latestCall?.date || undefined,
  }
}

function inferStageFromInbound(item: InboundLead) {
  const raw = parseRawData(item.raw_data)
  const aiSummary = raw?.aiSummary && typeof raw.aiSummary === 'object'
    ? raw.aiSummary as CallLogEntry['aiSummary']
    : undefined

  if (aiSummary?.moveReadiness === 'cold') return 'nurture' as const
  if (aiSummary?.moveReadiness === 'hot') return 'contacted' as const
  if (typeof raw?.transcript === 'string' && raw.transcript.trim()) return 'contacted' as const
  return 'new' as const
}

function inferFollowUp(item: InboundLead) {
  const raw = parseRawData(item.raw_data)
  const aiSummary = raw?.aiSummary && typeof raw.aiSummary === 'object'
    ? raw.aiSummary as CallLogEntry['aiSummary']
    : undefined

  const days = Number(aiSummary?.followUpDays || 0)
  if (!Number.isFinite(days) || days <= 0) {
    return { followUpDate: undefined, followUpNote: aiSummary?.followUpReason || undefined }
  }

  const date = new Date()
  date.setDate(date.getDate() + days)
  return {
    followUpDate: date.toISOString().slice(0, 10),
    followUpNote: aiSummary?.followUpReason || undefined,
  }
}

function ensureLeadForInbound(item: InboundLead, existingLeadIdsByInboundId: Map<string, string>) {
  const existing = existingLeadIdsByInboundId.get(item.id)
  return { ...item, linkedLeadId: existing }
}

export async function GET(request: Request) {
  try {
    const mode = new URL(request.url).searchParams.get('mode')
    const [items, leads] = await Promise.all([mode === 'junk' ? listInboundJunkLeads() : listInboundLeads(), listSalesLeads()])
    const existingLeadIdsByInboundId = new Map(
      leads.filter(lead => lead.inboundId).map(lead => [lead.inboundId as string, lead.id])
    )
    const leadByInboundId = new Map(
      leads.filter(lead => lead.inboundId).map(lead => [lead.inboundId as string, lead])
    )

    const hydrated =
      mode === 'junk'
        ? items.map(item => ({
            ...item,
            name: item.name || leadByInboundId.get(item.id)?.name || 'New Caller',
            linkedLeadId: existingLeadIdsByInboundId.get(item.id),
            raw_data: mergeInboxRawData(item, leadByInboundId.get(item.id)),
          }))
        : items.map(item => {
            const ensured = ensureLeadForInbound(item, existingLeadIdsByInboundId)
            const linkedLead = leadByInboundId.get(item.id) || leads.find(lead => lead.id === ensured.linkedLeadId)
            return {
              ...ensured,
              name:
                ensured.name ||
                linkedLead?.name ||
                (ensured.source === 'twilio_call' ? 'New Caller' : ensured.source === 'twilio_sms' ? 'New Contact' : 'New Lead'),
              raw_data: mergeInboxRawData(ensured, linkedLead),
            }
          })
    return NextResponse.json(hydrated)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load inbox' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      inboundId?: string
      name?: string
      phone?: string
      email?: string
      source?: string
      stage?: CRMLead['stage']
      moveType?: CRMLead['moveType']
      notes?: string
    }

    if (!payload.inboundId || !payload.name?.trim()) {
      return NextResponse.json({ error: 'inboundId and name are required' }, { status: 400 })
    }

    const existingLead = await getSalesLeadByInboundId(payload.inboundId)
    if (existingLead) {
      await markInboundLeadClaimed(payload.inboundId)
      return NextResponse.json(existingLead)
    }

    const inbound = await getInboundLead(payload.inboundId)
    if (!inbound) {
      return NextResponse.json({ error: 'Inbound lead not found' }, { status: 404 })
    }

    const validated = validateLeadPayload({
      name: payload.name,
      phone: payload.phone || inbound.phone,
      email: payload.email || inbound.email,
      moveType: payload.moveType || 'residential',
    })

    const lead = normalizeLead({
      id: uid('lead'),
      name: payload.name.trim(),
      inboundId: payload.inboundId,
      inboundMessage: inbound.message?.trim() || payload.notes?.trim() || '',
      phone: validated.phone || inbound.phone || undefined,
      email: validated.email || inbound.email || undefined,
      source: payload.source || inbound.source || 'other',
      stage: payload.stage || inferStageFromInbound(inbound),
      moveType: validated.moveType || 'residential',
      moveDate: '',
      originAddress: '',
      originCity: '',
      destCity: '',
      moveReason: '',
      notes: payload.notes?.trim() || inbound.message?.trim() || '',
      ...inferFollowUp(inbound),
      directMailAttributed: false,
      inventory: [],
      totalItems: 0,
      totalCubicFeet: 0,
      roomBreakdown: {},
      callLogs: [buildInboundCallLog(inbound)],
      createdAt: new Date(inbound.created_at || Date.now()).toISOString().slice(0, 10),
      leadScore: 0,
    })

    const savedLead = await saveSalesLead({
      ...lead,
      leadScore: calculateLeadScore(lead),
    })
    await ensureInboundCallMapping(inbound, savedLead)
    await markInboundLeadClaimed(payload.inboundId)

    return NextResponse.json(savedLead)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to claim inbound lead' },
      { status: 400 }
    )
  }
}

export async function PATCH(request: Request) {
  try {
    const payload = (await request.json()) as { inboundId?: string; action?: 'junk' | 'restore' }
    if (!payload.inboundId || !payload.action) {
      return NextResponse.json({ error: 'inboundId and action are required' }, { status: 400 })
    }

    if (payload.action === 'junk') {
      await markInboundLeadJunk(payload.inboundId)
    } else if (payload.action === 'restore') {
      await restoreInboundLead(payload.inboundId)
    } else {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update inbound lead' },
      { status: 400 }
    )
  }
}
