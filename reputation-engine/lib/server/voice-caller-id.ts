import {
  DEFAULT_SATURN_BRANCH_NUMBER,
  getSaturnBranchLabel,
  getSaturnBranchNumberForSalesBranch,
  getSaturnBranchNumberFromRawData,
  getSaturnBusinessNumberFromSmsMessage,
  inferSaturnBranchPhoneNumberFromCity,
  inferSaturnBranchPhoneNumberFromPhone,
  isSaturnBranchPhoneNumber,
  normalizePhone,
  pickSaturnBranchPhoneNumber,
} from '@/lib/sales-phones'
import { getSalesLeadByContact, getInboundLead, getSalesLead } from '@/lib/server/sales-repository'
import { listSmsMessages, type SmsMessageRecord } from '@/lib/server/sms-threads'
import type { CRMLead } from '@/lib/types'

export type VoiceCallerIdResolutionReason =
  | 'explicit'
  | 'lead_sms_thread'
  | 'lead_recent_call'
  | 'lead_inbound_number'
  | 'lead_branch'
  | 'lead_city'
  | 'contact_match_sms_thread'
  | 'contact_match_recent_call'
  | 'contact_match_inbound_number'
  | 'contact_match_branch'
  | 'contact_match_city'
  | 'phone_area_code'
  | 'default'

export interface VoiceCallerIdResolution {
  fromNumber: string
  branchLabel: string
  matchedLeadId?: string | null
  reason: VoiceCallerIdResolutionReason
}

type ResolveVoiceCallerIdInput = {
  leadId?: string | null
  phone?: string | null
  email?: string | null
  inboundId?: string | null
  preferredFromNumber?: string | null
}

function pickRecentThreadBranchNumber(messages: SmsMessageRecord[]) {
  const ordered = [...messages].sort((left, right) => right.created_at.localeCompare(left.created_at))
  for (const message of ordered) {
    const branchNumber = getSaturnBusinessNumberFromSmsMessage(message)
    if (isSaturnBranchPhoneNumber(branchNumber)) {
      return branchNumber
    }
  }
  return null
}

function pickRecentCallBranchNumber(lead?: CRMLead | null) {
  return (
    (lead?.callLogs || [])
      .slice()
      .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
      .map(entry => normalizePhone(entry.branchNumber))
      .find(isSaturnBranchPhoneNumber) || null
  )
}

async function pickInboundLeadBranchNumber(lead?: CRMLead | null) {
  if (!lead?.inboundId) return null
  const inboundLead = await getInboundLead(lead.inboundId).catch(() => null)
  return getSaturnBranchNumberFromRawData(inboundLead?.raw_data) || null
}

async function pickLeadSmsThreadBranchNumber(lead?: CRMLead | null) {
  if (!lead?.id) return null
  const messages = await listSmsMessages(undefined, lead.id).catch(() => [] as SmsMessageRecord[])
  return pickRecentThreadBranchNumber(messages)
}

function pickLeadBranchFallback(lead?: CRMLead | null) {
  return (
    getSaturnBranchNumberForSalesBranch(lead?.branch) ||
    inferSaturnBranchPhoneNumberFromCity(lead?.originCity) ||
    inferSaturnBranchPhoneNumberFromCity(lead?.destCity) ||
    inferSaturnBranchPhoneNumberFromCity(lead?.originAddress) ||
    inferSaturnBranchPhoneNumberFromCity(lead?.destAddress) ||
    null
  )
}

async function resolveLeadDerivedCallerId(
  lead: CRMLead,
  matchedPrefix: 'lead' | 'contact_match',
): Promise<VoiceCallerIdResolution | null> {
  const smsThreadBranch = await pickLeadSmsThreadBranchNumber(lead)
  if (smsThreadBranch) {
    return {
      fromNumber: smsThreadBranch,
      branchLabel: getSaturnBranchLabel(smsThreadBranch),
      matchedLeadId: lead.id,
      reason: `${matchedPrefix}_sms_thread` as VoiceCallerIdResolutionReason,
    }
  }

  const recentCallBranch = pickRecentCallBranchNumber(lead)
  if (recentCallBranch) {
    return {
      fromNumber: recentCallBranch,
      branchLabel: getSaturnBranchLabel(recentCallBranch),
      matchedLeadId: lead.id,
      reason: `${matchedPrefix}_recent_call` as VoiceCallerIdResolutionReason,
    }
  }

  const inboundBranch = await pickInboundLeadBranchNumber(lead)
  if (inboundBranch) {
    return {
      fromNumber: inboundBranch,
      branchLabel: getSaturnBranchLabel(inboundBranch),
      matchedLeadId: lead.id,
      reason: `${matchedPrefix}_inbound_number` as VoiceCallerIdResolutionReason,
    }
  }

  const fallbackBranch = pickLeadBranchFallback(lead)
  if (fallbackBranch) {
    return {
      fromNumber: fallbackBranch,
      branchLabel: getSaturnBranchLabel(fallbackBranch),
      matchedLeadId: lead.id,
      reason: lead.branch
        ? (`${matchedPrefix}_branch` as VoiceCallerIdResolutionReason)
        : (`${matchedPrefix}_city` as VoiceCallerIdResolutionReason),
    }
  }

  return null
}

export async function resolveVoiceCallerId(input: ResolveVoiceCallerIdInput): Promise<VoiceCallerIdResolution> {
  const explicit = normalizePhone(input.preferredFromNumber)
  if (isSaturnBranchPhoneNumber(explicit)) {
    return {
      fromNumber: explicit,
      branchLabel: getSaturnBranchLabel(explicit),
      matchedLeadId: input.leadId || null,
      reason: 'explicit',
    }
  }

  const normalizedPhone = normalizePhone(input.phone)
  const normalizedEmail = input.email?.trim().toLowerCase() || null
  const inboundId = input.inboundId?.trim() || null

  const directLead = input.leadId ? await getSalesLead(input.leadId).catch(() => null) : null
  if (directLead) {
    const leadResolution = await resolveLeadDerivedCallerId(directLead, 'lead')
    if (leadResolution) {
      return leadResolution
    }
  }

  const matchedLead = await getSalesLeadByContact(normalizedPhone, normalizedEmail, inboundId).catch(() => null)
  if (matchedLead && matchedLead.id !== directLead?.id) {
    const matchedResolution = await resolveLeadDerivedCallerId(matchedLead, 'contact_match')
    if (matchedResolution) {
      return matchedResolution
    }
  }

  const areaCodeBranch = inferSaturnBranchPhoneNumberFromPhone(normalizedPhone)
  if (areaCodeBranch) {
    return {
      fromNumber: areaCodeBranch,
      branchLabel: getSaturnBranchLabel(areaCodeBranch),
      matchedLeadId: matchedLead?.id || directLead?.id || null,
      reason: 'phone_area_code',
    }
  }

  const fallback = pickSaturnBranchPhoneNumber(DEFAULT_SATURN_BRANCH_NUMBER)
  return {
    fromNumber: fallback,
    branchLabel: getSaturnBranchLabel(fallback),
    matchedLeadId: matchedLead?.id || directLead?.id || null,
    reason: 'default',
  }
}
