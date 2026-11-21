import { createHash } from 'node:crypto'
import { getSessionPayload } from '../auth'
import { isTelnyxNumber } from '../telephony-providers'
import {
  assignPreparedSmsSenders,
  enqueuePreparedSms,
  planPreparedSms,
  preparedSmsMarketSenders,
  type CrmRow,
  type PreparedSms,
} from './prepared-sms'
import { readCompleteRest } from './read-complete-rest'
import { contactPhoneKey, normalizeMarketingPhone } from './partnership-sms'
import { readEnv } from './runtime'

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
  scope?: string
  has_crm_or_prior_match?: boolean
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
  authenticatedApprover?: { userId: string; name: string }
  automatedTemplateVersion?: string
}

export async function authenticateResearchSmsApprover(token: string, claimedName: string) {
  const session = await getSessionPayload(token.trim())
  const name = session?.name?.trim()
  const userId = session?.userId?.trim()
  if (session?.role !== 'owner' || !userId || !name ||
      (claimedName.trim() && claimedName.trim().toLowerCase() !== name.toLowerCase())) {
    throw new Error('Disclosure clearance requires a matching authenticated owner session')
  }
  return { userId, name }
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
const identifiedSender = /\b(?:Saturn Star Movers|Dexa Movers)\b/i
const unsubscribeInstruction = /\b(?:you can |you may |just )?(?:reply(?: with)?|text)\s+["'“”‘’]?(?:unsubscribe|stop|remove me|opt out)\b/i
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
    const publishedNumberFor = (route: Route) => {
      const phone = normalizeMarketingPhone(route.value).slice(-10)
      return /^\d{10}$/.test(phone)
        ? new RegExp(`(?:^|\\D)(?:\\+?1[\\s.·–-]*)?\\(?${phone.slice(0, 3)}\\)?[\\s.·–-]*${phone.slice(3, 6)}[\\s.·–-]*${phone.slice(6)}(?!\\d)`)
        : null
    }
    const publicationFor = (route: Route) => {
      const publishedPhone = publishedNumberFor(route)
      return route.evidence?.find((item) =>
        /^https?:\/\//.test(item.url) && item.context?.trim() &&
        publishedPhone?.test(item.context) &&
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
    const disclosureReview = !allowRevival && verified && options.authenticatedApprover &&
      options.authenticatedApprover.name === options.approvedBy && options.clearHolds.includes(disclosureHold) &&
      draft.holds.includes(disclosureHold) && identifiedSender.test(draft.body) &&
      unsubscribeInstruction.test(draft.body)
      ? {
          approved_by_user_id: options.authenticatedApprover.userId,
          copy_sha256: createHash('sha256').update(draft.body).digest('hex'),
          mechanism: 'in_message_keyword_reply',
        }
      : undefined
    const cleared = draft.holds.filter((hold) =>
      hold === disclosureHold ? !!disclosureReview :
      (revivalApproval && revivalHolds.has(hold)) ||
      (hold === basisHold && savedEvidence) ||
      (!(allowRevival && revivalHolds.has(hold)) && options.clearHolds.includes(hold)),
    )
    if (cleared.includes('coordinate_single_triland_team_introduction'))
      throw Error('Select one team recipient before promotion')
    const releaseEvidence = revivalApproval ?? (options.releaseEvidence?.trim() || savedEvidence)
    if (cleared.includes(basisHold) && !releaseEvidence)
      throw Error(
        'Record supporting release evidence before clearing the basis hold',
      )
    const reasons = draft.holds.filter((h) => !cleared.includes(h))
    if (!verified) reasons.push('verify_unique_current_mobile')
    if (options.b2b && !savedEvidence && !reasons.includes(basisHold)) reasons.push(basisHold)
    if (options.b2b && (!identifiedSender.test(draft.body))) {
      if (!reasons.includes(disclosureHold)) reasons.push(disclosureHold)
    }
    if (options.b2b && route) {
      const publishedNumber = publishedNumberFor(route)
      const scopeLabels = route.evidence?.flatMap(item => {
        const number = publishedNumber?.exec(item.context)
        const suffix = number && item.context.slice(number.index + number[0].length)
        const branch = suffix && /^\s*[-–—]\s*(\p{Lu}[\p{L}.'-]*(?: +\p{Lu}[\p{L}.'-]*){0,4})\s*$/u.exec(suffix)
        return branch ? [normalize(branch[1])] : []
      }) || []
      if (scopeLabels.some(label => label !== normalize(record.city!))) reasons.push('route_branch_conflict')
      if (route.has_crm_or_prior_match) reasons.push('saved_crm_or_prior_route_review')
      if (route.scope && !['company', 'department', 'named_professional'].includes(route.scope)) reasons.push('channel_or_role_review')
      if (options.automatedTemplateVersion &&
          (record.verified_routes.filter(candidate => candidate.kind === 'phone' && candidate.technical_state === 'canadian_mobile').length !== 1 ||
           !['company', 'department', 'named_professional'].includes(route.scope || ''))) {
        reasons.push('primary_mobile_route_selection_required')
      }
    }
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
      sender: '',
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
        ...(disclosureReview ? { disclosure_review: disclosureReview } : {}),
        ...(options.automatedTemplateVersion ? {
          template_review: {
            version: options.automatedTemplateVersion,
            copy_sha256: createHash('sha256').update(draft.body).digest('hex'),
          },
        } : {}),
        ...(allowRevival ? { prior_sms_touch_id: priorSmsTouchId } : {}),
      },
    })
  }
  return assignPreparedSmsSenders(rows)
}
export async function healthyPreparedSmsSenders(rows: PreparedSms[], request: typeof fetch = fetch) {
  const senders = [...new Set(rows.flatMap(row => preparedSmsMarketSenders(row.city)))]
  const checks = await Promise.all(senders.map(async sender => {
    try {
      if (isTelnyxNumber(sender)) {
        const key = readEnv('TELNYX_API_KEY')
        if (!key) return false
        const query = new URLSearchParams({ 'filter[phone_number]': sender })
        const response = await request('https://api.telnyx.com/v2/phone_numbers?' + query, {
          headers: { Authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(10000), cache: 'no-store',
        })
        return response.ok && (await response.json()).data?.some((line: { phone_number: string; status: string; messaging_profile_id?: string }) =>
          line.phone_number === sender && line.status === 'active' && !!line.messaging_profile_id)
      }
      const sid = readEnv('TWILIO_ACCOUNT_SID')
      const token = readEnv('TWILIO_AUTH_TOKEN')
      if (!sid || !token) return false
      const query = new URLSearchParams({ PhoneNumber: sender })
      const options = { headers: { Authorization: 'Basic ' + Buffer.from(sid + ':' + token).toString('base64') },
        signal: AbortSignal.timeout(10000), cache: 'no-store' as const }
      const base = `https://api.twilio.com/2010-04-01/Accounts/${sid}`
      const [account, numbers] = await Promise.all([
        request(base + '.json', options),
        request(base + '/IncomingPhoneNumbers.json?' + query, options),
      ])
      return account.ok && numbers.ok && (await account.json()).status === 'active' &&
        (await numbers.json()).incoming_phone_numbers?.some((line: { phone_number: string; capabilities?: { sms?: boolean } }) =>
          line.phone_number === sender && line.capabilities?.sms === true)
    } catch {
      return false
    }
  }))
  return new Set(senders.filter((_, index) => checks[index]))
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
  const [contacts, healthy] = await Promise.all([
    read('market_contacts?select=id,phone,name,company,city,stage,decision,notes,partner_company_id,last_inbound_at,sequence_paused,do_not_contact,cross_channel_suppressed_at'),
    healthyPreparedSmsSenders(rows),
  ])
  const phones = new Set(rows.map(row => contactPhoneKey(row.phone)).filter(Boolean))
  const matched = contacts.filter(contact => phones.has(contactPhoneKey(String(contact.phone || ''))))
  const histories: Promise<[CrmRow[], CrmRow[]]>[] = []
  for (let i = 0; i < matched.length; i += 100) {
    const filter = '&contact_id=' + encodeURIComponent('in.(' + matched.slice(i, i + 100).map(c => c.id).join(',') + ')')
    histories.push(Promise.all([
      read('market_touches?select=id,contact_id,direction,channel,created_at' + filter),
      read('sequence_jobs?channel=eq.sms&select=id,channel,status,contact_id,execution_key,sms_payload' + filter),
    ]))
  }
  const history = await Promise.all(histories)
  const touches = history.flatMap(([touches]) => touches)
  const jobs = history.flatMap(([, jobs]) => jobs)
  const existing = new Map(jobs.map(job => [job.execution_key, job.sms_payload as { from?: string } | null]))
  const assigned = assignPreparedSmsSenders(rows, healthy).map(row => {
    const identity = row.allowRevival && row.revivalReleaseVerified && row.priorSmsTouchId
      ? 'prepared-sms-revival:' + row.priorSmsTouchId
      : options.campaignKey + ':' + normalizeMarketingPhone(row.phone)
    const executionKey = createHash('sha256').update(identity).digest('hex')
    const previousSender = existing.get(executionKey)?.from
    if (previousSender && preparedSmsMarketSenders(row.city).includes(previousSender)) return { ...row, sender: previousSender }
    return row.sender ? row : { ...row, reviewReasons: [...(row.reviewReasons || []), 'healthy_market_sender_unavailable'] }
  })
  const snapshot = { contacts, touches, jobs }
  const ready = planPreparedSms(assigned, snapshot, options.campaignKey)
    .filter(row => row.send_ready && !row.existing_job_id)
  const rotation = new Map(assignPreparedSmsSenders(ready, healthy).map(row => [row.phone, row.sender]))
  const input = {
    rows: assigned.map(row => ({
      ...row, sender: rotation.get(normalizeMarketingPhone(row.phone)) || row.sender,
    })),
    campaignKey: options.campaignKey,
    name: options.campaignKey,
    snapshot,
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
