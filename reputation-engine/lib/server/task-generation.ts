import { deriveOperatingExceptions } from '../job-spine'
import type { CRMLead, CRMQuote } from '../types'
import type { CRMTask } from '../tasks'

function dueAtForException(urgent: boolean) {
  const date = new Date()
  if (urgent) date.setHours(date.getHours() + 2)
  else {
    if (date.getHours() >= 17) date.setDate(date.getDate() + 1)
    date.setHours(17, 0, 0, 0)
  }
  return date.toISOString()
}

export function generateConditionTasks(leads: CRMLead[], quotes: CRMQuote[], now = new Date()): CRMTask[] {
  const quoteById = new Map(quotes.map(quote => [quote.id, quote]))
  const tasks: CRMTask[] = leads.flatMap(lead => deriveOperatingExceptions(lead, lead.quoteId ? quoteById.get(lead.quoteId) : null).map(item => ({
    id: `task_${crypto.randomUUID()}`,
    title: item.title,
    description: `${item.detail} Next action: ${item.action}.`,
    status: 'open' as const,
    priority: item.severity === 'urgent' ? 'urgent' as const : 'high' as const,
    category: item.environment.toLowerCase().replaceAll(' ', '_').replaceAll('&', 'and'),
    dueAt: dueAtForException(item.severity === 'urgent'),
    ownerUserId: lead.assignedRepUserId,
    ownerName: lead.assignedRepName || lead.assignedRep,
    branch: lead.branch,
    relatedType: 'lead' as const,
    relatedId: lead.id,
    relatedLabel: lead.name,
    source: 'condition' as const,
    sourceKey: `operating-exception:${item.id}`,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  })))
  for (const lead of leads) {
    if (lead.followUpDate && !['booked', 'completed', 'customer_success', 'lost'].includes(lead.stage)) {
      tasks.push({
        id: `task_${crypto.randomUUID()}`, title: lead.followUpNote?.trim() || 'Follow up with lead',
        description: `Continue the conversation with ${lead.name} and document the outcome and next commitment.`,
        status: 'open', priority: new Date(lead.followUpDate).getTime() < now.getTime() ? 'urgent' : 'normal', category: 'sales',
        dueAt: new Date(`${lead.followUpDate.slice(0, 10)}T14:00:00.000Z`).toISOString(), ownerUserId: lead.assignedRepUserId,
        ownerName: lead.assignedRepName || lead.assignedRep, branch: lead.branch, relatedType: 'lead', relatedId: lead.id,
        relatedLabel: lead.name, source: 'stage', sourceKey: `lead-follow-up:${lead.id}:${lead.followUpDate.slice(0, 10)}`,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      })
    }
    if (lead.tentativeReservationStatus === 'active' && lead.tentativeDecisionDate) {
      tasks.push({
        id: `task_${crypto.randomUUID()}`, title: 'Convert or release tentative reservation',
        description: `Confirm ${lead.name}'s decision, document the outcome, and either secure the deposit or release the courtesy hold.`,
        status: 'open', priority: new Date(lead.tentativeDecisionDate).getTime() < now.getTime() ? 'urgent' : 'high', category: 'sales',
        dueAt: new Date(`${lead.tentativeDecisionDate.slice(0, 10)}T14:00:00.000Z`).toISOString(), ownerUserId: lead.assignedRepUserId,
        ownerName: lead.assignedRepName || lead.assignedRep, branch: lead.branch, relatedType: 'lead', relatedId: lead.id,
        relatedLabel: lead.name, source: 'stage', sourceKey: `tentative-decision:${lead.id}:${lead.tentativeDecisionDate.slice(0, 10)}`,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      })
    }
  }
  return tasks
}
