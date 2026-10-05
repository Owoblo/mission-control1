import type { CRMLead, CRMQuote } from './types'
import { planningFingerprint, buildMoveOperatingPlan } from './move-operating-plan'
import { recommendTruckLoadPlan } from './truck-planning'

export type LinkedJobScope = { lead: CRMLead; quote: CRMQuote | null }
export type LinkedPlanReview = { fingerprint: string; reviewedAt: string; reviewedBy: string; instructions: string; plannedHours: number }
export function customerApproved(quote: CRMQuote | null) {
  return !!quote && (quote.status === 'accepted' || quote.status === 'invoiced' || !!quote.acceptedAt)
}
export function buildLinkedMovePlan(parent: CRMLead, quote: CRMQuote | null, scopes: LinkedJobScope[]) {
  const sameMove = scopes.filter(s => s.lead.additionalJobKind === 'supplement')
  const approved = sameMove.filter(s => customerApproved(s.quote))
  const pending = sameMove.filter(s => !customerApproved(s.quote) && s.quote?.status !== 'declined')
  const all = [{ lead: parent, quote }, ...approved]
  const inventory = all.flatMap(s => (s.lead.inventory || []).filter(i => i.included !== false))
  const volume = inventory.reduce((n, i) => n + Number(i.cubicFeet || 0) * Number(i.qty ?? 1), 0)
  const weight = inventory.reduce((n, i) => n + Number(i.weightLbs || 0) * Number(i.qty ?? 1), 0)
  const truck = recommendTruckLoadPlan({ totalCubicFeet: volume, totalWeightLbs: weight, inventory,
    committedSize: parent.truckSize || quote?.truckSize, truckCount: parent.truckCountConfirmed || quote?.truckCount })
  const reasons: string[] = []
  if (approved.length) {
    for (const scope of all) {
      const label = scope.lead.additionalJobLabel || 'Original move'
      const operating = buildMoveOperatingPlan(scope.lead, scope.quote)
      if (operating.invalidInventory) reasons.push(`${label}: inventory contains invalid values.`)
      if (!operating.originKnown || !operating.destinationKnown) reasons.push(`${label}: confirm carrying access at both ends.`)
      if (operating.assembly.tasks.some(task => task.workers > (quote?.crewSize || 0))) reasons.push(`${label}: assembly requires more workers than the original crew plan.`)
      if (!scope.lead.inventory?.some(i => i.included !== false)) reasons.push(`${label}: inventory is missing.`)
      if ((scope.lead.inventory || []).some(i => i.included !== false && (!(Number(i.cubicFeet) > 0) || !(Number(i.weightLbs) > 0) || !(Number(i.qty ?? 1) > 0)))) reasons.push(`${label}: verify item quantities, volumes and weights.`)
      if (!scope.lead.originAddress || !scope.lead.destAddress || !scope.lead.moveDate) reasons.push(`${label}: confirm both addresses and date.`)
      if (scope.lead.moveDate !== parent.moveDate) reasons.push(`${label}: date differs from the original move; reconcile before dispatch.`)
    }
    if (!parent.truckSize && !quote?.truckSize) reasons.push('Select the actual truck size before confirming combined capacity.')
    if (!truck.fits) reasons.push('Combined inventory exceeds the selected truck capacity. Increase capacity or arrange separately reviewed trips.')
  }
  const fingerprint = approved.length ? planningFingerprint(all.map(s => ({ id: s.lead.id, plan: buildMoveOperatingPlan(s.lead, s.quote).fingerprint,
    origin: s.lead.originAddress, destination: s.lead.destAddress, date: s.lead.moveDate, approvedQuote: s.quote?.id }))) : buildMoveOperatingPlan(parent, quote).fingerprint
  const review = parent.linkedPlanReview
  const reviewCurrent = !!review && review.fingerprint === fingerprint
  const ready = approved.length === 0 ? buildMoveOperatingPlan(parent, quote).ready : reasons.length === 0 && reviewCurrent
  const dispatchFingerprint = approved.length ? planningFingerprint({ scope: fingerprint, review: reviewCurrent ? review : null }) : fingerprint
  const assemblyHours = all.reduce((n, s) => n + buildMoveOperatingPlan(s.lead, s.quote).assembly.hours, 0)
  const brief = approved.length ? [
    'APPROVED ADDITIONAL SCOPE — ONE COORDINATED MOVE',
    ...approved.map(s => `${s.lead.additionalJobLabel}: ${s.lead.originAddress || 'pickup TBD'} → ${s.lead.destAddress || 'delivery TBD'}. Access: ${s.lead.originAccess || 'confirm'}; ${s.lead.parkingNotes || 'parking unconfirmed'}. Items: ${(s.lead.inventory || []).filter(i => i.included !== false).map(i => `${i.qty ?? 1} × ${i.name || i.item}`).join(', ') || 'not recorded'}.`),
    `Combined load: ${volume} cu ft / ${weight} lb. ${truck.summary}; usable planning capacity ${truck.totalUsableCubicFeet} cu ft / ${truck.totalPayloadLbs} lb.`,
    reviewCurrent ? `Operations instructions: ${review.instructions}\nTotal planned crew hours: ${review.plannedHours}` : 'Combined plan changed or is not reviewed. Operations must review before crew confirmation.',
  ].join('\n') : ''
  return { approved: approved.map(s => ({ id: s.lead.id, label: s.lead.additionalJobLabel })), pending: pending.map(s => ({ id: s.lead.id, label: s.lead.additionalJobLabel })), volume, weight, truck, reasons, fingerprint, dispatchFingerprint, assemblyHours, reviewCurrent, ready, brief }
}

export function storageVolumeScenario(width: number, depth: number, stackHeight: number, fullnessPercent: number) {
  if (![width, depth, stackHeight].every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(fullnessPercent) || fullnessPercent <= 0 || fullnessPercent > 100) throw new Error('Enter dimensions, observed stack height and a fullness between 1 and 100%.')
  return Math.round(width * depth * stackHeight * fullnessPercent / 100)
}

export function linkedJobScopes(parent: CRMLead, leads: CRMLead[], quotes: CRMQuote[]): LinkedJobScope[] {
  return leads.filter(lead => lead.parentLeadId === parent.id).map(lead => ({ lead, quote: quotes.find(q => q.id === lead.quoteId) || null }))
}
