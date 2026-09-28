import { createHash } from 'node:crypto'
import { normalizeMarketingPhone, contactPhoneKey, buildPartnershipSmsSchedule, isOptOutText } from './partnership-sms'
import { validateOutboundMessage } from './saturn-send-gate'
import { getPartnershipSenderNumbersForMarket } from '../partnership-lines'
import { activeLocations, serviceLocations } from '../partnership-core/markets.mjs'
import { isOttawa } from '../partnership-core/ottawa.mjs'

export type PreparedSms = { phone: string; company: string; city: string; category: string; body: string; sender: string; reviewReasons?: string[] }
export type CrmRow = Record<string, unknown> & { id: string }
export type SmsSnapshot = { contacts: CrmRow[]; touches: CrmRow[]; jobs: CrmRow[] }
const key = (s: unknown) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
// Same Canadian area-code policy as the existing Canadian import path. Not a line-type assertion.
const canadian = new Set('204 226 236 249 250 257 263 289 306 343 354 365 367 368 382 387 403 416 418 428 431 437 438 450 468 474 506 514 519 548 579 581 584 587 604 613 639 647 672 683 705 709 742 753 778 780 782 807 819 825 867 873 879 902 905 942'.split(' '))
export function smsContactSuppressed(c: Record<string, unknown>) {
  return !!(c.do_not_contact || c.cross_channel_suppressed_at || ['dnc','do_not_contact','closed_lost'].includes(String(c.stage)) || ['opted_out','rejected'].includes(String(c.decision)) || isOptOutText(c.notes as string))
}
export function planPreparedSms(rows: PreparedSms[], snapshot: SmsSnapshot, campaignKey: string) {
  const seen = new Set<string>()
  const seenNames = new Set<string>()
  return rows.map(input => {
    const row = { ...input, phone: normalizeMarketingPhone(input.phone) }
    const reasons = [...(input.reviewReasons || [])]
    const gate = validateOutboundMessage({ body: row.body, to: row.phone, from: row.sender })
    if (!gate.allowed) reasons.push(gate.reason)
    if (!canadian.has(row.phone.slice(2,5))) reasons.push('non_canadian_or_unknown')
    if (!row.company.trim()) reasons.push('missing_identity')
    if (!row.category.trim()) reasons.push('missing_category')
    if (!activeLocations.some((c: string) => key(c) === key(row.city))) reasons.push('market_not_active')
    // Match reserveAction's service coverage, including Vanier and accented Orléans.
    // This does not activate Ottawa cold SMS: market_not_active remains independent.
    if (!isOttawa(row.city) && !serviceLocations.some((c: string) => key(c) === key(row.city))) reasons.push('service_not_confirmed')
    if (!getPartnershipSenderNumbersForMarket(row.city).includes(row.sender)) reasons.push('sender_market_mismatch')
    if (seen.has(row.phone)) reasons.push('duplicate_in_manifest')
    seen.add(row.phone)
    if (seenNames.has(key(row.company))) reasons.push('duplicate_business_in_manifest')
    if (row.company) seenNames.add(key(row.company))
    const matched = snapshot.contacts.filter(c => contactPhoneKey(String(c.phone || '')) === contactPhoneKey(row.phone))
    const names = row.company.trim() ? snapshot.contacts.filter(c => key(c.name) === key(row.company) || key(c.company) === key(row.company)) : []
    if (matched.length > 1) reasons.push('crm_identity_ambiguous')
    if (!matched.length && names.length) reasons.push('existing_name_requires_identity_review')
    if (matched.some(smsContactSuppressed)) reasons.push('recipient_suppressed')
    if (matched.some(c => c.sequence_paused)) reasons.push('sequence_paused')
    const ids = new Set(matched.map(c => c.id))
    if (snapshot.touches.some(t => ids.has(String(t.contact_id)) && t.direction === 'outbound')) reasons.push('existing_contact_outreach_review')
    if (matched.some(c => c.last_inbound_at)) reasons.push('account_has_inbound')
    if (matched.some(c => !c.partner_company_id)) reasons.push('account_identity_required')
    if (matched.some(c => key(c.city) !== key(row.city))) reasons.push('crm_location_conflict')
    const executionKey = createHash('sha256').update(`${campaignKey}:${row.phone}`).digest('hex')
    const existingJob = snapshot.jobs.find(j => j.execution_key === executionKey)
    if (snapshot.jobs.some(j => ids.has(String(j.contact_id)) && j.channel === 'sms' && ['pending','running','sent'].includes(String(j.status)) && j.execution_key !== executionKey)) reasons.push('existing_sms_job')
    return { ...row, execution_key: executionKey, contact_id: matched[0]?.id || null, reasons: [...new Set(reasons)], send_ready: reasons.length === 0, existing_job_id: existingJob?.id || null }
  })
}
export function schedulePreparedSms(plan: ReturnType<typeof planPreparedSms>, dailyCap = 1000, now = Date.now()) {
  const ready = plan.filter(r => r.send_ready)
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  const cap = Math.max(1, Math.floor(dailyCap))
  // Use future business-hour slots at the daily rate. Skip elapsed slots, never compress a day's sends at closing.
  const schedule = buildPartnershipSmsSchedule({ startDate: today, includeWeekends: true, count: ready.length + cap, dailyCap: cap, senderNumbers: [...new Set(ready.map(r => r.sender))] })
    .filter(slot => Date.parse(slot.scheduledAt) >= now + 10 * 60 * 1000)
    .sort((a,b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, ready.length)
  return ready.map((r, i) => ({ ...r, scheduled_at: schedule[i].scheduledAt }))
}

export async function enqueuePreparedSms(input: { campaignKey: string; name: string; rows: PreparedSms[]; snapshot: SmsSnapshot; dailyCap?: number; dryRun?: boolean; approved?: boolean; executionEnabled?: boolean }, database: { url: string; headers: HeadersInit }, request: typeof fetch = fetch) {
  const plan = planPreparedSms(input.rows, input.snapshot, input.campaignKey)
  const jobs = schedulePreparedSms(plan, input.dailyCap)
  const preview = { dry_run: true, prepared: plan.length, send_ready: jobs.length, would_queue: jobs.filter(j => !j.existing_job_id).length, already_queued: jobs.filter(j => j.existing_job_id).length, blocked: plan.filter(r => !r.send_ready), jobs }
  if (input.dryRun !== false) return preview
  if (input.approved !== true || input.executionEnabled !== true) throw new Error('Prepared SMS execution disabled or campaign not approved')
  if (!jobs.length) return { ...preview, dry_run: false, scheduled: 0 }
  const response = await request(`${database.url}/rest/v1/rpc/enqueue_prepared_sms`, { method: 'POST', headers: database.headers, body: JSON.stringify({ p_campaign_key: input.campaignKey, p_name: input.name, p_rows: jobs, p_daily_cap: Math.max(1, Math.floor(input.dailyCap || 1000)) }) })
  if (!response.ok) throw new Error(`Prepared SMS enqueue failed (${response.status}); no success inferred, reconcile before retry`)
  const result = await response.json()
  if (!Array.isArray(result.jobs) || result.jobs.length !== jobs.length) throw new Error('Incomplete enqueue receipt; reconcile before retry')
  return { ...preview, dry_run: false, scheduled: result.jobs.filter((j: { replay?: boolean }) => !j.replay).length, receipt: result }
}
