export type ComplianceState = 'compliant' | 'warning' | 'expired' | 'missing'

export function deriveComplianceState(input: { required: boolean; status?: string; expiresAt?: string }, now = new Date()): ComplianceState {
  if (!input.status) return input.required ? 'missing' : 'compliant'
  if (input.status === 'expired' || (input.expiresAt && new Date(`${input.expiresAt}T23:59:59Z`).getTime() < now.getTime())) return 'expired'
  if (input.status !== 'verified') return input.required ? 'missing' : 'compliant'
  if (input.expiresAt) {
    const days = (new Date(`${input.expiresAt}T23:59:59Z`).getTime() - now.getTime()) / 86_400_000
    if (days <= 60) return 'warning'
  }
  return 'compliant'
}

export function detectAssignmentConflicts(input: {
  startsAt: string; endsAt: string; memberIds: string[]; vehicleIds: string[]
  assignments: Array<{ id: string; startsAt?: string; endsAt?: string; memberIds: string[]; vehicleIds: string[]; status: string }>
}) {
  const start = new Date(input.startsAt).getTime(); const end = new Date(input.endsAt).getTime()
  return input.assignments.flatMap(item => {
    if (['cancelled', 'completed'].includes(item.status) || !item.startsAt || !item.endsAt) return []
    const overlaps = start < new Date(item.endsAt).getTime() && end > new Date(item.startsAt).getTime()
    if (!overlaps) return []
    const crews = input.memberIds.filter(id => item.memberIds.includes(id))
    const vehicles = input.vehicleIds.filter(id => item.vehicleIds.includes(id))
    return [...crews.map(id => ({ assignmentId: item.id, resourceType: 'member' as const, resourceId: id })), ...vehicles.map(id => ({ assignmentId: item.id, resourceType: 'vehicle' as const, resourceId: id }))]
  })
}

export function calculatePartnerScore(metrics: { onTimeRate?: number; acceptanceRate?: number; cancellationRate?: number; customerRating?: number; claimsRate?: number; communicationRate?: number; complianceRate?: number }) {
  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  const score =
    clamp(metrics.onTimeRate ?? .75) * 25 + clamp(metrics.acceptanceRate ?? .7) * 10 +
    (1 - clamp(metrics.cancellationRate ?? .1)) * 15 + clamp((metrics.customerRating ?? 4) / 5) * 20 +
    (1 - clamp(metrics.claimsRate ?? .05)) * 10 + clamp(metrics.communicationRate ?? .8) * 10 +
    clamp(metrics.complianceRate ?? 0) * 10
  return Math.round(score)
}

export function tierForScore(score: number) {
  if (score >= 93) return 'premier'
  if (score >= 85) return 'preferred'
  if (score >= 70) return 'standard'
  return 'trial'
}
