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
  leads = leads.filter(lead => lead.stage !== 'lost')
  const quoteById = new Map(quotes.map(quote => [quote.id, quote]))
  const tasks: CRMTask[] = leads.filter(lead => lead.stage !== 'nurture').flatMap(lead => deriveOperatingExceptions(lead, lead.quoteId ? quoteById.get(lead.quoteId) : null).map(item => ({
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
    if (lead.stage === 'nurture' && lead.followUpDate) {
      tasks.push({
        id: `task_${crypto.randomUUID()}`, title: lead.followUpNote?.trim() || 'Nurture check-in due',
        description: `Check in with ${lead.name}, record the conversation, and set the next nurture date.`,
        status: 'open', priority: new Date(lead.followUpDate).getTime() < now.getTime() ? 'urgent' : 'normal', category: 'nurture',
        dueAt: new Date(`${lead.followUpDate.slice(0, 10)}T14:00:00.000Z`).toISOString(), ownerUserId: lead.assignedRepUserId,
        ownerName: lead.assignedRepName || lead.assignedRep, branch: lead.branch, relatedType: 'lead', relatedId: lead.id,
        relatedLabel: lead.name, source: 'stage', sourceKey: `lead-nurture-check-in:${lead.id}:${lead.followUpDate.slice(0, 10)}`,
        createdAt: now.toISOString(), updatedAt: now.toISOString(),
      })
    } else if (lead.followUpDate && !['booked', 'completed', 'customer_success', 'lost'].includes(lead.stage)) {
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

export function isLeadTaskCurrent(task: CRMTask, lead?: CRMLead) {
  if (task.relatedType !== 'lead' || !lead || !['open', 'in_progress'].includes(task.status)) return true
  if (lead.stage === 'lost') return false
  if (task.sourceKey?.startsWith('lead-follow-up:')) return lead.stage !== 'nurture' && task.sourceKey === `lead-follow-up:${lead.id}:${lead.followUpDate}`
  if (task.sourceKey?.startsWith('lead-nurture-check-in:')) return lead.stage === 'nurture' && task.sourceKey === `lead-nurture-check-in:${lead.id}:${lead.followUpDate}`
  if (lead.stage === 'nurture' && task.source === 'condition') return false
  return true
}
