import type {
  CRMEmail,
  CRMLead,
  InboxChannelState,
  InboundLead,
  LeadInboxChannel,
  LeadInboxState,
} from '@/lib/types'
import { parseInboundRawData } from '@/lib/inbound-inbox'

type ActorMeta = {
  userId?: string | null
  name?: string | null
}

function normalizeActor(actor?: ActorMeta) {
  const userId = actor?.userId?.trim() || undefined
  const name = actor?.name?.trim() || undefined
  return { userId, name }
}

function mergeChannelState(
  current: InboxChannelState | undefined,
  patch: Partial<InboxChannelState>
): InboxChannelState {
  return {
    ...current,
    ...patch,
  }
}

function applyChannelReadState(
  current: InboxChannelState | undefined,
  actor: ActorMeta | undefined,
  at: string
) {
  const normalizedActor = normalizeActor(actor)
  return mergeChannelState(current, {
    lastReadAt: at,
    lastReadByUserId: normalizedActor.userId,
    lastReadByName: normalizedActor.name,
  })
}

function applyChannelActionState(
  current: InboxChannelState | undefined,
  actor: ActorMeta | undefined,
  at: string
) {
  const normalizedActor = normalizeActor(actor)
  return mergeChannelState(
    applyChannelReadState(current, actor, at),
    {
      lastActionAt: at,
      lastActionByUserId: normalizedActor.userId,
      lastActionByName: normalizedActor.name,
    }
  )
}

function mergeLeadInboxState(
  current: LeadInboxState | undefined,
  channel: LeadInboxChannel,
  nextState: InboxChannelState
): LeadInboxState {
  return {
    ...(current || {}),
    [channel]: nextState,
  }
}

function maxIsoDate(...values: Array<string | undefined | null>) {
  return values
    .filter((value): value is string => !!value)
    .sort()
    .pop()
}

export function getInboxChannelForInboundSource(source?: string | null): LeadInboxChannel {
  if (source === 'twilio_sms') return 'sms'
  if (source === 'email') return 'email'
  if (source === 'twilio_call' || source === 'missed_call') return 'calls'
  return 'webforms'
}

export function getLeadInboxChannelState(lead: Pick<CRMLead, 'inboxState'> | null | undefined, channel: LeadInboxChannel) {
  return lead?.inboxState?.[channel]
}

export function applyLeadInboxReadState(lead: CRMLead, channel: LeadInboxChannel, actor?: ActorMeta, at = new Date().toISOString()) {
  const current = getLeadInboxChannelState(lead, channel)
  return {
    ...lead,
    inboxState: mergeLeadInboxState(lead.inboxState, channel, applyChannelReadState(current, actor, at)),
  }
}

export function applyLeadInboxActionState(lead: CRMLead, channel: LeadInboxChannel, actor?: ActorMeta, at = new Date().toISOString()) {
  const current = getLeadInboxChannelState(lead, channel)
  return {
    ...lead,
    inboxState: mergeLeadInboxState(lead.inboxState, channel, applyChannelActionState(current, actor, at)),
  }
}

export function getInboundLeadLatestActivityAt(item: InboundLead, rawInput?: Record<string, unknown> | null) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const smsThread = Array.isArray(raw?.smsThread) ? raw.smsThread as Array<Record<string, unknown>> : []
  const smsThreadLatest = smsThread
    .map(entry => (typeof entry.at === 'string' ? entry.at : undefined))
    .filter((value): value is string => !!value)
    .sort()
    .pop()
  return maxIsoDate(smsThreadLatest, item.created_at) || item.created_at
}

export function getInboundInboxChannelState(item: InboundLead, rawInput?: Record<string, unknown> | null, explicitChannel?: LeadInboxChannel) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const inboxState = raw?.inboxState && typeof raw.inboxState === 'object' ? raw.inboxState as LeadInboxState : {}
  const channel = explicitChannel || getInboxChannelForInboundSource(item.source)
  return inboxState?.[channel]
}

export function applyInboundLeadReadState(
  item: InboundLead,
  rawInput?: Record<string, unknown> | null,
  actor?: ActorMeta,
  explicitChannel?: LeadInboxChannel,
  at = new Date().toISOString()
) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data) ?? {}
  const channel = explicitChannel || getInboxChannelForInboundSource(item.source)
  const current = getInboundInboxChannelState(item, raw, channel)
  return {
    ...raw,
    inboxState: mergeLeadInboxState(
      raw.inboxState && typeof raw.inboxState === 'object' ? raw.inboxState as LeadInboxState : undefined,
      channel,
      applyChannelReadState(current, actor, at)
    ),
  }
}

export function applyInboundLeadActionState(
  item: InboundLead,
  rawInput?: Record<string, unknown> | null,
  actor?: ActorMeta,
  explicitChannel?: LeadInboxChannel,
  at = new Date().toISOString()
) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data) ?? {}
  const channel = explicitChannel || getInboxChannelForInboundSource(item.source)
  const current = getInboundInboxChannelState(item, raw, channel)
  return {
    ...raw,
    inboxState: mergeLeadInboxState(
      raw.inboxState && typeof raw.inboxState === 'object' ? raw.inboxState as LeadInboxState : undefined,
      channel,
      applyChannelActionState(current, actor, at)
    ),
  }
}

export function isInboundLeadUnread(item: InboundLead, rawInput?: Record<string, unknown> | null) {
  const raw = rawInput ?? parseInboundRawData(item.raw_data)
  const state = getInboundInboxChannelState(item, raw)
  const lastReadAt = state?.lastReadAt
  const latestAt = getInboundLeadLatestActivityAt(item, raw)
  if (!lastReadAt) return true
  return new Date(latestAt).getTime() > new Date(lastReadAt).getTime()
}

export function isSalesEmailUnread(email: CRMEmail) {
  if (email.direction !== 'inbound') return false
  if (!email.readAt) return true
  return new Date(email.sentAt).getTime() > new Date(email.readAt).getTime()
}

export function applySalesEmailReadState(email: CRMEmail, actor?: ActorMeta, at = new Date().toISOString()) {
  const normalizedActor = normalizeActor(actor)
  return {
    ...email,
    readAt: at,
    readByUserId: normalizedActor.userId || null,
    readByName: normalizedActor.name || null,
  }
}

export function applySalesEmailActionState(email: CRMEmail, actor?: ActorMeta, at = new Date().toISOString()) {
  const normalizedActor = normalizeActor(actor)
  return {
    ...applySalesEmailReadState(email, actor, at),
    actionedAt: at,
    actionedByUserId: normalizedActor.userId || null,
    actionedByName: normalizedActor.name || null,
  }
}
