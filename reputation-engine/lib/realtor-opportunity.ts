import type { CRMLead } from './types'

export const SYNTHETIC_REALTOR_LEAD_PREFIX = 'Realtor lead —'

export function isSyntheticOpportunityLeadName(name?: string) {
  return (name || '').startsWith(SYNTHETIC_REALTOR_LEAD_PREFIX)
}

function formatOpportunityMoveDate(value?: string) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function buildOpportunityAddressLine(lead: CRMLead) {
  return lead.opportunityAddress || lead.originAddress || lead.destAddress || lead.destCity || 'the address'
}

function buildOpportunityAddressSubject(lead: CRMLead) {
  return buildOpportunityAddressLine(lead).split(',')[0]?.trim() || 'your listing'
}

function buildRealtorFirstName(lead: CRMLead) {
  const raw = lead.realtorName || (!isSyntheticOpportunityLeadName(lead.name) ? lead.name : '') || 'there'
  return raw.trim().split(/\s+/)[0] || 'there'
}

export function buildDestinationOpportunityPitch(lead: CRMLead, channel: 'sms'): string
export function buildDestinationOpportunityPitch(lead: CRMLead, channel: 'email'): { subject: string; body: string }
export function buildDestinationOpportunityPitch(
  lead: CRMLead,
  channel: 'sms' | 'email'
) {
  const firstName = buildRealtorFirstName(lead)
  const address = buildOpportunityAddressLine(lead)
  const formattedMoveDate = formatOpportunityMoveDate(lead.sourceLeadMoveDate || lead.moveDate)
  const dateClause = formattedMoveDate
    ? ` on ${formattedMoveDate}`
    : ' soon'

  if (channel === 'sms') {
    return `Hi ${firstName}, this is Saturn Star Moving. We may be coordinating a move into ${address}${dateClause}. If your client at that address also needs movers, we may be able to offer a preferred paired-move rate since our trucks would already be servicing that stop. Happy to quote quickly by SMS or email.`
  }

  return {
    subject: `Possible move opportunity for your client at ${buildOpportunityAddressSubject(lead)}`,
    body:
      `Hi ${firstName},\n\n` +
      `This is Saturn Star Moving. We may be coordinating a move into ${address}${dateClause}.\n\n` +
      `If your client at that address also needs movers, we may be able to offer a preferred paired-move rate since our trucks would already be servicing that location. That can help us move quickly and keep the process simple for both sides.\n\n` +
      `If helpful, feel free to reply here or share our details with your client and we can provide a quote promptly.\n\n` +
      `Regards,\n` +
      `John\n` +
      `Saturn Star Moving`
  }
}

export function applyRealtorContactToOpportunityLead(
  lead: CRMLead,
  contact: Partial<Pick<CRMLead, 'realtorName' | 'realtorPhone' | 'realtorEmail' | 'realtorBrokerage'>>
): CRMLead {
  const next = { ...lead, ...contact }
  if (lead.primaryContactRole !== 'realtor') return next

  const realtorName = contact.realtorName || lead.realtorName
  const realtorPhone = contact.realtorPhone || lead.realtorPhone
  const realtorEmail = contact.realtorEmail || lead.realtorEmail

  if (realtorName && (!lead.name || isSyntheticOpportunityLeadName(lead.name))) {
    next.name = realtorName
  }
  if (realtorPhone && !lead.phone) {
    next.phone = realtorPhone
  }
  if (realtorEmail && !lead.email) {
    next.email = realtorEmail
  }

  return next
}
