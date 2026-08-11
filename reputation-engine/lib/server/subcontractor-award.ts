import { getSalesLead, saveSalesLead } from '@/lib/server/sales-repository'
import { listSubcontractorOffers, listSubcontractors } from '@/lib/server/subcontractors'
import { getCrewRoleDefaultRate } from '@/lib/operations'
import { uid } from '@/lib/sales'
import { createPartnerAssignmentAndEarning } from '@/lib/server/partner-operations'

export async function handoffAwardToCrew(offerId: string, subcontractorId: string) {
  const [offers, contractors] = await Promise.all([listSubcontractorOffers(), listSubcontractors()])
  const offer = offers.find(item => item.id === offerId)
  const contractor = contractors.find(item => item.id === subcontractorId)
  if (!offer || !contractor) throw new Error('Awarded offer or contractor was not found')
  const lead = await getSalesLead(offer.leadId)
  if (!lead) throw new Error('The job attached to this offer was not found')
  const existing = (lead.crewPayouts || []).find(item => item.subcontractorId === contractor.id)
  const hourlyRate = getCrewRoleDefaultRate('crew_lead')
  const approvedHours = offer.estimatedHoursMax || offer.estimatedHoursMin || 0
  const entry = {
    id: existing?.id || uid('crew'), subcontractorId: contractor.id, subcontractorOfferId: offer.id,
    workerName: contractor.companyName, workerPhone: contractor.phone, workerEmail: contractor.email,
    role: 'crew_lead' as const, hourlyRate, approvedHours, laborPay: offer.offeredPayout,
    paymentMethod: existing?.paymentMethod || 'interac' as const, payoutStatus: existing?.payoutStatus || 'submitted' as const,
    dispatchStatus: 'confirmed' as const, dispatchToken: existing?.dispatchToken || uid('crew'),
    dispatchSentAt: existing?.dispatchSentAt, dispatchConfirmedAt: new Date().toISOString(),
  }
  const saved = await saveSalesLead({
    ...lead,
    crewPayouts: [...(lead.crewPayouts || []).filter(item => item.subcontractorId !== contractor.id), entry],
    crewNote: [lead.crewNote, `Awarded to ${contractor.companyName} for ${offer.currency} $${offer.offeredPayout.toFixed(2)}.`].filter(Boolean).join('\n'),
    lastTouchedAt: new Date().toISOString(),
  })
  await createPartnerAssignmentAndEarning({ leadId: lead.id, offerId: offer.id, subcontractorId: contractor.id, expectedStart: offer.moveDate, payout: offer.offeredPayout, currency: offer.currency })
  return saved
}
