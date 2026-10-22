/** Acquisition channel and the human referrer are independent attribution dimensions. */
export function getAttributedPartnerId(lead: { partnerReferralContactId?: string; source?: string }) {
  return lead.partnerReferralContactId?.trim() || undefined
}
