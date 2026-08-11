import { requireSupabaseEnv } from '@/lib/server/runtime'
import { calculatePartnerScore, deriveComplianceState, tierForScore } from '@/lib/partner-platform'
import bcrypt from 'bcryptjs'

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init?.headers || {}) }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Partner platform storage failed (${response.status}): ${await response.text()}`)
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export async function getPartner360(partnerId: string) {
  const q = encodeURIComponent(partnerId)
  const [partnerRows, members, vehicles, availability, documents, assignments, ledger, claims, correctiveActions, rates, audits, rules] = await Promise.all([
    rest<any[]>(`subcontractors?select=*&id=eq.${q}&limit=1`), rest<any[]>(`partner_members?select=*&subcontractor_id=eq.${q}&order=name.asc`),
    rest<any[]>(`partner_vehicles?select=*&subcontractor_id=eq.${q}&order=unit_code.asc`), rest<any[]>(`partner_availability?select=*&subcontractor_id=eq.${q}&order=starts_at.asc&limit=200`),
    rest<any[]>(`partner_documents?select=*&subcontractor_id=eq.${q}&order=expires_at.asc.nullslast`), rest<any[]>(`partner_job_assignments?select=*&subcontractor_id=eq.${q}&order=expected_start.desc&limit=200`),
    rest<any[]>(`partner_ledger_entries?select=*&subcontractor_id=eq.${q}&order=effective_at.desc&limit=500`), rest<any[]>(`partner_claims?select=*&subcontractor_id=eq.${q}&order=opened_at.desc&limit=100`),
    rest<any[]>(`partner_corrective_actions?select=*&subcontractor_id=eq.${q}&order=opened_at.desc&limit=100`), rest<any[]>(`partner_rate_versions?select=*&subcontractor_id=eq.${q}&order=effective_from.desc`),
    rest<any[]>(`partner_audit_events?select=*&subcontractor_id=eq.${q}&order=created_at.desc&limit=200`), rest<any[]>('partner_compliance_rules?select=*&active=eq.true&order=label.asc'),
  ])
  const partner = partnerRows[0]
  if (!partner) return null
  const jurisdiction = partner.home_market?.toLowerCase().includes('ontario') ? 'CA-ON' : 'CA-ON'
  const applicableRules = rules.filter(rule => rule.jurisdiction === jurisdiction)
  const compliance = applicableRules.map(rule => { const document = documents.find(item => item.document_type === rule.document_type); return { ...rule, document, state: deriveComplianceState({ required: rule.required, status: document?.status, expiresAt: document?.expires_at }) } })
  const completed = assignments.filter(item => item.status === 'completed').length || Number(partner.completed_jobs || 0)
  const cancelled = assignments.filter(item => item.status === 'cancelled').length || Number(partner.cancelled_jobs || 0)
  const metrics = { onTimeRate: Number(partner.on_time_rate ?? .75), acceptanceRate: Number(partner.acceptance_rate ?? .7), cancellationRate: completed + cancelled ? cancelled / (completed + cancelled) : .1, customerRating: Number(partner.average_rating || 4), claimsRate: completed ? claims.length / completed : 0, communicationRate: Number(partner.communication_rate ?? .8), complianceRate: compliance.length ? compliance.filter(item => item.state === 'compliant' || item.state === 'warning').length / compliance.length : 0 }
  const score = calculatePartnerScore(metrics)
  const balances = ledger.reduce((out, item) => { const amount = Number(item.amount || 0); out.total += amount; if (['approved','scheduled'].includes(item.state)) out.available += amount; if (['estimated','pending_completion','under_review','held'].includes(item.state)) out.pending += amount; return out }, { total: 0, available: 0, pending: 0 })
  return { partner, members, vehicles, availability, documents, compliance, assignments, ledger, claims, correctiveActions, rates, audits, performance: { metrics, score, tier: tierForScore(score) }, balances }
}

export async function createPartnerResource(partnerId: string, resource: string, input: any, actor?: { userId?: string; name?: string }) {
  const allowed: Record<string, string> = { member: 'partner_members', vehicle: 'partner_vehicles', availability: 'partner_availability', document: 'partner_documents', claim: 'partner_claims', corrective_action: 'partner_corrective_actions', rate: 'partner_rate_versions' }
  const table = allowed[resource]; if (!table) throw new Error('Unsupported partner resource')
  const rows = await rest<any[]>(table, { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...input, subcontractor_id: partnerId }) })
  await rest('partner_audit_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ subcontractor_id: partnerId, entity_type: resource, entity_id: rows[0].id, action: 'created', actor_user_id: actor?.userId || null, actor_name: actor?.name || null, next_value: rows[0] }) })
  return rows[0]
}

export async function updatePartnerResource(partnerId: string, resource: string, id: string, patch: any, actor?: { userId?: string; name?: string }) {
  const allowed: Record<string, string> = { member: 'partner_members', vehicle: 'partner_vehicles', document: 'partner_documents', claim: 'partner_claims', corrective_action: 'partner_corrective_actions', assignment: 'partner_job_assignments' }
  const table = allowed[resource]; if (!table) throw new Error('Unsupported partner resource')
  const prior = (await rest<any[]>(`${table}?select=*&id=eq.${encodeURIComponent(id)}&subcontractor_id=eq.${encodeURIComponent(partnerId)}&limit=1`))[0]
  if (!prior) throw new Error('Partner resource not found')
  const rows = await rest<any[]>(`${table}?id=eq.${encodeURIComponent(id)}&subcontractor_id=eq.${encodeURIComponent(partnerId)}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }) })
  await rest('partner_audit_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ subcontractor_id: partnerId, entity_type: resource, entity_id: id, action: 'updated', actor_user_id: actor?.userId || null, actor_name: actor?.name || null, previous_value: prior, next_value: rows[0] }) })
  return rows[0]
}

export async function createPartnerPortalUser(partnerId: string, input: { email: string; name: string; password: string; role: 'partner_admin' | 'partner_dispatcher' | 'partner_crew'; partnerMemberId?: string }, actor?: { userId?: string; name?: string }) {
  if (!['partner_admin','partner_dispatcher','partner_crew'].includes(input.role) || !input.email || !input.name || input.password.length < 10) throw new Error('Name, email, valid partner role, and a 10+ character temporary password are required.')
  const rows = await rest<any[]>('app_users', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ email: input.email.toLowerCase().trim(), name: input.name.trim(), password_hash: await bcrypt.hash(input.password, 12), role: input.role, partner_id: partnerId, partner_member_id: input.partnerMemberId || null }) })
  await rest('partner_audit_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ subcontractor_id: partnerId, entity_type: 'portal_user', entity_id: rows[0].id, action: 'access_created', actor_user_id: actor?.userId || null, actor_name: actor?.name || null, next_value: { email: rows[0].email, name: rows[0].name, role: rows[0].role } }) })
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, role: rows[0].role }
}
