export type TwilioCallLeg = {
  sid: string
  parent_call_sid?: string | null
  from?: string | null
  to?: string | null
  status?: string | null
}

export type ResolvedCallLegs = {
  repCallSid: string
  customerCallSid: string
  rootCallSid: string
}

const CALL_SID_PATTERN = /^CA[a-fA-F0-9]{32}$/
const CONFERENCE_NAME_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export function isTwilioCallSid(value?: string | null) {
  return CALL_SID_PATTERN.test((value || '').trim())
}

export function isSafeConferenceName(value?: string | null) {
  return CONFERENCE_NAME_PATTERN.test((value || '').trim())
}

export function isInternalVoiceAddress(value?: string | null) {
  const normalized = (value || '').trim().toLowerCase()
  return normalized.startsWith('client:') || normalized.startsWith('sip:')
}

export function escapeTwiml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function makeConferenceName(rootCallSid: string) {
  if (!isTwilioCallSid(rootCallSid)) throw new Error('Invalid root Call SID')
  return `saturn_${rootCallSid}`
}

export function resolveTwilioCallLegs(
  active: TwilioCallLeg,
  related: TwilioCallLeg[],
): ResolvedCallLegs {
  if (!isTwilioCallSid(active.sid)) throw new Error('Invalid active Call SID')

  const bySid = new Map(related.filter(call => isTwilioCallSid(call.sid)).map(call => [call.sid, call]))
  bySid.set(active.sid, active)
  const activeIsRep = isInternalVoiceAddress(active.from) || isInternalVoiceAddress(active.to)

  if (active.parent_call_sid && isTwilioCallSid(active.parent_call_sid)) {
    const parent = bySid.get(active.parent_call_sid)
    if (!parent) throw new Error('The parent call leg could not be loaded')
    return activeIsRep
      ? { repCallSid: active.sid, customerCallSid: parent.sid, rootCallSid: parent.sid }
      : { repCallSid: parent.sid, customerCallSid: active.sid, rootCallSid: parent.sid }
  }

  const children = related.filter(call => call.parent_call_sid === active.sid && call.status !== 'completed')
  const internalChild = children.find(call => isInternalVoiceAddress(call.from) || isInternalVoiceAddress(call.to))
  const externalChild = children.find(call => !isInternalVoiceAddress(call.from) && !isInternalVoiceAddress(call.to))

  if (activeIsRep && externalChild) {
    return { repCallSid: active.sid, customerCallSid: externalChild.sid, rootCallSid: active.sid }
  }
  if (!activeIsRep && internalChild) {
    return { repCallSid: internalChild.sid, customerCallSid: active.sid, rootCallSid: active.sid }
  }

  throw new Error('Could not distinguish the representative and customer call legs')
}

export function normalizeInternalTransferTarget(value: string) {
  const trimmed = value.trim()
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('client:')) {
    const identity = trimmed.slice(7)
    if (!/^[A-Za-z0-9_-]{1,121}$/.test(identity)) throw new Error('Invalid browser identity')
    return { kind: 'client' as const, target: identity }
  }
  if (lower.startsWith('sip:')) {
    if (!/^sip:[A-Za-z0-9_.!~*'()%+-]+@[A-Za-z0-9.-]+$/i.test(trimmed)) {
      throw new Error('Invalid SIP target')
    }
    return { kind: 'sip' as const, target: trimmed }
  }
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) {
    return { kind: 'number' as const, target: trimmed }
  }
  if (/^[A-Za-z0-9_-]{1,121}$/.test(trimmed)) {
    return { kind: 'client' as const, target: trimmed }
  }
  throw new Error('Invalid transfer target')
}

