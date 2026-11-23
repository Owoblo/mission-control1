import { createHash } from 'node:crypto'
import { normalizeMarketingPhone, contactPhoneKey, buildPartnershipSmsSchedule, isOptOutText } from './partnership-sms'
import { validateOutboundMessage } from './saturn-send-gate'
import { getPartnershipSenderNumbersForMarket, normalizePartnershipCityKey, PARTNERSHIP_LINES } from '../partnership-lines'
import { findPartnerBusinessCard } from '../partner-business-cards'
import { activeLocations, serviceLocations } from '../partnership-core/markets.mjs'
import { isOttawa, ottawaActionAllowed } from '../partnership-core/ottawa.mjs'

export type PreparedSms = {
  phone: string; company: string; contactName?: string; city: string; category: string
  body: string; sender: string; reviewReasons?: string[]
  allowRevival?: boolean; priorSmsTouchId?: string; revivalReleaseVerified?: boolean
}
export type CrmRow = Record<string, unknown> & { id: string }
export type SmsSnapshot = { contacts: CrmRow[]; touches: CrmRow[]; jobs: CrmRow[] }
const key = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const marketKey = (city: string) => key(city.normalize('NFKD'))
export function preparedSmsMarketSenders(city: string) {
  const cityKey = normalizePartnershipCityKey(city)
  if (isOttawa(city)) return getPartnershipSenderNumbersForMarket('ottawa', { includeSecondary: true })
    .filter(sender => ottawaActionAllowed({ city, kind: 'cold_introduction', channel: 'sms', sender }))
  const lines = PARTNERSHIP_LINES.filter(line => line.market === cityKey ||
    line.cityKeys.some(locality => normalizePartnershipCityKey(locality) === cityKey))
  if (lines.length) return lines.map(line => line.number)
  const hub = findPartnerBusinessCard(city)?.hub
  if (!hub) return []
  const hubKey = normalizePartnershipCityKey(hub)
  return PARTNERSHIP_LINES.filter(line => line.market === hubKey ||
    line.cityKeys.some(locality => normalizePartnershipCityKey(locality) === hubKey)).map(line => line.number)
}

export function assignPreparedSmsSenders<T extends PreparedSms>(rows: T[], healthy?: ReadonlySet<string>) {
  const assignments = new Map<string, number>()
  return rows.map(row => {
    const pool = preparedSmsMarketSenders(row.city).filter(sender => !healthy || healthy.has(sender))
    const poolKey = pool.join(',')
    const next = assignments.get(poolKey) ?? 0
    if (pool.length && !row.reviewReasons?.length) assignments.set(poolKey, next + 1)
    return { ...row, sender: pool[next % pool.length] || '' }
  })
}
// Same Canadian area-code policy as the existing Canadian import path. Not a line-type assertion.
const canadian = new Set('204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942'.split(' '))
export function smsContactSuppressed(c: Record<string, unknown>) {
  return !!(c.do_not_contact || c.cross_channel_suppressed_at || ['dnc','do_not_contact','closed_lost'].includes(String(c.stage)) || ['opted_out','rejected','bad_number'].includes(String(c.decision)) || isOptOutText(typeof c.notes === 'string' ? c.notes.replace(/^Inbound SMS:\s*/i, '') : null))
}
export function hasQuietSmsHistory(touches: CrmRow[], priorSmsTouchId: string | undefined, now = Date.now()) {
  const prior = touches.find(t => t.id === priorSmsTouchId && t.channel === 'sms' && t.direction === 'outbound')
  if (!prior) return false
  const priorTime = Date.parse(String(prior.created_at))
  return now - priorTime >= 45 * 86400000 &&
    touches.every(t => t.id === prior.id || (t.direction !== 'inbound' && Date.parse(String(t.created_at)) < priorTime))
}
const person = (name: unknown) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ')
const agentIdentity = (name: unknown, company: unknown) => JSON.stringify([person(name), person(company)])
function indexCrmRows(rows: CrmRow[], keys: (row: CrmRow) => string[]) {
  const index = new Map<string, CrmRow[]>()
  for (const row of rows) {
    for (const key of new Set(keys(row))) {
      const group = index.get(key)
      if (group) group.push(row)
      else index.set(key, [row])
    }
  }
  return index
}
export function planPreparedSms(rows: PreparedSms[], snapshot: SmsSnapshot, campaignKey: string, now = Date.now()) {
  const seen = new Set<string>()
  const seenNames = new Set<string>()
  const seenAgents = new Set<string>()
  const contactsByPhone = indexCrmRows(snapshot.contacts, row => [contactPhoneKey(String(row.phone || ''))])
  const contactsByName = indexCrmRows(snapshot.contacts, row => [key(row.name), key(row.company)])
  const contactsByAgent = indexCrmRows(snapshot.contacts, row => [agentIdentity(row.name, row.company)])
  const touchesByContact = indexCrmRows(snapshot.touches, row => [String(row.contact_id)])
  const jobsByContact = indexCrmRows(snapshot.jobs.filter(job => job.channel === 'sms'), row => [String(row.contact_id)])
  const jobsByExecution = new Map(snapshot.jobs.map(job => [job.execution_key, job]))
  return rows.map(input => {
    const row = { ...input, phone: normalizeMarketingPhone(input.phone) }
    const reasons = [...(input.reviewReasons || [])]
    const gate = validateOutboundMessage({ body: row.body, to: row.phone, from: row.sender })
    if (!gate.allowed) reasons.push(gate.reason)
    if (!canadian.has(row.phone.slice(2,5))) reasons.push('non_canadian_or_unknown')
    if (!row.company.trim()) reasons.push('missing_identity')
    if (!row.category.trim()) reasons.push('missing_category')
    const ottawaMarket = isOttawa(row.city)
    const marketActive = ottawaMarket
      ? ottawaActionAllowed({ city: row.city, kind: 'cold_introduction', channel: 'sms', sender: row.sender })
      : activeLocations.some((c: string) => marketKey(c) === marketKey(row.city))
    if (!marketActive) reasons.push('market_not_active')
    if (!ottawaMarket && !serviceLocations.some((c: string) => marketKey(c) === marketKey(row.city))) reasons.push('service_not_confirmed')
    if (!preparedSmsMarketSenders(row.city).includes(row.sender)) reasons.push('sender_market_mismatch')
    if (seen.has(row.phone)) reasons.push('duplicate_in_manifest')
    seen.add(row.phone)
    const agent = !!row.contactName?.trim() && ['realtor', 'realestateagent', 'realestate'].includes(key(row.category))
    const agentKey = agentIdentity(row.contactName, row.company)
    if (agent && seenAgents.has(agentKey)) reasons.push('duplicate_agent_in_manifest')
    if (agent) seenAgents.add(agentKey)
    if (!agent && seenNames.has(key(row.company))) reasons.push('duplicate_business_in_manifest')
    if (!agent && row.company) seenNames.add(key(row.company))
    const phoneKey = contactPhoneKey(row.phone)
    const matched = contactsByPhone.get(phoneKey) || []
    const names = row.company.trim() ? contactsByName.get(key(row.company)) : undefined
    if (matched.length > 1) reasons.push('crm_identity_ambiguous')
    if (agent && matched.some(c => agentIdentity(c.name, c.company) !== agentKey)) reasons.push('agent_identity_conflict')
    if (agent && contactsByAgent.get(agentKey)?.some(c => contactPhoneKey(String(c.phone || '')) !== phoneKey)) reasons.push('agent_phone_requires_identity_review')
    if (!agent && !matched.length && names?.length) reasons.push('existing_name_requires_identity_review')
    if (matched.some(smsContactSuppressed)) reasons.push('recipient_suppressed')
    if (matched.some(c => c.sequence_paused)) reasons.push('sequence_paused')
    const touches = matched.flatMap(c => touchesByContact.get(c.id) || [])
    const priorOutreach = touches.some(t => t.direction === 'outbound')
    const revival = row.allowRevival === true && row.revivalReleaseVerified === true &&
      agent && matched.length === 1 && hasQuietSmsHistory(touches, row.priorSmsTouchId, now)
    if (row.allowRevival && !revival) reasons.push('revival_history_or_release_unverified')
    if (priorOutreach && !revival) reasons.push('existing_contact_outreach_review')
    if (matched.some(c => c.last_inbound_at) || touches.some(t => t.direction === 'inbound')) reasons.push('account_has_inbound')
    if (matched.some(c => !c.partner_company_id)) reasons.push('account_identity_required')
    if (matched.some(c => key(c.city) !== key(row.city))) reasons.push('crm_location_conflict')
    const identity = revival ? `prepared-sms-revival:${row.priorSmsTouchId}` : `${campaignKey}:${row.phone}`
    const executionKey = createHash('sha256').update(identity).digest('hex')
    const existingJob = jobsByExecution.get(executionKey)
    const otherSmsJobs = matched.flatMap(c => jobsByContact.get(c.id) || []).filter(j => j.execution_key !== executionKey)
    const activeSmsJob = otherSmsJobs.some(j => ['pending', 'running', 'processing', 'queued_manual'].includes(String(j.status)))
    const priorSentSmsJob = otherSmsJobs.some(j => j.status === 'sent')
    if (activeSmsJob || (priorSentSmsJob && !revival)) {
      reasons.push(revival ? 'active_sms_job' : 'existing_sms_job')
    }
    return { ...row, execution_key: executionKey, contact_id: matched[0]?.id || null, reasons: [...new Set(reasons)], send_ready: reasons.length === 0, existing_job_id: existingJob?.id || null,
      relationship_history: { prior_outreach: priorOutreach, active_sms_job: activeSmsJob, prior_sent_sms_job: priorSentSmsJob },
    }
  })
}
export function schedulePreparedSms(plan: ReturnType<typeof planPreparedSms>, dailyCap = 1000, now = Date.now()) {
  const ready = plan.filter(r => r.send_ready)
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const cap = Math.max(1, Math.floor(dailyCap))
  // Spread the daily cap across the Toronto calendar day and skip elapsed slots.
  const schedule = buildPartnershipSmsSchedule({ startDate: today, includeWeekends: true, startHour: 0, endHour: 24, count: ready.length + cap, dailyCap: cap, senderNumbers: [...new Set(ready.map(r => r.sender))] })
    .filter(slot => Date.parse(slot.scheduledAt) >= now + 10 * 60 * 1000)
    .sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, ready.length)
  return ready.map((r, i) => ({ ...r, scheduled_at: schedule[i].scheduledAt }))
}

export async function enqueuePreparedSms(input: { campaignKey: string; name: string; rows: PreparedSms[]; snapshot: SmsSnapshot; dailyCap?: number; promotion?: boolean; dryRun?: boolean; approved?: boolean; executionEnabled?: boolean }, database: { url: string; headers: HeadersInit }, request: typeof fetch = fetch) {
  const plan = planPreparedSms(input.rows, input.snapshot, input.campaignKey)
  const jobs = schedulePreparedSms(plan, input.dailyCap)
  const preview = { dry_run: true, prepared: plan.length, send_ready: jobs.length, would_queue: jobs.filter(j => !j.existing_job_id).length, already_queued: jobs.filter(j => j.existing_job_id).length, blocked: plan.filter(r => !r.send_ready), jobs }
  if (input.dryRun !== false) return preview
  if (input.approved !== true || input.executionEnabled !== true) throw new Error('Prepared SMS execution disabled or campaign not approved')
  if (!jobs.length) return { ...preview, dry_run: false, scheduled: 0 }
  const response = await request(`${database.url}/rest/v1/rpc/${input.promotion ? 'promote_research_sms' : 'enqueue_prepared_sms'}`, { method: 'POST', headers: database.headers, body: JSON.stringify({ p_campaign_key: input.campaignKey, p_name: input.name, p_rows: jobs, p_daily_cap: Math.max(1, Math.floor(input.dailyCap || 1000)) }) })
  if (!response.ok) throw new Error(`Prepared SMS enqueue failed (${response.status}); no success inferred, reconcile before retry`)
  const result = await response.json()
  if (!Array.isArray(result.jobs) || result.jobs.length !== jobs.length) throw new Error('Incomplete enqueue receipt; reconcile before retry')
  return { ...preview, dry_run: false, scheduled: result.jobs.filter((j: { replay?: boolean }) => !j.replay).length, receipt: result }
}
