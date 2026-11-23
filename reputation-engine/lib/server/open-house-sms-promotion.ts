import { isOttawa } from '../partnership-core/ottawa.mjs'
import { isSmsProviderReceipt } from '../telephony-providers'
import { normalizeMarketingPhone } from './partnership-sms'
import { preparedSmsMarketSenders } from './prepared-sms'
import { readCompleteRest } from './read-complete-rest'
import { researchSmsRows } from './research-sms-promoter'

type Agent = Parameters<typeof researchSmsRows>[2][number]
type Inventory = Parameters<typeof researchSmsRows>[1][number]
type RecordRow = Record<string, unknown> & { id: string }
type Candidate = Agent & Pick<Inventory, 'verified_routes'> & {
  contact_id?: string
  prior_sms_touch_id?: string
  city: string
  source_identity_count: number
  event: { mls: string; source_url: string; starts_at: string; verified_at: string; city: string }
}
const nameKey = (s: unknown) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ')
const normalized = (s: unknown) => nameKey(s).replace(/[^\p{L}\p{N}]/gu, '')
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i
const https = (s: string) => typeof s === 'string' && /^https:\/\/[^\s/]+/i.test(s)
const version = 'open_house_realtor_v1'

export async function openHouseRelationshipHolds(db: { url: string; headers: Record<string,string> }, contactId: string, name: string, now = Date.now()) {
  const read = (table: string, query: Record<string,string>, key = 'id') =>
    readCompleteRest<RecordRow>(db.url + '/rest/v1/' + table + '?' + new URLSearchParams(query), db.headers, fetch, 100000, key)
  const [tasks, referrals, activities] = await Promise.all([
    read('crm_tasks',{related_id:'eq.'+contactId,status:'in.(open,in_progress)',select:'id'}),
    read('crm_leads',{'data->>partnerReferralContactId':'eq.'+contactId,deleted:'eq.false',select:'id'}),
    read('partner_listing_activity',{'representative->>name':'ilike.'+name,listing_status:'eq.open_house_schedule_observed',
      select:'activity_key,representative'},'activity_key'),
  ])
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone:'America/Toronto' })
  return [
    ...(tasks.length ? ['open_relationship_tasks_review'] : []),
    ...(referrals.length ? ['referral_pending'] : []),
    ...(activities.some(row => {
      const representative = row.representative as { open_house_events?: { date?: string }[] } | null
      return representative?.open_house_events?.some(event => String(event.date || '') >= today)
    }) ? ['current_crm_linked_event_review'] : []),
  ]
}

export async function prepareOpenHouseSmsPromotion(input: {
  day: string
  draft_version: string
  export_key: string
  dry_run?: boolean
  candidates: Candidate[]
}, db: { url: string; headers: Record<string, string> }, now = Date.now()) {
  const today = new Date(now).toLocaleDateString('en-CA', { timeZone: 'America/Toronto' })
  if (input.draft_version !== version || !/^\d{4}-\d{2}-\d{2}$/.test(input.day) ||
      !/^[a-zA-Z0-9_-]{8,80}$/.test(input.export_key) ||
      (input.dry_run !== undefined && typeof input.dry_run !== 'boolean') ||
      (input.dry_run !== true && input.day !== today) || !Array.isArray(input.candidates) ||
      !input.candidates.length || input.candidates.length > 1000) throw Error('Invalid open-house promotion batch')

  const options = {
    artifactPath: `railway:open-house/${input.export_key}/realtor-sms-preparation.json`,
    campaignKey: `open-house-realtor-daily-${input.day.replaceAll('-', '')}-${input.export_key}`,
    approvedBy: `railway:open-house-template:${version}`,
    clearHolds: [],
    automatedTemplateVersion: version,
    allowRevival: true,
    execute: input.dry_run !== true,
  }
  const read = (table: string, q: Record<string,string>, key = 'id') =>
    readCompleteRest<RecordRow>(db.url + '/rest/v1/' + table + '?' + new URLSearchParams(q), db.headers, fetch, 100000, key)
  const candidates = new Map(input.candidates.map(row => [row.id, row]))
  if (candidates.size !== input.candidates.length) throw Error('Duplicate open-house recipient')
  const drafts = await Promise.all([...candidates.values()].map(async item => {
    if (!item.id?.trim() || !/^[\p{L}\p{M}][\p{L}\p{M} .’'-]{1,100}$/u.test(item.name || '') ||
        !item.city?.trim() || !Array.isArray(item.brokerages) || !Array.isArray(item.verified_routes) ||
        !Array.isArray(item.roles)) throw Error('Incomplete Realtor identity')
    const revival = !!item.contact_id || !!item.prior_sms_touch_id
    const holds: string[] = []
    if (item.source_identity_count !== 1 || new Set(item.brokerages.map(normalized)).size !== 1) holds.push('resolve_brokerage')
    const starts = Date.parse(item.event?.starts_at || '')
    const verifiedAge = now - Date.parse(item.event?.verified_at || '')
    const role = item.roles.find(role => 'mls' in role && role.mls === item.event?.mls && role.source_url === item.event?.source_url &&
      https(role.source_url) && !!role.proof?.trim())
    if (!role || !Number.isFinite(starts) || starts <= now || !(verifiedAge >= 0 && verifiedAge < 36 * 3600000)) {
      holds.push('current_open_house_attribution_required')
    }
    if (item.event?.city && (revival
      ? !preparedSmsMarketSenders(item.city).some(line => preparedSmsMarketSenders(item.event.city).includes(line))
      : normalized(item.event.city) !== normalized(item.city))) holds.push('open_house_market_conflict')
    const phoneRoutes = item.verified_routes.filter(route => route.kind === 'phone')
    if (phoneRoutes.length !== 1) holds.push('confirm_single_direct_realtor_mobile')
    const route = phoneRoutes[0]
    if (!route || route.shared_in_research_batch !== false || !https(route.source_url || '') ||
        !route.proof?.trim() || /\b(?:office|brokerage|reception|shared|landline) (?:phone|number|line)\b/i.test(route.proof)) {
      holds.push('independently_attributed_mobile_route_missing')
    }
    if (!revival && route?.origin !== 'current_first_party_capture') holds.push('first_party_realtor_route_required')
    let receiptId: string | undefined
    if (revival && !holds.length) {
      const phone = normalizeMarketingPhone(route.value)
      if (!uuid.test(item.contact_id || '') || !uuid.test(item.prior_sms_touch_id || '')) {
        holds.push('verify_historical_mobile_receipt')
      } else {
        const [[contact], [touch], relationshipHolds] = await Promise.all([
          read('market_contacts',{id:'eq.'+item.contact_id,select:'id,name,phone,company,city,notes'}),
          read('market_touches',{id:'eq.'+item.prior_sms_touch_id,select:'id,contact_id,channel,direction,metadata'}),
          openHouseRelationshipHolds(db,item.contact_id!,item.name,now),
        ])
        const metadata = touch?.metadata as { to?: string; twilioSid?: string; messageSid?: string } | undefined
        const sid = metadata?.twilioSid || metadata?.messageSid
        const historicalSource = String(contact?.notes || '').match(/^profile=(https:\/\/\S+)$/m)?.[1]
        holds.push(...relationshipHolds)
        if (!contact || nameKey(contact.name) !== nameKey(item.name) ||
            nameKey(contact.company) !== nameKey(item.brokerages[0]) || contact.city !== item.city ||
            normalizeMarketingPhone(String(contact.phone || '')) !== phone ||
            (route.origin === 'crm_delivered_sms_route' && historicalSource !== route.source_url) ||
            touch?.contact_id !== contact.id || touch?.channel !== 'sms' || touch?.direction !== 'outbound' ||
            normalizeMarketingPhone(metadata?.to) !== phone || !isSmsProviderReceipt(sid)) {
          holds.push('verify_historical_mobile_receipt')
        } else {
          const events = await read('crm_sms_provider_events',{message_key:'eq.'+sid,status:'eq.delivered',select:'event_id,payload'},'event_id')
          const delivered = events.some(row => {
            const data = row.payload as { direction?: string; to?: Array<{ phone_number?: string }> | string }
            const destinations = Array.isArray(data?.to) ? data.to.map(to => to.phone_number) : [data?.to]
            return data?.direction === 'outbound' && destinations.some(to => normalizeMarketingPhone(to) === phone)
          })
          if (!delivered) holds.push('verify_historical_mobile_receipt')
          else receiptId = sid
        }
      }
    }
    const first = item.name.trim().split(/\s+/)[0].toLowerCase().replace(/^\p{L}/u,c=>c.toUpperCase())
    const brand = isOttawa(item.city) ? 'Dexa Movers' : 'Saturn Star Movers'
    const body = revival
      ? `Hope you’ve been well, ${first}.\n\nI wanted to follow up on my note about helping your clients move around ${item.city} with ${brand}.\n\nAnyone coming up who might need a moving quote?`
      : `Hi ${first}, John here with ${brand}.\n\nWe help buyers and sellers move in ${item.city} and nearby.\n\nWould you like a digital card to keep handy for clients?`
    return {
      id:item.id,name:item.name,cities:[item.city],body,holds,
      ...(revival && receiptId ? { requested_action:'quiet_thread_revival',release_evidence:{
        prior_sms_touch_id:item.prior_sms_touch_id,prior_delivery_receipt:receiptId,
      }} : {}),
    }
  }))
  const rows = researchSmsRows(drafts,input.candidates,input.candidates,options,now)
  return { rows, options }
}
