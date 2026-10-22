import type { SessionPayload } from '../auth'
import type { RelationshipEvidenceRow as Row } from '../relationship-state'
import { buildSaturnCommandContext } from '../saturn-command-context'
import { planRelationshipActions, referralOutcomes, relationshipMomentum, relationshipExperiment, RELATIONSHIP_POLICY } from '../relationship-development'
import { requireSupabaseEnv } from './runtime'
import { readCompleteRest } from './read-complete-rest'
import { partnershipScopeFilter, partnershipRecordMatchesSession, canSeeAllPartnershipMarkets } from './partnership-access'

export async function loadRelationshipIntelligence(session: SessionPayload, contactId?: string) {
  const { url, headers } = requireSupabaseEnv()
  const errors: { source: string; error: string }[] = []
  async function read(table: string, query = '', key = 'id') {
    try { return await readCompleteRest<Row & { id: string }>(`${url}/rest/v1/${table}?select=*${query}`, headers, fetch, 100000, key) }
    catch (error) { errors.push({ source: table, error: error instanceof Error ? error.message : 'Read failed' }); return [] }
  }
  const scope = partnershipScopeFilter(session, ['city'], true).replace('id.eq.__no_partnership_market__', 'id.is.null')
  const contacts = (await read('market_contacts', scope + (contactId ? `&id=eq.${encodeURIComponent(contactId)}` : ''))).filter(c => partnershipRecordMatchesSession(session, c))
  const ids = new Set(contacts.map(c => c.id))
  async function related(table: string, field: string, extra = '', key = 'id') {
    if (!contacts.length) return []
    if (canSeeAllPartnershipMarkets(session) && !contactId) return read(table, extra, key)
    const rows: Row[] = []
    for (let i = 0; i < contacts.length; i += 100) rows.push(...await read(table, `&${field}=in.(${contacts.slice(i, i + 100).map(c => encodeURIComponent(c.id)).join(',')})${extra}`, key))
    return rows
  }
  const [touchRows, taskRows, referralRows, appointments, listings, logs, decisions] = await Promise.all([
    related('market_touches', 'contact_id'), related('crm_tasks', 'related_id', '&related_type=in.(partner,relationship)'),
    related('partner_referrals', 'contact_id'), related('market_appointments', 'contact_id'),
    related('partner_listing_activity', 'contact_id', '', 'activity_key'), related('partner_activity_logs', 'contact_id'),
    related('saturn_ai_decisions', 'contact_id'),
  ])
  const touches = touchRows.filter(t => ids.has(t.contact_id))
  const tasks = taskRows.filter(t => ids.has(t.related_id))
  const referrals = referralRows.filter(t => ids.has(t.contact_id))
  async function byKeys(table: string, field: string, values: string[], extra = '') {
    const rows: Row[] = []
    const unique = [...new Set(values.filter(Boolean))]
    for (let i = 0; i < unique.length; i += 100) rows.push(...await read(table, `&${field}=in.(${unique.slice(i, i + 100).map(encodeURIComponent).join(',')})${extra}`))
    return rows
  }
  const leads = await byKeys('crm_leads', 'id', referrals.map(r => r.crm_lead_id), '&deleted=eq.false')
  const [quotes, costs, salesSms, salesEmails, calls] = await Promise.all([
    byKeys('crm_quotes', 'id', leads.map(l => l.data?.quoteId), '&deleted=eq.false'),
    byKeys('job_costs', 'lead_id', leads.map(l => l.id)),
    byKeys('sms_messages', 'lead_id', leads.map(l => l.id)),
    byKeys('crm_emails', 'data->>leadId', leads.map(l => l.id), '&deleted=eq.false'),
    byKeys('call_recordings', 'lead_id', leads.map(l => l.id)),
  ])
  const now = new Date().toISOString()
  const signals: Row[] = listings.filter(l => ids.has(l.contact_id)).map(l => ({ id: l.activity_key, source: 'partner_listing_activity', contact_id: l.contact_id,
    kind: 'listing_activity', occurred_at: l.observed_at, relevant: l.match_status === 'matched' || l.match_status === 'existing' }))
  for (const r of referrals) {
    signals.push({ id: r.id, source: 'partner_referrals', contact_id: r.contact_id, kind: 'referral', occurred_at: r.created_at, relevant: true })
    const lead = leads.find(l => l.id === r.crm_lead_id)?.data
    if (lead && ['completed', 'customer_success'].includes(lead.stage)) signals.push({ id: r.crm_lead_id, source: 'crm_leads', contact_id: r.contact_id, kind: 'job_completed', occurred_at: lead.completedAt || lead.updatedAt, relevant: true })
  }
  // Explicitly linked fulfilment receipts augment context without copying or rewriting messages.
  for (const log of logs.filter(l => l.action === 'relationship.fulfilment' && ids.has(l.contact_id))) {
    const receipt = touches.find(t => t.id === log.metadata?.receipt_touch_id && t.contact_id === log.contact_id)
    if (receipt) touches.push({ ...receipt, metadata: { ...receipt.metadata, relationship_fulfilment: log.metadata } })
  }
  const context = buildSaturnCommandContext({ generatedAt: now, contacts, touches: touchRows.filter(t => ids.has(t.contact_id)), tasks, jobs: [], referrals,
    coverage: { complete: errors.length === 0, readStartedAt: now, scope: 'authorized_relationship_intelligence' } })
  const group = (rows: Row[], field: string) => { const map = new Map<string, Row[]>(); for (const row of rows) { const list = map.get(row[field]) || []; list.push(row); map.set(row[field], list) } return map }
  const tg = group(touches, 'contact_id'), ag = group(tasks, 'related_id'), rg = group(referrals, 'contact_id'), mg = group(appointments, 'contact_id'), sg = group(signals, 'contact_id')
  const actions = contacts.flatMap(contact => planRelationshipActions({ contact, touches: tg.get(contact.id) || [], tasks: ag.get(contact.id) || [], referrals: rg.get(contact.id) || [], appointments: mg.get(contact.id) || [], signals: sg.get(contact.id) || [], now }))
  const momentum = contacts.map(c => ({ contactId: c.id, ...relationshipMomentum({ touches: tg.get(c.id) || [], tasks: ag.get(c.id) || [], referrals: rg.get(c.id) || [], appointments: mg.get(c.id) || [], now }) }))
  const outcomes = referralOutcomes(referrals, leads, quotes, costs)
  const corrections = logs.filter(l => l.action === 'relationship.ai_correction' && ids.has(l.contact_id))
  const cohorts = new Map<string, Row>()
  for (const contact of contacts) {
    const key = `${contact.city || 'Unknown'} / ${contact.industry || 'Unknown'}`
    const cohort = cohorts.get(key) || { segment: key, contactIds: [], contactedIds: [], deliveredIds: [], responderIds: [], qualifiedIds: [], referralIds: [], completedLeadIds: [], suppressedIds: [] }
    const ct = tg.get(contact.id) || []
    cohort.contactIds.push(contact.id)
    if (ct.some(t => t.direction === 'outbound')) cohort.contactedIds.push(contact.id)
    if (ct.some(t => t.direction === 'outbound' && ['delivered', 'read'].includes(t.metadata?.delivery_status || t.metadata?.provider_status || t.metadata?.status))) cohort.deliveredIds.push(contact.id)
    if (ct.some(t => t.direction === 'inbound')) cohort.responderIds.push(contact.id)
    const state = context.relationships.find(r => r.contactId === contact.id)
    if (state?.qualification === 'partner_qualified') cohort.qualifiedIds.push(contact.id)
    if (state?.contactability === 'suppressed') cohort.suppressedIds.push(contact.id)
    cohort.referralIds.push(...(rg.get(contact.id) || []).map(r => r.id))
    cohort.completedLeadIds.push(...outcomes.filter(o => o.contactId === contact.id && o.completed).map(o => o.leadId))
    cohorts.set(key, cohort)
  }
  return { policyVersion: RELATIONSHIP_POLICY, generatedAt: now, coverage: { complete: !errors.length, errors, transactional: false }, contacts, context,
    actions: actions.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)), momentum, outcomes,
    cohorts: [...cohorts.values()].map(c => ({ ...c, responseRate: c.contactedIds.length ? c.responderIds.filter((id: string) => c.contactedIds.includes(id)).length / c.contactedIds.length : null,
      denominator: 'unique_contacts_with_recorded_outbound_all_time', actualGrossProfitCents: null })),
    learning: { decisions: decisions.filter(d => ids.has(d.contact_id)), corrections, automaticPromotion: false },
    experiments: contacts.map(c => ({ contactId: c.id, ...relationshipExperiment(c) })),
    history: { touches: touchRows.filter(t => ids.has(t.contact_id)), appointments: appointments.filter(a => ids.has(a.contact_id)), salesSms, salesEmails, calls },
    sourceData: { tasks, referrals, leads, quotes, costs, logs },
  }
}
