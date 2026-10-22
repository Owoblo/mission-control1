export type PortalRole = 'partner_admin' | 'partner_dispatcher' | 'partner_crew'
export function isPortalRole(role?: string): role is PortalRole {
  return ['partner_admin', 'partner_dispatcher', 'partner_crew'].includes(role || '')
}
const fields: Record<string, string[]> = {
  member: ['name','phone','email','role','status','is_driver','experience_years'],
  vehicle: ['unit_code','vehicle_type','size_label','ownership','status','insurance_expires_at'],
  availability: ['member_id','vehicle_id','starts_at','ends_at','availability','note'],
  document: ['jurisdiction','document_type','provider','coverage_amount','effective_at','expires_at'],
  claim: ['lead_id','title','description','severity'],
  assignment: ['status'],
}
const enums: Record<string, string[]> = {
  'member.role': ['owner_admin','dispatcher_manager','crew_lead','driver','mover'],
  'member.status': ['invited','active','inactive'],
  'vehicle.status': ['active','maintenance','unavailable','inactive'],
  'vehicle.ownership': ['partner_owned','rented','leased'],
  'availability.availability': ['available','limited','unavailable'],
  'claim.severity': ['level_1','level_2','level_3','level_4'],
}
const transitions: Record<string, string[]> = {
  assigned: ['confirmed'], confirmed: ['preparing','en_route'], preparing: ['en_route'], en_route: ['arrived'],
  arrived: ['in_progress'], in_progress: ['completed'], completed: [], cancelled: [], no_show: [],
}
export function portalMutation(resource: string, value: unknown, role: PortalRole, method: 'POST' | 'PATCH', prior?: Record<string, any>) {
  const allowed = role === 'partner_admin' ? Object.keys(fields) : role === 'partner_dispatcher' ? ['availability','claim','assignment'] : ['claim','assignment']
  if (!allowed.includes(resource) || (method === 'POST' && resource === 'assignment')) throw new Error('Resource not permitted')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Object required')
  const input = value as Record<string, unknown>
  if (!Object.keys(input).length) throw new Error('Empty update')
  for (const [key, val] of Object.entries(input)) {
    if (!fields[resource].includes(key) || (method === 'PATCH' && ['lead_id','member_id','vehicle_id'].includes(key))) throw new Error('Field not permitted')
    if (val !== null && !['string','number','boolean'].includes(typeof val)) throw new Error('Invalid field value')
    if (typeof val === 'string' && val.length > 5000) throw new Error('Field too long')
    if (typeof val === 'number' && (!Number.isFinite(val) || val < 0)) throw new Error('Invalid number')
    if (enums[`${resource}.${key}`] && !enums[`${resource}.${key}`].includes(String(val))) throw new Error('Invalid choice')
  }
  if (method === 'PATCH' && resource === 'member' && prior?.status === 'restricted') throw new Error('Restricted members require internal review')
  if (resource === 'assignment') {
    if (!prior || typeof input.status !== 'string' || (input.status !== prior.status && !transitions[prior.status]?.includes(input.status))) throw new Error('Assignment transition not permitted')
  }
  if (resource === 'claim' && method === 'PATCH' && prior?.status !== 'reported') throw new Error('Claim is already under review')
  if (resource === 'document' && method === 'PATCH' && !['requested','submitted','rejected','expired'].includes(prior?.status)) throw new Error('Document is under review')
  return { ...input, ...(method === 'POST' && resource === 'claim' ? { status: 'reported' } : {}),
    ...(resource === 'document' ? { status: 'submitted' } : {}) }
}
function pick(row: any, keys: string[]) { return Object.fromEntries(keys.filter(k => row?.[k] !== undefined).map(k => [k, row[k]])) }
const readFields: Record<string, string[]> = {
  member: ['id','name','phone','email','role','status','is_driver','approved_for_jobs','experience_years'],
  vehicle: ['id','unit_code','vehicle_type','size_label','ownership','status','insurance_verified','insurance_expires_at','brand_compliant'],
  availability: ['id','member_id','vehicle_id','starts_at','ends_at','availability','note'],
  document: ['id','document_type','status','provider','effective_at','expires_at'],
  claim: ['id','claim_code','lead_id','title','description','severity','status','opened_at','customer_visible_summary'],
  assignment: ['id','lead_id','role','status','expected_start','version','acknowledged_version','member_ids','vehicle_ids'],
}
export function portalResource(resource: string, row: any) { return pick(row, readFields[resource] || []) }
export function portalView(data: any, role: PortalRole, memberId?: string | null) {
  if (role === 'partner_crew' && !memberId) throw new Error('Crew member identity required')
  const assignments = data.assignments.filter((x: any) => role !== 'partner_crew' || x.member_ids?.includes(memberId))
  const leadIds = new Set(assignments.map((x: any) => x.lead_id))
  const admin = role === 'partner_admin'
  return {
    partner: pick(data.partner, ['id','company_name','partner_code','lifecycle_status','tier','home_market']),
    assignments: assignments.map((x: any) => portalResource('assignment', x)),
    members: data.members.filter((x: any) => role !== 'partner_crew' || x.id === memberId).map((x: any) => portalResource('member', x)),
    vehicles: data.vehicles.filter((x: any) => role !== 'partner_crew' || assignments.some((a: any) => a.vehicle_ids?.includes(x.id))).map((x: any) => portalResource('vehicle', x)),
    availability: role === 'partner_crew' ? [] : data.availability.map((x: any) => portalResource('availability', x)),
    documents: role === 'partner_crew' ? [] : data.documents.map((x: any) => portalResource('document', x)),
    compliance: role === 'partner_crew' ? [] : data.compliance.map((x: any) => ({ ...pick(x, ['id','label','state','conditional_note']), document: pick(x.document, ['expires_at']) })),
    claims: data.claims.filter((x: any) => role !== 'partner_crew' || leadIds.has(x.lead_id)).map((x: any) => portalResource('claim', x)),
    correctiveActions: [], rates: [], audits: [],
    ledger: admin ? data.ledger.map((x: any) => pick(x, ['id','effective_at','description','entry_type','state','amount','currency'])) : [],
    balances: admin ? pick(data.balances, ['total','available','pending']) : undefined,
    performance: { ...pick(data.performance, ['score','tier']), metrics: pick(data.performance?.metrics, ['onTimeRate','acceptanceRate','cancellationRate','customerRating','claimsRate','communicationRate','complianceRate']) },
  }
}
