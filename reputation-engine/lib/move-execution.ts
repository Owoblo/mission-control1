import type { MoveExecutionLog, MoveExecutionLogEntry, MoveExecutionPhase } from './types'

export const MOVE_EXECUTION_PHASES: Array<{ phase: MoveExecutionPhase; label: string }> = [
  { phase: 'crew_depart_yard', label: 'Crew departed yard' },
  { phase: 'arrive_origin', label: 'Arrived at origin' },
  { phase: 'load_complete', label: 'Loading complete' },
  { phase: 'depart_origin', label: 'Departed origin' },
  { phase: 'arrive_destination', label: 'Arrived at destination' },
  { phase: 'unload_complete', label: 'Unloading complete' },
  { phase: 'return_yard', label: 'Returned to yard' },
]

function roundQuarterHour(hours: number) {
  return Math.round(Number(hours || 0) * 4) / 4
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function buildDefaultMoveExecutionEntries(existing?: MoveExecutionLogEntry[]) {
  const byPhase = new Map((existing || []).map(entry => [entry.phase, entry]))
  return MOVE_EXECUTION_PHASES.map(({ phase, label }) => {
    const current = byPhase.get(phase)
    return {
      id: current?.id || `move_${phase}`,
      phase,
      label: current?.label || label,
      timestamp: normalizeOptionalText(current?.timestamp),
      note: normalizeOptionalText(current?.note),
      loggedAt: normalizeOptionalText(current?.loggedAt),
      loggedBy: normalizeOptionalText(current?.loggedBy),
    }
  })
}

export function deriveActualHoursFromExecutionLog(entries?: MoveExecutionLogEntry[]) {
  const normalized = buildDefaultMoveExecutionEntries(entries)
  const first = normalized.find(entry => entry.timestamp)?.timestamp
  const last = [...normalized].reverse().find(entry => entry.timestamp)?.timestamp
  if (!first || !last) return undefined
  const start = new Date(first).getTime()
  const end = new Date(last).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined
  return roundQuarterHour((end - start) / (1000 * 60 * 60))
}

export function normalizeMoveExecutionLog(
  log: MoveExecutionLog | undefined,
  options: { predictedHours?: number; actorName?: string } = {}
): MoveExecutionLog | undefined {
  if (!log) return undefined
  const entries = buildDefaultMoveExecutionEntries(log.entries)
  const actualHours = roundQuarterHour(Number(log.actualHours || deriveActualHoursFromExecutionLog(entries) || 0))
  const predictedHours = roundQuarterHour(Number(log.predictedHours || options.predictedHours || 0))
  const varianceHours = actualHours > 0 && predictedHours > 0
    ? roundQuarterHour(actualHours - predictedHours)
    : undefined

  return {
    predictedHours: predictedHours || undefined,
    actualHours: actualHours || undefined,
    varianceHours,
    varianceReason: normalizeOptionalText(log.varianceReason),
    entries: entries.some(entry => entry.timestamp || entry.note) ? entries : undefined,
    issues: log.issues?.filter(issue => issue.note?.trim()),
    receiptsNote: normalizeOptionalText(log.receiptsNote),
    customerFeedbackNote: normalizeOptionalText(log.customerFeedbackNote),
    updatedAt: new Date().toISOString(),
    updatedBy: normalizeOptionalText(options.actorName) || normalizeOptionalText(log.updatedBy),
  }
}
