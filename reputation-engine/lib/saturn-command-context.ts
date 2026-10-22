import { projectRelationship, hasAcceptedOutboundEvidence, RELATIONSHIP_PROJECTION_VERSION } from './relationship-state'
export type SaturnContextRow = Record<string, any>

function text(value: unknown) { return String(value || '').replace(/\s+/g, ' ').trim() }

export function buildSaturnCommandContext(input: {
  generatedAt: string
  contacts: SaturnContextRow[]
  touches: SaturnContextRow[]
  tasks: SaturnContextRow[]
  jobs: SaturnContextRow[]
  referrals?: SaturnContextRow[]
  coverage?: { complete: boolean; readStartedAt: string; scope: string }
}) {
  const contacts = new Map(input.contacts.map(c => [c.id, c]))
  const touches = input.touches.filter(t => contacts.has(t.contact_id))
  const latestInbound = new Map<string, SaturnContextRow>()
  const latestOutbound = new Map<string, SaturnContextRow>()
  for (const touch of touches.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    if (touch.direction === 'inbound' && text(touch.notes)) latestInbound.set(touch.contact_id, touch)
    if (hasAcceptedOutboundEvidence(touch)) latestOutbound.set(touch.contact_id, touch)
  }
  const needsReply = [...latestInbound.entries()]
    .filter(([id, inbound]) => !latestOutbound.get(id) || Date.parse(inbound.created_at) > Date.parse(latestOutbound.get(id)!.created_at))
    .map(([id, inbound]) => {
      const c = contacts.get(id)!
      return { id, name: c.name || null, company: c.company || null, city: c.city || null, inbound: text(inbound.notes).slice(0, 420), receivedAt: inbound.created_at }
    })
  const unresolved = touches.filter(t => t.direction === 'outbound' && /\{\{?\s*(first|firstName|city|company|name)\s*\}?\}/i.test(t.notes || ''))
    .map(t => ({ id: t.id, contactId: t.contact_id, createdAt: t.created_at, excerpt: text(t.notes).slice(0, 240) }))
  const scopedTasks = input.tasks.filter(t => contacts.has(t.related_id) && ['partner', 'relationship'].includes(t.related_type))
  const openTasks = scopedTasks.filter(t => ['open', 'in_progress'].includes(String(t.status))).map(t => ({ id: t.id, title: t.title, dueAt: t.due_at || null, relatedId: t.related_id || null }))
  const group = (rows: SaturnContextRow[], key: string) => {
    const map = new Map<string, SaturnContextRow[]>()
    for (const row of rows) { const list = map.get(row[key]) || []; list.push(row); map.set(row[key], list) }
    return map
  }
  const touchGroups = group(touches, 'contact_id')
  const taskGroups = group(scopedTasks, 'related_id')
  const referralGroups = group(input.referrals || [], 'contact_id')
  const relationships = [...contacts.values()].map(contact => projectRelationship({
    contact, touches: touchGroups.get(contact.id) || [], tasks: taskGroups.get(contact.id) || [], referrals: referralGroups.get(contact.id) || [],
  }))
  const constructive = relationships.filter(r => r.constructiveCandidate)
  const constructiveQueue = constructive.map(relationship => {
    const obligations = relationship.openObligations
    const group = obligations.some(t => t.owner) ? 'assigned_work' :
      obligations.length && obligations.every(t => t.dueAt && Date.parse(t.dueAt) > Date.parse(input.generatedAt)) ? 'waiting_for_timing' :
      obligations.length ? 'open_obligation' : 'contextual_review'
    return { ...relationship, group, autonomy: 'review_only' }
  })
  return {
    generatedAt: input.generatedAt,
    projectionVersion: RELATIONSHIP_PROJECTION_VERSION,
    coverage: input.coverage || { complete: false, scope: 'caller_supplied' },
    evidenceScope: {
      included: ['market_contacts', 'market_touches', 'crm_tasks', 'sequence_jobs', ...(input.referrals ? ['partner_referrals'] : [])],
      notJoined: ['sales_communication_history', 'appointments', 'market_signals', 'provider_health', 'job_revenue_and_profit'],
      consistency: 'nontransactional_read',
    },
    policy: { version: null, authority: 'existing_send_gate', sendAuthorization: false },
    system: { sms: 'not_checked', email: 'not_checked', durableState: 'crm' },
    counts: {
      contacts: contacts.size,
      touches: touches.length,
      inbound: touches.filter(t => t.direction === 'inbound').length,
      outbound: touches.filter(t => t.direction === 'outbound').length,
      needsReply: needsReply.length,
      openTasks: openTasks.length,
      pendingJobs: input.jobs.filter(j => contacts.has(j.contact_id) && j.status === 'pending').length,
      incidents: unresolved.length,
      constructiveNotQualified: constructive.length,
      partnerQualified: relationships.filter(r => r.qualification === 'partner_qualified').length,
      unclassified: relationships.filter(r => r.qualification === 'unclassified').length,
      producingPartners: relationships.filter(r => ['producing_partner', 'repeat_partner'].includes(r.production)).length,
    },
    needsReply: needsReply.slice(0, 50),
    incidents: unresolved.slice(0, 50),
    openTasks: openTasks.slice(0, 100),
    relationships,
    constructiveQueue,
    presentationTruncated: { needsReply: needsReply.length > 50, incidents: unresolved.length > 50, openTasks: openTasks.length > 100 },
  }
}
