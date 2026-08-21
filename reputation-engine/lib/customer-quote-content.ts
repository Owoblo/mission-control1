import type { CustomerQuoteScope, InventoryItem, JobFactors } from './types'

const INTERNAL_QUOTE_SENTENCE_PATTERNS = [
  /\b(?:current|projected|gross|net|live)\s+margin\b/i,
  /\bmargin\s+(?:is|review|approval|gate|threshold)\b/i,
  /\bmanager\s+(?:review|approval)\b/i,
  /\bapproval\s+code\b/i,
]

/** Removes internal pricing/approval notes before text reaches a public quote. */
export function sanitizeCustomerQuoteText(value?: string | null): string | undefined {
  if (!value?.trim()) return undefined

  const cleaned = value
    .split(/(?<=[.!?])\s+|\n+/)
    .map(sentence => sentence.trim())
    .filter(Boolean)
    .filter(sentence => !INTERNAL_QUOTE_SENTENCE_PATTERNS.some(pattern => pattern.test(sentence)))
    .join(' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return cleaned || undefined
}

function itemLabel(item: InventoryItem) {
  return (item.name || item.item || 'Item').trim()
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(value => value?.trim()).filter(Boolean) as string[]))
}

const SOFT_FURNITURE = /\b(?:couch|sofa|sectional|loveseat|chair|recliner|mattress|ottoman|bench)\b/i
const CASE_FURNITURE = /\b(?:dresser|wardrobe|armoire|cabinet|table|desk|bookcase|shelf|fireplace|headboard|bed frame|nightstand|mirror|tv|television)\b/i
const BOX_OR_CONTAINER = /\b(?:box|bin|tote|carton|bag)\b/i

export function deriveWrappingItems(inventory: InventoryItem[]) {
  return unique(inventory
    .filter(item => item.included !== false && item.status !== 'excluded')
    .filter(item => {
      const label = itemLabel(item)
      return !BOX_OR_CONTAINER.test(label) && (
        SOFT_FURNITURE.test(label) ||
        CASE_FURNITURE.test(label) ||
        item.handlingProfile?.fragility === 'fragile' ||
        item.handlingProfile?.fragility === 'very_fragile' ||
        item.handlingProfile?.level === 'high' ||
        item.handlingProfile?.level === 'specialty'
      )
    })
    .map(itemLabel))
}

export function buildCustomerQuoteScope(params: {
  inventory: InventoryItem[]
  jobFactors?: JobFactors
  assemblyItems?: string[]
  customerHandledAssemblyItems?: string[]
  specialtyItems?: string[]
  capturedAt?: string
}): CustomerQuoteScope {
  const inventory = params.inventory
    .filter(item => item.included !== false && item.status !== 'excluded')
    .map(item => ({ ...item }))
  const serviceNotes = unique([
    params.jobFactors?.originHasElevator ? 'Origin elevator access included in the move plan' : null,
    params.jobFactors?.destHasElevator ? 'Destination elevator access included in the move plan' : null,
    (params.jobFactors?.originFloors || 0) > 1 ? `${params.jobFactors?.originFloors}-floor origin access included` : null,
    (params.jobFactors?.destFloors || 0) > 1 ? `${params.jobFactors?.destFloors}-floor destination access included` : null,
    params.jobFactors?.estimatedBoxes ? `${params.jobFactors.estimatedBoxes} boxes included in the planned scope` : null,
    params.jobFactors?.specialtyNotes,
  ])

  return {
    version: 1,
    capturedAt: params.capturedAt || new Date().toISOString(),
    inventory,
    assemblyMode: params.jobFactors?.disassemblyMode || 'both',
    assemblyItems: unique(params.assemblyItems || []),
    customerHandledAssemblyItems: unique(params.customerHandledAssemblyItems || []),
    specialtyItems: unique(params.specialtyItems || []),
    wrappingItems: deriveWrappingItems(inventory),
    serviceNotes,
  }
}

export type CustomerCarePlan = {
  item: string
  service: string
  category: 'protection' | 'assembly' | 'specialty'
}

export function buildCustomerCarePlan(scope: CustomerQuoteScope): CustomerCarePlan[] {
  const plans: CustomerCarePlan[] = []
  const assemblyLabel = scope.assemblyMode === 'disassemble_only'
    ? 'Professional disassembly at origin'
    : scope.assemblyMode === 'reassemble_only'
      ? 'Professional reassembly and placement at destination'
      : 'Professional disassembly, transport, and reassembly'

  scope.assemblyItems.forEach(item => plans.push({ item, service: assemblyLabel, category: 'assembly' }))
  scope.specialtyItems.forEach(item => plans.push({ item, service: 'Specialty handling included in the move plan', category: 'specialty' }))
  scope.wrappingItems
    .filter(item => !scope.assemblyItems.includes(item) && !scope.specialtyItems.includes(item))
    .forEach(item => plans.push({
      item,
      service: SOFT_FURNITURE.test(item)
        ? 'Professionally blanket-wrapped and stretch-wrapped'
        : 'Blanket-wrapped, protected, and secured for transport',
      category: 'protection',
    }))
  return plans
}

/**
 * Returns only an intentional, short quote-option label for the public hero.
 * General move descriptions can contain provisional findings and must never be
 * promoted into this prominent customer-facing slot.
 */
export function getCustomerQuoteOptionLabel(input: {
  jobLabel?: string | null
  moveDescription?: string | null
}): string | undefined {
  const explicitDescriptionLabel = input.moveDescription
    ?.match(/^Quote option:\s*([^\n\r]+)/i)?.[1]
    ?.trim()
  const candidate = (input.jobLabel?.trim() || explicitDescriptionLabel || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!candidate || candidate.length > 120) return undefined
  return candidate
}
