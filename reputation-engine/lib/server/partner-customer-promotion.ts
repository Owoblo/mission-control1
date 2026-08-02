import { dateStamp, normalizeLead, uid } from '@/lib/sales'
import { applyDetectedBranch } from '@/lib/server/sales-opportunities'
import { getSalesLeadByContact, saveSalesLead } from '@/lib/server/sales-repository'
export { isPartnerMovingLeadIntent } from '@/lib/partner-customer-intent'

export interface PartnerCustomerContact {
  id: string
  name?: string | null
  company?: string | null
  category?: string | null
  email?: string | null
  phone?: string | null
}

export async function findPartnerCustomerSalesLead(contact: PartnerCustomerContact) {
  return getSalesLeadByContact(contact.phone, contact.email)
}

export async function promotePartnerToMovingLead(
  contact: PartnerCustomerContact,
  input: { message?: string | null; occurredAt?: string }
) {
  const now = input.occurredAt || new Date().toISOString()
  const existing = await findPartnerCustomerSalesLead(contact)
  const relationship = {
    relationshipContactId: contact.id,
    relationshipContactName: contact.name?.trim() || undefined,
    relationshipContactCompany: contact.company?.trim() || undefined,
    relationshipContactCategory: contact.category?.trim() || undefined,
    relationshipContactLinkedAt: existing?.relationshipContactLinkedAt || now,
    relationshipContactReason: 'partner_became_customer' as const,
  }

  if (existing) {
    return saveSalesLead(applyDetectedBranch({
      ...existing,
      ...relationship,
      name: existing.name || contact.name?.trim() || contact.company?.trim() || 'Partnership contact',
      phone: existing.phone || contact.phone?.trim() || undefined,
      email: existing.email || contact.email?.trim().toLowerCase() || undefined,
      source: !existing.source || existing.source === 'other' ? 'relationship_contact' : existing.source,
      sourceDetail: existing.sourceDetail || 'Partnership contact became a moving customer',
      inboundMessage: input.message?.trim() || existing.inboundMessage,
      lastInboundAt: now,
    }))
  }

  return saveSalesLead(applyDetectedBranch(normalizeLead({
    id: uid('lead'),
    name: contact.name?.trim() || contact.company?.trim() || 'Partnership contact',
    stage: 'new',
    leadKind: 'customer',
    primaryContactRole: 'customer',
    source: 'relationship_contact',
    sourceDetail: 'Partnership contact became a moving customer',
    ...relationship,
    phone: contact.phone?.trim() || undefined,
    email: contact.email?.trim().toLowerCase() || undefined,
    inboundMessage: input.message?.trim() || undefined,
    lastInboundAt: now,
    moveType: 'residential',
    createdAt: dateStamp(new Date(now)),
    automationStatus: 'handoff',
  })))
}
