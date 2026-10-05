import { normalizeLead } from './sales'
import type { CRMLead } from './types'

export interface AdditionalJobInput {
  requestId: string
  kind: 'supplement' | 'separate'
  label: string
  originAddress?: string
  destAddress?: string
  moveDate?: string
  scope: string
}

export function buildAdditionalJob(parent: CRMLead, input: AdditionalJobInput, id: string): CRMLead {
  if (!parent.quoteId) throw new Error('Create the original quote first.')
  if (!['supplement', 'separate'].includes(input.kind)) throw new Error('Choose same move or separate booking.')
  if (!input.label?.trim() || !input.scope?.trim()) throw new Error('Enter a label and the additional work requested.')
  // Deliberate allowlist: no inventory, pricing, payments, acceptance, access
  // confirmations, automations or date/address assumptions from the booked job.
  return normalizeLead({
    id, name: parent.name, phone: parent.phone, email: parent.email,
    branch: parent.branch, assignedRep: parent.assignedRep,
    assignedRepName: parent.assignedRepName, assignedRepUserId: parent.assignedRepUserId,
    parentLeadId: parent.id, parentQuoteId: parent.quoteId,
    additionalJobKind: input.kind, additionalJobLabel: input.label.trim().slice(0, 100),
    source: 'other', sourceDetail: 'Additional work for an existing customer',
    stage: 'new', moveType: 'residential', quoteType: 'standard',
    originAddress: input.originAddress?.trim().slice(0, 500) || undefined,
    destAddress: input.destAddress?.trim().slice(0, 500) || undefined,
    moveDate: input.moveDate || undefined,
    notes: input.scope.trim().slice(0, 4000), inventory: [],
    createdAt: new Date().toISOString(),
  })
}
