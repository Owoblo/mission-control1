import type { SalesLeadStage } from './types'

const AUTOMATION_SUGGESTIBLE_STAGES = new Set<SalesLeadStage>([
  'new',
  'contacted',
  'estimate_scheduled',
  'estimate_completed',
  'pricing',
  'quoted',
  'nurture',
  'booked',
])

/**
 * Closing a sales lead is a human decision. Automation may surface evidence for
 * review, but it must never recommend or write `lost`.
 */
export function sanitizeAutomatedStageSuggestion(value: unknown): SalesLeadStage | undefined {
  if (typeof value !== 'string') return undefined
  return AUTOMATION_SUGGESTIBLE_STAGES.has(value as SalesLeadStage)
    ? value as SalesLeadStage
    : undefined
}
