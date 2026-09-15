export interface OperationalOutcome {
  revision?: number
  actualHours?: number
  actualCrew?: number
  startedAt?: string
  finishedAt?: string
  breakMinutes?: number
  actualTruck?: string
  truckSwapMinutes?: number
  assemblyActuals?: Array<{ item: string; originMinutes: number; destinationMinutes: number; workers: number }>
  inventoryChanges?: string
  cause?: string
  correctiveAction?: string
  reviewStatus: 'pending' | 'reviewed'
  recordedAt: string
  recordedBy: string
}

/** Operational-only saves must preserve separately recorded customer outcomes. */
export function customerOutcomeFields(update: Record<string, unknown>, existing: Record<string, unknown> = {}) {
  return Object.fromEntries(Object.entries({ damage_flag: false, customer_rating: null, review_left: false, referral_generated: false, notes: null })
    .map(([key, fallback]) => [key, Object.hasOwn(update, key) ? update[key] : existing[key] ?? fallback]))
}

export function validateOperationalOutcome(value: Partial<OperationalOutcome>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Operational actuals must be an object.')
  for (const key of ['startedAt', 'finishedAt', 'actualTruck', 'inventoryChanges', 'cause', 'correctiveAction'] as const) {
    if (value[key] !== undefined && (typeof value[key] !== 'string' || value[key]!.length > 8000)) throw new Error(`${key} must be text of at most 8000 characters.`)
  }
  for (const key of ['actualHours', 'actualCrew', 'breakMinutes', 'truckSwapMinutes'] as const) {
    const n = value[key]
    if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < 0)) throw new Error(`${key} must be a finite non-negative number.`)
  }
  if (value.actualHours !== undefined && (value.actualHours <= 0 || value.actualHours > 168)) throw new Error('Actual hours must be between 0 and 168.')
  if (value.actualCrew !== undefined && (!Number.isInteger(value.actualCrew) || value.actualCrew < 1 || value.actualCrew > 50)) throw new Error('Actual crew must be a whole number from 1 to 50.')
  for (const key of ['startedAt', 'finishedAt'] as const) if (value[key] && !Number.isFinite(Date.parse(value[key]!))) throw new Error('Invalid start or finish time.')
  if (value.startedAt && value.finishedAt) {
    const elapsedMinutes = (Date.parse(value.finishedAt) - Date.parse(value.startedAt)) / 60000
    if (elapsedMinutes <= 0 || (value.breakMinutes || 0) >= elapsedMinutes) throw new Error('Finish must follow start, with breaks shorter than elapsed time.')
    const hours = (elapsedMinutes - (value.breakMinutes || 0)) / 60
    if (value.actualHours !== undefined && Math.abs(hours - value.actualHours) > 0.25) throw new Error('Actual hours differ from start/finish minus breaks by more than 15 minutes.')
  }
  if (value.assemblyActuals !== undefined && !Array.isArray(value.assemblyActuals)) throw new Error('Assembly actuals must be a list.')
  for (const item of value.assemblyActuals || []) {
    if (!item || typeof item.item !== 'string' || !item.item.trim() || ![item.originMinutes, item.destinationMinutes, item.workers].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) || !Number.isInteger(item.workers) || item.workers < 1 || item.workers > 50) throw new Error('Each assembly record needs an item, valid minutes at both ends and a positive whole worker count.')
  }
  if (value.reviewStatus && !['pending', 'reviewed'].includes(value.reviewStatus)) throw new Error('Invalid operational review status.')
  if (value.reviewStatus === 'reviewed' && (!value.actualHours || !value.actualCrew || !value.actualTruck?.trim() || !value.cause?.trim() || !value.correctiveAction?.trim())) throw new Error('To close the review, record actual hours, crew, truck (or no truck), findings and corrective action.')
}

export function outcomeReviewReasons(estimatedHours?: number, outcome?: OperationalOutcome) {
  if (!outcome?.actualHours || !outcome.actualCrew) return ['Actual crew and working hours have not been recorded.']
  const reasons: string[] = []
  if (estimatedHours && outcome.actualHours > estimatedHours + Math.max(0.5, estimatedHours * 0.2)) reasons.push(`Time overrun: ${outcome.actualHours}h actual versus ${estimatedHours}h planned.`)
  if (outcome.truckSwapMinutes) reasons.push(`Truck exchange cost ${outcome.truckSwapMinutes} minutes of elapsed time.`)
  if (!outcome.actualTruck) reasons.push('Actual truck is not recorded.')
  if (outcome.inventoryChanges?.trim()) reasons.push('Inventory differences need reconciliation against the confirmed scope.')
  if (reasons.length && outcome.reviewStatus !== 'reviewed') reasons.push('Operations must record the cause and corrective action; customer satisfaction does not close this review.')
  return reasons
}
