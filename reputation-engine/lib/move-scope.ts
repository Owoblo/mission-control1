import { summarizeMovePolicy } from './move-policy'
import type { InventoryItem, JobFactors, MoveType } from './types'

export function getIncludedDisassemblyItems(items: string[], excludedItems?: Iterable<string>) {
  const excluded = new Set(excludedItems || [])
  return items.filter(item => !excluded.has(item))
}

export function getDisassemblyServiceLabel(mode?: JobFactors['disassemblyMode']) {
  if (mode === 'disassemble_only') return 'Disassembly only'
  if (mode === 'reassemble_only') return 'Reassembly only'
  return 'Disassembly + reassembly'
}

function joinUniqueLabels(findings: ReturnType<typeof summarizeMovePolicy>['findings']) {
  return Array.from(new Set(findings.map(finding => finding.itemLabel || finding.label)))
}

export function buildMoveSpecificNotes(
  jobFactors?: JobFactors | null,
  inventory?: InventoryItem[] | null,
  moveType?: MoveType
) {
  const notes: string[] = []

  if (jobFactors?.originFloors && jobFactors.originFloors > 1) {
    notes.push(`${jobFactors.originFloors}-floor walk-up at origin — stair time included`)
  }
  if (jobFactors?.destFloors && jobFactors.destFloors > 1) {
    notes.push(`${jobFactors.destFloors}-floor walk-up at destination — stair time included`)
  }
  if (jobFactors?.originHasElevator) {
    notes.push('Elevator at origin — reservation required day of move')
  }
  if (jobFactors?.destHasElevator) {
    notes.push('Elevator at destination — reservation required day of move')
  }
  if (jobFactors?.hasPiano) {
    notes.push('Piano included — specialized handling and equipment')
  }
  if (jobFactors?.hasSafe) {
    notes.push('Safe included — extra crew and equipment allocated')
  }
  if (jobFactors?.disassemblyItemCount && jobFactors.disassemblyItemCount > 0) {
    notes.push(
      `${jobFactors.disassemblyItemCount} item${jobFactors.disassemblyItemCount > 1 ? 's' : ''} requiring ${getDisassemblyServiceLabel(jobFactors.disassemblyMode).toLowerCase()} — time included`
    )
  }
  if (jobFactors?.estimatedBoxes && jobFactors.estimatedBoxes > 0) {
    notes.push(`~${jobFactors.estimatedBoxes} boxes estimated — included in load time`)
  }
  if (jobFactors?.garageCubicFeet || jobFactors?.basementCubicFeet || jobFactors?.shedCubicFeet) {
    notes.push('Garage, basement, or shed items included in volume estimate')
  }
  if (jobFactors?.specialtyNotes?.trim()) {
    notes.push(jobFactors.specialtyNotes.trim())
  }

  const policySummary = summarizeMovePolicy(inventory, { moveType })
  const blockedLabels = joinUniqueLabels(policySummary.blocked)
  const hazardousLabels = joinUniqueLabels(policySummary.hazardous)
  const manualReviewLabels = joinUniqueLabels(policySummary.manualReview)
  const specialtyLabels = joinUniqueLabels(policySummary.specialtyFee)

  if (blockedLabels.length > 0) {
    notes.push(`Excluded from quoted scope: ${blockedLabels.join(', ')} — separate specialty mover required`)
  }
  if (hazardousLabels.length > 0) {
    notes.push(`Customer must remove hazardous / non-transport items before move day: ${hazardousLabels.join(', ')}`)
  }
  if (manualReviewLabels.length > 0) {
    notes.push(`Separate management review required before including: ${manualReviewLabels.join(', ')}`)
  }
  if (specialtyLabels.some(label => label.toLowerCase().includes('safe'))) {
    notes.push('Safe handling requires photo/weight confirmation and specialty pricing before the move is finalized')
  }

  return notes
}
