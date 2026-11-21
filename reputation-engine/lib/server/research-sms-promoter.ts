import { createHash } from 'node:crypto'
import { getPartnershipSenderNumbersForMarket } from '../partnership-lines'
import {
  enqueuePreparedSms,
  type CrmRow,
  type PreparedSms,
} from './prepared-sms'
import { readCompleteRest } from './read-complete-rest'
import { normalizeMarketingPhone } from './partnership-sms'

type Route = {
  route_id?: string
  kind: string
  value: string
  source_url?: string
  proof?: string
  origin?: string
  shared_in_research_batch?: boolean
  evidence?: { url: string; context: string }[]
  role_evidence?: string
  person_name?: string
  carrier_checked_at?: string
  technical_state?: string
  carrier_number_valid?: boolean
  carrier_country?: string
  carrier_line_type?: string
}
type Draft = {
  id: string
  name: string
  holds: string[]
  cities: string[]
  body: string
  requested_action?: string
  release_evidence?: { prior_sms_touch_id?: string }
}
type Inventory = {
  id: string
  name: string
  verified_routes: Route[]
  primary_mobile_route_id?: string
  city?: string
  sector?: string
  sources?: { url: string; text?: string }[]
  context?: { business_role?: string }
}
type Agent = {
  id: string
  name: string
  brokerages: string[]
  roles?: { role: string; source_url: string; proof: string }[]
}
type Options = {
  artifactPath: string
  campaignKey: string
  approvedBy: string
  clearHolds: string[]
  releaseEvidence?: string
  execute?: boolean
  b2b?: boolean
  allowRevival?: boolean
}
function index<T extends { id: string }>(items: T[]) {
  if (!Array.isArray(items)) throw Error('Expected an artifact items array')
  const map = new Map<string, T>()
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id || map.has(item.id))
      throw Error('Missing or duplicate artifact identity')
    map.set(item.id, item)
  }
  return map
}
function strings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((s) => typeof s === 'string' && s.trim())
  )
}
function freshCanadianMobile(route: Route, now: number) {
  const age = now - Date.parse(route.carrier_checked_at || '')
  return (
    route.kind === 'phone' &&
    route.technical_state === 'canadian_mobile' &&
    route.carrier_number_valid === true &&
    route.carrier_country === 'CA' &&
    route.carrier_line_type === 'mobile' &&
    age >= 0 &&
    age < 86400000
  )
}
export function verifiedMobile(route: Route, now = Date.now()) {
  return route.shared_in_research_batch === false &&
    /^https?:\/\//.test(route.source_url || '') && freshCanadianMobile(route, now)
}
const basisHold = 'recipient_specific_release_basis_unconfirmed'
const disclosureHold = 'approved_sms_disclosure_unverified'
const revivalHolds = new Set(['copy_review', 'existing_contact_outreach_review', 'existing_sms_job', basisHold])
const publicationRestriction = /\b(?:no (?:unsolicited|solicitation|solicitations)|do not (?:send|accept) unsolicited|not accept(?:ing)? unsolicited|no sales (?:calls|messages|solicitations)|no marketing (?:calls|emails|texts|messages))\b/i

export function researchSmsRows(
  drafts: Draft[],
  inventory: Inventory[],
  agents: Agent[],
  options: Options,
  now = Date.now(),
) {
  const records = index(inventory),
    people = index(agents)
  const phoneOwners = new Map<string, Set<string>>()
  if (options.b2b) {
    for (const record of inventory) {
      for (const route of record.verified_routes.filter((route) => route.kind === 'phone')) {
        const phone = normalizeMarketingPhone(route.value)
        if (!phone) continue
        const owners = phoneOwners.get(phone) ?? new Set<string>()
        owners.add(record.id)
        phoneOwners.set(phone, owners)
      }
    }
  }
  if (options.clearHolds.length && !options.approvedBy.trim())
    throw Error('Clearing a hold requires an approver')
  const availableHolds = new Set(
    drafts.flatMap((draft) => (Array.isArray(draft.holds) ? draft.holds : [])),
  )
  for (const hold of options.clearHolds)
    if (!availableHolds.has(hold)) throw Error('Unknown clearance: ' + hold)
  const rows = []
  for (const draft of index(drafts).values()) {
    const record = records.get(draft.id),
      agent = people.get(draft.id)
    if (
      !record ||
      (!options.b2b && (!agent || !strings(agent.brokerages))) ||
      (options.b2b && (!record.city?.trim() || !record.sector?.trim())) ||
      !strings(draft.holds) ||
      !strings(draft.cities) ||
      typeof draft.body !== 'string' ||
      typeof draft.name !== 'string' ||
      !Array.isArray(record.verified_routes)
    )
      throw Error('Incomplete join for ' + draft.id)
    const normalize = (s: string) => s.trim().toLowerCase()
    if (
      [record.name, ...(options.b2b ? [] : [agent!.name])].some(
        (name) => normalize(name) !== normalize(draft.name),
      )
    )
      throw Error('Identity mismatch for ' + draft.id)
    const publicationFor = (route: Route) => {
      const phone = normalizeMarketingPhone(route.value).slice(-10)
      const publishedPhone = /^\d{10}$/.test(phone)
        ? new RegExp(`(?:^|\\D)(?:\\+?1[ .-]*)?\\(?${phone.slice(0, 3)}\\)?[ .-]*${phone.slice(3, 6)}[ .-]*${phone.slice(6)}(?!\\d)`)
        : null
      return route.evidence?.find((item) =>
        /^https?:\/\//.test(item.url) && item.context?.trim() &&
        (options.b2b || publishedPhone?.test(item.context)) &&
        record.sources?.some((source) => source.url === item.url),
      )
    }
    const routes = record.verified_routes.filter(
      (r) =>
        r.kind === 'phone' &&
        (options.b2b
          ? !!record.primary_mobile_route_id && r.route_id === record.primary_mobile_route_id
          : r.shared_in_research_batch === false && /^https?:\/\//.test(r.source_url || publicationFor(r)?.url || '') &&
            (record.primary_mobile_route_id === undefined || r.route_id === record.primary_mobile_route_id)),
    )
    const route = routes.length === 1 ? routes[0] : undefined
    const phone = route?.value || ''
    const publication = route && publicationFor(route)
    const sourceUrl = options.b2b ? publication?.url || route?.source_url : route?.source_url || publication?.url
    const verified = route && (options.b2b
      ? route.shared_in_research_batch !== true && phoneOwners.get(normalizeMarketingPhone(phone))?.size === 1 && freshCanadianMobile(route, now)
      : verifiedMobile({ ...route, source_url: sourceUrl }, now))
    const roles = Array.isArray(agent?.roles) ? agent.roles : []
    const role = roles.find(
      (r) => r?.role?.trim() && /^https?:\/\//.test(r.source_url) && r.proof?.trim(),
    )
    const savedRole = publication && record.context?.business_role?.trim() && route?.role_evidence?.trim()
      ? { role: record.context.business_role, source_url: publication.url, proof: route.role_evidence }
      : undefined
    const businessRole = options.b2b ? savedRole : role || savedRole
    const publicationProof = options.b2b ? publication?.context :
      route?.proof?.trim() || (publication?.url === sourceUrl ? publication?.context : undefined)
    const savedEvidence = verified && sourceUrl && publicationProof && businessRole
      ? {
          publication_source: sourceUrl,
          publication_proof: publicationProof,
          business_role: businessRole,
        }
      : undefined
    const allowRevival = !!options.allowRevival && !options.b2b && draft.requested_action === 'quiet_thread_revival'
    const priorSmsTouchId = allowRevival ? draft.release_evidence?.prior_sms_touch_id : undefined
    const revivalApproval = allowRevival && verified && priorSmsTouchId && options.approvedBy.trim() ? {
      method: 'approved_realtor_revival',
      mobile: normalizeMarketingPhone(phone),
      source_url: sourceUrl,
      carrier_checked_at: route.carrier_checked_at,
      content_hash: createHash('sha256').update(draft.body).digest('hex'),
      approved_by: options.approvedBy,
      prior_sms_touch_id: priorSmsTouchId,
    } : undefined
    const cleared = draft.holds.filter((hold) =>
      (revivalApproval && revivalHolds.has(hold)) ||
      (hold === basisHold && savedEvidence) ||
      (hold !== disclosureHold && !(allowRevival && revivalHolds.has(hold)) && options.clearHolds.includes(hold)),
    )
    if (cleared.includes('coordinate_single_triland_team_introduction'))
      throw Error('Select one team recipient before promotion')
    const releaseEvidence = revivalApproval ?? (cleared.includes(basisHold) && !options.releaseEvidence?.trim()
      ? savedEvidence
      : options.releaseEvidence)
    if (cleared.includes(basisHold) && !releaseEvidence)
      throw Error(
        'Record supporting release evidence before clearing the basis hold',
      )
    const reasons = draft.holds.filter((h) => !cleared.includes(h))
    if (!verified) reasons.push('verify_unique_current_mobile')
    if (options.b2b && !savedEvidence && !reasons.includes(basisHold)) reasons.push(basisHold)
    if (record.sources?.some((source) => publicationRestriction.test(source.text || '')) && !reasons.includes('published_contact_restriction')) {
      reasons.push('published_contact_restriction')
    }
    const cities = [
      ...new Set(
        draft.cities.map((c) =>
          /^London (East|South|West|North)$/i.test(c) ? 'London' : c,
        ),
      ),
    ]
    if (cities.length !== 1 || (options.b2b && normalize(cities[0] || '') !== normalize(record.city!))) reasons.push('resolve_municipality')
    if (
      !options.b2b &&
      new Set(
        agent!.brokerages.map((b) => normalize(b).replace(/\s+brokerage$/, '')),
      ).size !== 1
    )
      reasons.push('resolve_brokerage')
    const city = cities[0] || ''
    rows.push({
      contactName: options.b2b ? route?.person_name : draft.name,
      company: options.b2b ? record.name : agent!.brokerages[0] || '',
      city,
      category: options.b2b ? record.sector! : 'Realtor',
      phone,
      sender: getPartnershipSenderNumbersForMarket(city)[0] || '',
      body: draft.body,
      reviewReasons: reasons,
      ...(allowRevival ? { allowRevival, priorSmsTouchId, revivalReleaseVerified: !!revivalApproval } : {}),
      lineage: {
        artifact_path: options.artifactPath,
        artifact_recipient_id: draft.id,
        approved_by: options.approvedBy,
        cleared_holds: cleared,
        original_holds: draft.holds,
        source_url: sourceUrl,
        carrier_checked_at: route?.carrier_checked_at,
        release_evidence: releaseEvidence,
        ...(allowRevival ? { prior_sms_touch_id: priorSmsTouchId } : {}),
      },
    })
  }
  return rows
}
export async function promoteResearchSms(
  rows: PreparedSms[],
  options: Options,
  db: { url: string; headers: Record<string, string> },
  enabled = false,
) {
  if (
    !/^[\w:-]{8,160}$/.test(options.campaignKey) ||
    !rows.length ||
    rows.length > 1000
  )
    throw Error('Invalid campaign')
  const read = (q: string) =>
    readCompleteRest<CrmRow>(db.url + '/rest/v1/' + q, db.headers)
  const [contacts, touches, jobs] = await Promise.all([
    read('market_contacts?select=*'),
    read(options.allowRevival
      ? 'market_touches?select=id,contact_id,direction,channel,created_at'
      : 'market_touches?direction=eq.outbound&select=id,contact_id,direction'),
    read('sequence_jobs?select=*'),
  ])
  const input = {
    rows,
    campaignKey: options.campaignKey,
    name: options.campaignKey,
    snapshot: { contacts, touches, jobs },
    promotion: true,
  }
  return enqueuePreparedSms(
    {
      ...input,
      dryRun: !options.execute,
      approved: !!options.approvedBy.trim(),
      executionEnabled: enabled,
    },
    db,
  )
}
