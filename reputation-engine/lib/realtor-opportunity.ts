import type { CRMLead } from './types'

export const SYNTHETIC_REALTOR_LEAD_PREFIX = 'Realtor lead —'
const PERSONAL_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
])

export function isSyntheticOpportunityLeadName(name?: string) {
  return (name || '').startsWith(SYNTHETIC_REALTOR_LEAD_PREFIX)
}

export function isPersonalEmailDomain(email?: string | null) {
  const normalized = (email || '').trim().toLowerCase()
  if (!normalized.includes('@')) return false
  const domain = normalized.split('@')[1] || ''
  return PERSONAL_EMAIL_DOMAINS.has(domain)
}

export function getListingSideContactRoleLabel(contactKind?: string | null) {
  if (contactKind === 'listing_agent') return 'Listing agent'
  if (contactKind === 'sales_representative') return 'Sales representative'
  if (contactKind === 'brokerage_office') return 'Brokerage office'
  return 'Listing-side contact'
}

export function getListingSideContactDisplayName(
  lead: Pick<CRMLead, 'name' | 'realtorName' | 'realtorBrokerage' | 'realtorContactKind'>
) {
  const realtorName = (lead.realtorName || '').trim()
  if (realtorName) return realtorName

  const brokerage = (lead.realtorBrokerage || '').trim()
  if (brokerage) return brokerage

  const fallbackName = (lead.name || '').trim()
  if (fallbackName && !isSyntheticOpportunityLeadName(fallbackName)) return fallbackName

  return `${getListingSideContactRoleLabel(lead.realtorContactKind)} pending`
}

export function getListingSideContactFirstName(
  lead: Pick<CRMLead, 'name' | 'realtorName' | 'realtorBrokerage' | 'realtorContactKind'>
) {
  const realtorName = (lead.realtorName || '').trim()
  if (!realtorName) return 'there'
  return realtorName.split(/\s+/)[0] || 'there'
}

function digitsOnly(value?: string | null) {
  return (value || '').replace(/\D/g, '')
}

function normalizeLookupText(value?: string | null) {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeBrokerageKey(value?: string | null) {
  return normalizeLookupText(value)
    .replace(/\b(realty|brokerage|real estate|inc|ltd|limited|corp|corporation)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function canAutoApplyRealtorContact(input: {
  rawText?: string | null
  expectedBrokerage?: string | null
  realtorName?: string | null
  realtorPhone?: string | null
  realtorEmail?: string | null
  realtorBrokerage?: string | null
  contactKind?: string | null
  confidence?: string | null
}) {
  const confidence = (input.confidence || '').trim().toLowerCase()
  const contactKind = (input.contactKind || 'unknown').trim().toLowerCase()
  const email = (input.realtorEmail || '').trim().toLowerCase()
  const rawText = input.rawText || ''
  const rawTextKey = normalizeLookupText(rawText)
  const rawDigits = digitsOnly(rawText)
  const nameKey = normalizeLookupText(input.realtorName)
  const phoneDigits = digitsOnly(input.realtorPhone)
  const emailVisible = email ? rawText.toLowerCase().includes(email) : false
  const expectedBrokerage = normalizeBrokerageKey(input.expectedBrokerage)
  const returnedBrokerage = normalizeBrokerageKey(input.realtorBrokerage)
  const brokerageVisible =
    (!!expectedBrokerage && rawTextKey.includes(expectedBrokerage)) ||
    (!!returnedBrokerage && rawTextKey.includes(returnedBrokerage))

  if (confidence !== 'high') return false
  if (!contactKind || contactKind === 'unknown') return false
  if (!nameKey || !rawTextKey.includes(nameKey)) return false
  if (!email || isPersonalEmailDomain(email) || !emailVisible) return false
  if (!brokerageVisible && !(phoneDigits && rawDigits.includes(phoneDigits))) return false
  return true
}

function formatOpportunityMoveDate(value?: string) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('en-CA', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

function buildOpportunityAddressLine(lead: CRMLead) {
  return lead.opportunityAddress || lead.originAddress || lead.destAddress || lead.destCity || 'the address'
}

function buildOpportunityAddressSubject(lead: CRMLead) {
  return buildOpportunityAddressLine(lead).split(',')[0]?.trim() || 'your listing'
}

function buildRealtorFirstName(lead: CRMLead) {
  return getListingSideContactFirstName(lead)
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

  const warm = lead.realtorResearch?.relationship?.history.some(t => t.direction === 'inbound')
  const intro = warm ? `Hi ${firstName}, John here. Following up on our earlier conversation.` : `Hi ${firstName}, John from Saturn Star Movers here.`
  const context = `We’re coordinating a possible move into ${address}${dateClause}. Do your sellers, or any other clients, have anything they need moved around then?`
  const offer = 'If we can coordinate it with that trip, I may be able to offer a better price once I know what’s involved.'
  if (channel === 'sms') return `${intro} ${context} ${offer}`
  return { subject: `Moving plans around ${buildOpportunityAddressSubject(lead)}`,
    body: `${intro}\n\n${context}\n\n${offer}\n\nHappy to discuss or meet if useful.\n\nJohn\nSaturn Star Movers` }

}

export function applyRealtorContactToOpportunityLead(
  lead: CRMLead,
  contact: Partial<Pick<CRMLead, 'realtorName' | 'realtorPhone' | 'realtorEmail' | 'realtorBrokerage'>>
): CRMLead {
  return { ...lead, ...contact }
}
