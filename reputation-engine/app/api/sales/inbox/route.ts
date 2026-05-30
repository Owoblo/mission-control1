import { NextResponse } from 'next/server'
import { buildInboundQueueSummary, decorateInboundLead } from '@/lib/inbound-inbox'
import { calculateLeadScore, normalizeLead, uid } from '@/lib/sales'
import {
  getSalesBranchFromSaturnLabel,
  getSalesBranchFromSaturnPhone,
  getSaturnBranchLabel,
  getSaturnBranchNumberFromRawData,
  getSaturnTrackingLabel,
  getSaturnTrackingSource,
} from '@/lib/sales-phones'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'
import { recordLeadCreatedAudit, recordLeadUpdateAudit } from '@/lib/server/sales-audit'
import { findMatchingActiveLead } from '@/lib/server/lead-identity'
import { getInboxChannelForInboundSource } from '@/lib/server/inbox-state'
import {
  collapseDuplicateSalesLeadsByIdentity,
  getInboundLead,
  getSalesLead,
  getSalesLeadByInboundId,
  listAllInboundLeads,
  listSalesLeadInboxSnapshots,
  markInboundLeadClaimed,
  markLeadInboxChannelActioned,
  restoreInboundLead,
  saveCrmCallSidMapping,
  setInboundLeadDisposition,
  setInboundLeadHandoff,
  saveSalesLead,
} from '@/lib/server/sales-repository'
import { getSessionUser } from '@/lib/server/session'
import { validateLeadPayload } from '@/lib/server/sales-validation'
import type { CallLogEntry, CRMLead, InboundLead } from '@/lib/types'

type InboxLeadContext = Pick<
  CRMLead,
  'id' | 'name' | 'stage' | 'phone' | 'email' | 'branch' | 'originAddress' | 'originCity' | 'destAddress' | 'destCity' | 'moveType' | 'totalCubicFeet' | 'callLogs'
>

const HEALTH_PROBE_SMS_DIGITS = '15550001111'

function hasUsableInboundName(value?: string | null) {
  const normalized = (value || '').trim().toLowerCase()
  if (!normalized) return false
  if (/^unknown\b/.test(normalized)) return false
  return !['new caller', 'new contact', 'new lead', 'new inquiry', 'caller', 'contact'].includes(normalized)
}

function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

function isInternalHealthProbeInbound(item: InboundLead) {
  if (item.source === 'health_check_form') return true
  if (digitsOnly(item.phone) === HEALTH_PROBE_SMS_DIGITS) return true
  if ((item.email || '').toLowerCase().includes('system.invalid')) return true
  if ((item.message || '').toLowerCase().includes('lead flow health')) return true
  return false
}


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
  const branchNumber = getSaturnBranchNumberFromRawData(raw)
  const recordingDuration = Number(raw?.recordingDuration || raw?.duration || 0)
  const aiSummary =
    raw?.aiSummary && typeof raw.aiSummary === 'object'
      ? (raw.aiSummary as CallLogEntry['aiSummary'])
      : undefined
  const direction: CallLogEntry['direction'] = item.source === 'twilio_call' ? 'inbound' : undefined
  const source: CallLogEntry['source'] =
    item.source === 'twilio_call'
      ? (typeof raw?.recordingUrl === 'string' || typeof raw?.transcript === 'string' || typeof raw?.recordingSid === 'string'
          ? 'manual'
          : 'inbound')
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
    branchNumber: branchNumber || undefined,
    direction,
    callSid: typeof raw?.callSid === 'string' ? raw.callSid : undefined,
    recordingUrl: typeof raw?.recordingUrl === 'string' ? raw.recordingUrl : undefined,
    recordingSid: typeof raw?.recordingSid === 'string' ? raw.recordingSid : undefined,
    recordingDuration: Number.isFinite(recordingDuration) && recordingDuration > 0 ? recordingDuration : undefined,
    transcript: typeof raw?.transcript === 'string' ? raw.transcript : undefined,
    source,
    aiSummary,
  }
}

function inferLeadBranchFromInbound(item: InboundLead) {
  const raw = parseRawData(item.raw_data)
  return (
    getSalesBranchFromSaturnPhone(getSaturnBranchNumberFromRawData(raw)) ||
    getSalesBranchFromSaturnLabel(typeof raw?.branchCity === 'string' ? raw.branchCity : '')
  )
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

function getLatestCallIntelligence(lead?: InboxLeadContext) {
  if (!lead?.callLogs?.length) return null
  const sorted = [...lead.callLogs].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
  return (
    sorted.find(entry => entry.recordingUrl || entry.transcript || entry.aiSummary) ||
    sorted.find(entry => entry.type === 'call' || entry.type === 'sms' || entry.type === 'email') ||
    null
  )
}

function mergeInboxRawData(item: InboundLead, lead?: InboxLeadContext): InboundLead['raw_data'] {
  const raw = parseRawData(item.raw_data) || {}
  const latestCall = getLatestCallIntelligence(lead)
  const branchNumber =
    getSaturnBranchNumberFromRawData(raw) ||
    (typeof latestCall?.branchNumber === 'string' ? latestCall.branchNumber : null) ||
    null

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
    branchNumber: branchNumber || undefined,
    branchLabel:
      (typeof raw.branchLabel === 'string' && raw.branchLabel) ||
      getSaturnBranchLabel(branchNumber) ||
      (typeof raw.branchCity === 'string' ? raw.branchCity : '') ||
      undefined,
    trackingLabel:
      (typeof raw.trackingLabel === 'string' && raw.trackingLabel) ||
      getSaturnTrackingLabel(branchNumber) ||
      undefined,
    trackingSource:
      (typeof raw.trackingSource === 'string' && raw.trackingSource) ||
      getSaturnTrackingSource(branchNumber) ||
      undefined,
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
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [allItems, leads] = await Promise.all([
      listAllInboundLeads(),
      listSalesLeadInboxSnapshots(),
    ])
    const items = allItems.filter(item => !isInternalHealthProbeInbound(item))
    const existingLeadIdsByInboundId = new Map(
      leads.filter(lead => lead.inboundId).map(lead => [lead.inboundId as string, lead.id])
    )
    const leadByInboundId = new Map(
      leads.filter(lead => lead.inboundId).map(lead => [lead.inboundId as string, lead])
    )

    const hydrated = items.map(item => {
      const ensured = ensureLeadForInbound(item, existingLeadIdsByInboundId)
      const linkedLead = leadByInboundId.get(item.id) || leads.find(lead => lead.id === ensured.linkedLeadId)
      const matchedLead = linkedLead || findMatchingActiveLead(leads, ensured.phone, ensured.email)
      const fallbackName =
        matchedLead?.name ||
        (ensured.source === 'twilio_call' ? 'New Caller' : ensured.source === 'twilio_sms' ? 'New Contact' : 'New Lead')
      return decorateInboundLead({
        ...ensured,
        matchedLeadId: matchedLead?.id,
        matchedLeadName: matchedLead?.name,
        matchedLeadStage: matchedLead?.stage,
        name:
          hasUsableInboundName(ensured.name)
            ? ensured.name
            : fallbackName,
        raw_data: mergeInboxRawData(ensured, matchedLead || linkedLead || undefined),
      })
    })

    return NextResponse.json({
      items: hydrated,
      summary: buildInboundQueueSummary(hydrated),
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load inbox' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date().toISOString()
    const claimerName = session?.name?.trim()
    const claimerUserId = session?.userId || undefined
    const actor = { userId: claimerUserId, name: claimerName }
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
      await markInboundLeadClaimed(payload.inboundId, actor)
      await markLeadInboxChannelActioned(existingLead.id, getInboxChannelForInboundSource(existingLead.source), actor).catch(() => {})
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
    const duplicateLead = await collapseDuplicateSalesLeadsByIdentity({
      phone: validated.phone || inbound.phone,
      email: validated.email || inbound.email,
      inboundId: payload.inboundId,
    }, actor)

    if (duplicateLead) {
      const inboundCallLog = buildInboundCallLog(inbound)
      const claimChangesOwner =
        !!claimerName &&
        (
          (duplicateLead.assignedRepUserId || '') !== (claimerUserId || '') ||
          (duplicateLead.assignedRepName || duplicateLead.assignedRep || '') !== claimerName
        )
      const hasMatchingCallLog = duplicateLead.callLogs?.some(entry => {
        if (inboundCallLog.callSid && entry.callSid === inboundCallLog.callSid) {
          return true
        }
        return entry.date === inboundCallLog.date && entry.notes === inboundCallLog.notes
      })

      const mergedLead = normalizeLead({
        ...duplicateLead,
        name: duplicateLead.name || payload.name.trim(),
        inboundId: duplicateLead.inboundId || payload.inboundId,
        inboundMessage: duplicateLead.inboundMessage || inbound.message?.trim() || payload.notes?.trim() || '',
        phone: duplicateLead.phone || validated.phone || inbound.phone || undefined,
        email: duplicateLead.email || validated.email || inbound.email || undefined,
        source: duplicateLead.source || payload.source || inbound.source || 'other',
        moveType: duplicateLead.moveType || validated.moveType || 'residential',
        branch: duplicateLead.branch || inferLeadBranchFromInbound(inbound),
        notes: duplicateLead.notes || payload.notes?.trim() || inbound.message?.trim() || '',
        followUpDate: duplicateLead.followUpDate || inferFollowUp(inbound).followUpDate,
        assignedRep: claimerName || duplicateLead.assignedRep,
        assignedRepName: claimerName || duplicateLead.assignedRepName || duplicateLead.assignedRep,
        assignedRepUserId: claimerUserId || duplicateLead.assignedRepUserId,
        leadOwnerStatus: claimerName
          ? (claimChangesOwner ? (duplicateLead.assignedRep ? 'reassigned' : 'assigned') : duplicateLead.leadOwnerStatus)
          : duplicateLead.leadOwnerStatus,
        ownedAt: claimerName ? (claimChangesOwner ? now : duplicateLead.ownedAt) : duplicateLead.ownedAt,
        lastTouchedAt: now,
        lastTouchedByUserId: claimerUserId || duplicateLead.lastTouchedByUserId,
        lastTouchedByName: claimerName || duplicateLead.lastTouchedByName,
        callLogs: hasMatchingCallLog ? duplicateLead.callLogs || [] : [...(duplicateLead.callLogs || []), inboundCallLog],
      })

      const savedLead = await saveSalesLead({
        ...mergedLead,
        leadScore: calculateLeadScore(mergedLead),
      })
      await recordLeadUpdateAudit(duplicateLead, savedLead)
      await ensureInboundCallMapping(inbound, savedLead)
      await markInboundLeadClaimed(payload.inboundId, actor)
      await markLeadInboxChannelActioned(savedLead.id, getInboxChannelForInboundSource(inbound.source), actor).catch(() => {})

      return NextResponse.json(savedLead)
    }

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
      branch: inferLeadBranchFromInbound(inbound),
      moveDate: (parseRawData(inbound.raw_data)?.moveDate as string) || '',
      originAddress: (parseRawData(inbound.raw_data)?.originAddress as string) || '',
      originCity: (parseRawData(inbound.raw_data)?.originCity as string) || '',
      destCity: (parseRawData(inbound.raw_data)?.destCity as string) || '',
      moveReason: '',
      notes: payload.notes?.trim() || inbound.message?.trim() || '',
      ...inferFollowUp(inbound),
      assignedRep: claimerName,
      assignedRepName: claimerName,
      assignedRepUserId: claimerUserId,
      leadOwnerStatus: claimerName ? 'assigned' : 'unassigned',
      ownedAt: claimerName ? now : undefined,
      lastTouchedAt: now,
      lastTouchedByUserId: claimerUserId,
      lastTouchedByName: claimerName,
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
    await recordLeadCreatedAudit(savedLead)
    await ensureInboundCallMapping(inbound, savedLead)
    await markInboundLeadClaimed(payload.inboundId, actor)
    await markLeadInboxChannelActioned(savedLead.id, getInboxChannelForInboundSource(inbound.source), actor).catch(() => {})

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
    const session = await getSessionUser()
    if (!canAccessSalesWorkspace(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const payload = (await request.json()) as { inboundId?: string; action?: 'junk' | 'lost' | 'not_interested' | 'restore' | 'handoff' }
    if (!payload.inboundId || !payload.action) {
      return NextResponse.json({ error: 'inboundId and action are required' }, { status: 400 })
    }

    const actor = { userId: session?.userId, name: session?.name?.trim() }
    const inbound = await getInboundLead(payload.inboundId)
    const linkedLead = inbound?.linkedLeadId
      ? await getSalesLead(inbound.linkedLeadId).catch(() => null)
      : payload.action === 'restore'
        ? null
        : await getSalesLeadByInboundId(payload.inboundId).catch(() => null)
    const channel = getInboxChannelForInboundSource(inbound?.source)

    if (payload.action === 'junk') {
      await setInboundLeadDisposition(payload.inboundId, 'junk', actor)
    } else if (payload.action === 'lost') {
      await setInboundLeadDisposition(payload.inboundId, 'lost', actor)
    } else if (payload.action === 'not_interested') {
      await setInboundLeadDisposition(payload.inboundId, 'not_interested', actor)
    } else if (payload.action === 'restore') {
      await restoreInboundLead(payload.inboundId)
    } else if (payload.action === 'handoff') {
      await setInboundLeadHandoff(payload.inboundId, actor)
    } else {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }

    if (linkedLead && payload.action !== 'restore') {
      await markLeadInboxChannelActioned(linkedLead.id, channel, actor).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update inbound lead' },
      { status: 400 }
    )
  }
}
