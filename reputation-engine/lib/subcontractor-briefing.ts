import { buildCurrentCrewBrief, buildMoveOperatingPlan } from './move-operating-plan'
import { isBookedLikeStage } from './sales'
import type { CRMLead, CRMQuote } from './types'

export type PartnerJobReadiness = {
  ready: boolean
  missing: string[]
  warnings: string[]
  suggestedPayout: number
}

export function derivePartnerJobReadiness(lead: CRMLead, quote: CRMQuote | null): PartnerJobReadiness {
  const missing: string[] = []
  const warnings: string[] = []
  if (!isBookedLikeStage(lead.stage)) missing.push('Job is not confirmed booked')
  if (!(lead.paymentStatus === 'deposit_received' || lead.paymentStatus === 'paid_in_full' || quote?.depositPaidAt)) missing.push('Deposit is not confirmed')
  if (!(lead.moveDate || quote?.moveDate)) missing.push('Move date is missing')
  if (!lead.originCity || !lead.destCity) missing.push('Origin and destination cities are required')
  if (!lead.originAddress || !lead.destAddress) warnings.push('Full addresses are not complete for the post-award packet')
  if (!quote?.crewSize) missing.push('Crew size is not defined')
  if (!quote?.estimatedHours) missing.push('Estimated duration is not defined')
  if (!quote?.truckCount && !lead.truckSize) warnings.push('Truck plan is not confirmed')
  if (!(lead.inventory?.length || 0)) warnings.push('Inventory has not been verified')
  if (!lead.originAccess || !lead.destAccess) warnings.push('Access notes are incomplete')
  const hours = Number(quote?.estimatedHours || 0)
  const crew = Number(quote?.crewSize || 0)
  const trucks = Number(quote?.truckCount || 0)
  const labor = hours * crew * 27
  const truckAllowance = trucks * Math.max(175, hours * 22)
  const suggestedPayout = Math.ceil((labor + truckAllowance) / 25) * 25
  return { ready: missing.length === 0, missing, warnings, suggestedPayout }
}

function includedInventory(lead: CRMLead) {
  return (lead.inventory || []).filter(item => item.included !== false)
}

export function buildSanitizedPartnerBrief(lead: CRMLead, quote: CRMQuote | null) {
  const inventory = includedInventory(lead)
  const highlights = inventory.filter(item => /piano|safe|sectional|appliance|pool table|hot tub|fragile|glass|tv/i.test(`${item.name || item.item} ${item.notes || ''}`)).slice(0, 12)
  return [
    `JOB ${lead.id}`,
    `${lead.moveDate || quote?.moveDate || 'Date TBD'} · ${lead.originCity || 'Origin TBD'} → ${lead.destCity || 'Destination TBD'}`,
    `${quote?.crewSize || '?'} crew · ${quote?.truckCount || '?'} truck(s) · ${quote?.estimatedHours || '?'} estimated hours`,
    `Service: ${lead.moveType || 'residential moving'}`,
    `Access: origin ${lead.originAccess || 'not confirmed'}; destination ${lead.destAccess || 'not confirmed'}; parking ${lead.parkingNotes || 'not confirmed'}`,
    `Inventory: ${inventory.length} line items${highlights.length ? `. Notable: ${highlights.map(item => item.name || item.item).join(', ')}` : ''}`,
    `Operating review: ${buildMoveOperatingPlan(lead, quote).ready ? 'current' : 'required before dispatch'}`,
    'Customer name, phone, email, exact addresses, quoted price, payment data, margin, and private sales notes are withheld until award.',
  ].filter(Boolean).join('\n')
}

export function buildAwardedCrewBrief(lead: CRMLead, quote: CRMQuote | null) {
  return buildCurrentCrewBrief(lead, quote)
}
