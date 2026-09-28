import type { CRMLead, SalesLeadStage } from './types'
import { planningFingerprint } from './move-operating-plan'

export const VERIFICATION_ITEMS = [
  { key: 'origin', label: 'Origin access', hint: 'Truck parking, carrying route, stairs and entrance at pickup.' },
  { key: 'destination', label: 'Destination access', hint: 'Truck parking, carrying route, stairs and entrance at delivery.' },
  { key: 'route', label: 'Addresses and distance', hint: 'Confirm both addresses, distance and any additional stops.' },
  { key: 'inventory', label: 'Inventory and hidden areas', hint: 'Confirm what moves, what stays and anything missing from the list.' },
  { key: 'handling', label: 'Packing and complications', hint: 'Confirm packing, assembly, specialty items and any newly discovered complications.' },
  { key: 'timing', label: 'Move timing and follow-up', hint: 'Record the move date or what the customer is waiting for, and the next follow-up.' },
] as const
export type VerificationKey = typeof VERIFICATION_ITEMS[number]['key']
export type VerificationStatus = 'contacted' | 'verified' | 'needs_follow_up' | 'not_applicable'
export type VerificationMethod = 'call' | 'sms' | 'email' | 'photos_video' | 'maps' | 'in_person' | 'internal'
export interface LeadVerification {
  id: string
  key: VerificationKey
  status: VerificationStatus
  method: VerificationMethod
  note: string
  followUpDate?: string
  scope: string
  recordedAt: string
  actorName: string
  actorUserId?: string
}
export interface LeadStageChange {
  id: string
  from: SalesLeadStage
  to: SalesLeadStage
  at: string
  actorName: string
  actorUserId?: string
  source: 'user' | 'system' | 'historical_event'
  reason?: string
  evidence?: string
}

export function verificationScope(lead: CRMLead, key: VerificationKey) {
  const f = lead.jobFactors || {}
  const origin = { factors: Object.fromEntries(Object.entries(f).filter(([key]) => key.startsWith('origin') || key.startsWith('personBOrigin'))), address: lead.originAddress, city: lead.originCity, notes: lead.originAccess, floors: f.originFloors, elevator: f.originHasElevator, reserved: f.originElevatorReserved, parking: f.originParkingOk, carry: f.originCarryDistanceFeet }
  const destination = { factors: Object.fromEntries(Object.entries(f).filter(([key]) => key.startsWith('dest'))), address: lead.destAddress, city: lead.destCity, notes: lead.destAccess, floors: f.destFloors, elevator: f.destHasElevator, reserved: f.destElevatorReserved, parking: f.destParkingOk, carry: f.destCarryDistanceFeet }
  const profiles = f.accessProfiles || []
  const scopes = {
    origin: { ...origin, parkingNotes: lead.parkingNotes, profiles: profiles.filter(p => p.stopRole === 'pickup') },
    destination: { ...destination, parkingNotes: lead.parkingNotes, profiles: profiles.filter(p => p.stopRole !== 'pickup') },
    route: { origin: [lead.originAddress, lead.originCity], destination: [lead.destAddress, lead.destCity], stops: profiles.map(p => [p.stopId, p.addressSnapshot]), moveType: lead.moveType },
    inventory: { inventory: lead.inventory, coverage: f.hiddenInventoryCoverage, boxes: f.estimatedBoxes },
    handling: { inventory: lead.inventory, packing: f.packingStatus, assembly: f.disassemblyMode, specialtyNotes: f.specialtyNotes, piano: f.hasPiano, safe: f.hasSafe },
    timing: { moveDate: lead.moveDate, flexible: lead.moveDateFlexible, reason: lead.moveDateFlexibleReason },
  }
  return planningFingerprint(scopes[key])
}
export function currentVerification(lead: CRMLead, key: VerificationKey) {
  const entry = [...(lead.verificationHistory || [])].reverse().find(item => item.key === key)
  return { entry, stale: Boolean(entry && entry.scope !== verificationScope(lead, key)) }
}
export function verificationSummary(lead: CRMLead) {
  const entries = VERIFICATION_ITEMS.map(item => currentVerification(lead, item.key))
  const latest = lead.verificationHistory?.at(-1)
  return { verified: entries.filter(({entry,stale}) => !stale && (entry?.status === 'verified' || entry?.status === 'not_applicable')).length, followUp: entries.filter(({entry,stale}) => stale || entry?.status === 'needs_follow_up').length, latest }
}
export function lostTransitionError(previous: CRMLead, next: CRMLead) {
  if (previous.stage === 'lost' || next.stage !== 'lost') return null
  if (!next.lostReason?.trim()) return 'Choose a loss reason and record the customer evidence before marking Lost.'
  if (['timing', 'no_response'].includes(next.lostReason)) return 'Waiting, timing uncertainty, and no response belong in Nurture / follow-up, not Lost.'
  const note = next.lostNotes?.trim() || ''
  const explicitInvalidContact = next.lostReason === 'not_a_fit' && /^(spam|scam|test(?: lead)?|duplicate(?: lead)?|wrong number|misdial|not a customer)$/i.test(note)
  if (note.length < 12 && !explicitInvalidContact) return 'Record what confirms the loss, including the message, call, or other source.'
  return null
}
