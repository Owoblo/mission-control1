import {
  buildRecentSaleEventKey,
  buildRecentSaleMessage,
  classifyRecentSaleRelationship,
  scoreRecentSaleContact,
  type ListingRepresentative,
  type RecentSaleContact,
} from '@/lib/recent-sale-opportunity'
import { requireSupabaseEnv } from '@/lib/server/runtime'

type SoldListing = {
  zpid?: string | number | null
  region?: string | null
  address?: string | null
  addressstreet?: string | null
  addresscity?: string | null
  city?: string | null
  addressstate?: string | null
  addresszipcode?: string | null
  detailurl?: string | null
  listing_representatives?: ListingRepresentative[] | string | null
  listing_agent_names?: string[] | null
  listing_mls_id?: string | null
  listing_attribution_source?: string | null
  listing_attribution_captured_at?: string | null
  lastseenat?: string | null
  sold_postcard_sent_at?: string | null
  last_postcard_batch_id?: string | null
}

async function loadAll<T>(baseUrl: string, headers: Record<string, string>) {
  const rows: T[] = []
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${baseUrl}&limit=1000&offset=${offset}`, {
      headers,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(await response.text())
    const page = await response.json() as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

function representatives(listing: SoldListing): ListingRepresentative[] {
  let reps = listing.listing_representatives
  if (typeof reps === 'string') {
    try { reps = JSON.parse(reps) as ListingRepresentative[] } catch { reps = [] }
  }
  if (Array.isArray(reps) && reps.length) return reps.filter(rep => rep?.name?.trim())
  return (listing.listing_agent_names || [])
    .filter(Boolean)
    .map(name => ({ name, role: 'listing_agent' } satisfies ListingRepresentative))
}

function listingAddress(listing: SoldListing) {
  if (listing.address?.trim()) return listing.address.trim()
  return [
    listing.addressstreet,
    listing.addresscity || listing.city,
    listing.addressstate || 'ON',
    listing.addresszipcode,
  ].filter(Boolean).join(', ')
}

export async function syncRecentSalesFromListings() {
  const { url, headers } = requireSupabaseEnv()
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const listingSelect = [
    'zpid', 'region', 'address', 'addressstreet', 'addresscity', 'city',
    'addressstate', 'addresszipcode', 'detailurl', 'listing_representatives',
    'listing_agent_names', 'listing_mls_id', 'listing_attribution_source',
    'listing_attribution_captured_at', 'lastseenat', 'sold_postcard_sent_at',
    'last_postcard_batch_id',
  ].join(',')
  // The listings table is large and sold_postcard_sent_at is not indexed.
  // Pull only the newest sold rows by the existing status path, then apply the
  // 14-day cutoff in memory to avoid a production statement timeout.
  const listingQueries = ['sold_archived', 'sold'].map(status =>
    `${url}/rest/v1/listings?select=${listingSelect}` +
    `&status=eq.${status}&order=sold_postcard_sent_at.desc.nullslast&limit=250`
  )
  const [listings, contacts, existingSignals] = await Promise.all([
    Promise.all(listingQueries.map(async query => {
      const response = await fetch(query, { headers, cache: 'no-store' })
      if (!response.ok) throw new Error(await response.text())
      return response.json() as Promise<SoldListing[]>
    })).then(pages => pages.flat().filter(listing =>
      listing.sold_postcard_sent_at && listing.sold_postcard_sent_at >= cutoff
    )),
    loadAll<RecentSaleContact & { partner_company_id?: string }>(
      `${url}/rest/v1/market_contacts?select=id,name,company,phone,email,city,stage,relationship_temperature,relationship_score,partnership_outcome,last_inbound_at,partner_company_id,do_not_contact,decision`,
      headers
    ),
    loadAll<{ id: string; event_key: string; listing_id?: string | null; status?: string | null }>(
      `${url}/rest/v1/partner_sale_signals?select=id,event_key,listing_id,status`,
      headers
    ),
  ])

  const existingKeys = new Set(existingSignals.map(row => row.event_key))
  const unattributedByListing = new Map(existingSignals
    .filter(row => row.listing_id && row.event_key.endsWith('|realtor_not_identified'))
    .map(row => [String(row.listing_id), row]))
  const records: Array<Record<string, unknown>> = []
  const upgrades: Array<{ id: string; record: Record<string, unknown> }> = []
  let skippedOttawa = 0
  let awaitingAttribution = 0

  for (const listing of listings) {
    if ((listing.region || '').toLowerCase() === 'ottawa') {
      skippedOttawa++
      continue
    }
    const address = listingAddress(listing)
    const city = listing.city || listing.addresscity || null
    if (!address) continue
    const attributedReps = representatives(listing)
    const reps: ListingRepresentative[] = attributedReps.length
      ? attributedReps
      : [{ name: 'Realtor not identified', role: 'listing_agent' }]
    if (!attributedReps.length) awaitingAttribution++

    for (const [representativeIndex, representative] of reps.entries()) {
      const eventKey = buildRecentSaleEventKey({
        mls: listing.listing_mls_id,
        address,
        city,
        realtorName: representative.name,
      })
      if (existingKeys.has(eventKey)) continue

      const hasAttribution = representative.name !== 'Realtor not identified'
      const scored = hasAttribution
        ? contacts
          .map(contact => ({ contact, ...scoreRecentSaleContact({ ...representative, city } as ListingRepresentative & { city?: string }, contact) }))
          .sort((a, b) => b.score - a.score)[0]
        : null
      const matched = scored && scored.score >= 80 ? scored : null
      const relationship = classifyRecentSaleRelationship(matched?.contact)
      const record = {
        event_key: eventKey,
        listing_id: listing.zpid ? String(listing.zpid) : null,
        mls_id: listing.listing_mls_id || null,
        address,
        city,
        region: listing.region || null,
        sold_detected_at: listing.lastseenat || null,
        sold_verified_at: listing.sold_postcard_sent_at || new Date().toISOString(),
        verification_status: 'verified',
        verification_source: 'sold2move_two_scrape_confirmation',
        verification_confidence: 95,
        realtor_name: representative.name,
        realtor_role: representative.role || 'listing_agent',
        realtor_phone: representative.phone || null,
        realtor_email: representative.email || null,
        realtor_brokerage: representative.brokerage || null,
        attribution_source: hasAttribution ? listing.listing_attribution_source || 'listing_detail' : null,
        attribution_captured_at: listing.listing_attribution_captured_at || null,
        contact_id: matched?.contact.id || null,
        company_id: matched?.contact.partner_company_id || null,
        match_score: scored?.score || 0,
        match_reasons: scored?.reasons || [],
        relationship_tier: relationship,
        suggested_message: buildRecentSaleMessage({
          realtorName: representative.name,
          address,
          city,
          relationship,
        }),
        status: matched ? 'needs_review' : 'needs_match',
        metadata: {
          listing_url: listing.detailurl || null,
          listing_region: listing.region || null,
          postcard_batch_id: listing.last_postcard_batch_id || null,
          synced_from: 'listings',
          attribution_status: hasAttribution ? 'identified' : 'needs_realtor',
        },
      }
      const placeholder = listing.zpid ? unattributedByListing.get(String(listing.zpid)) : null
      if (
        hasAttribution && representativeIndex === 0 && placeholder &&
        !['sent', 'dismissed'].includes(placeholder.status || '')
      ) {
        upgrades.push({ id: placeholder.id, record })
        existingKeys.delete(placeholder.event_key)
        unattributedByListing.delete(String(listing.zpid))
      } else {
        records.push(record)
      }
      existingKeys.add(eventKey)
    }
  }

  if (records.length) {
    const response = await fetch(`${url}/rest/v1/partner_sale_signals?on_conflict=event_key`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(records),
    })
    if (!response.ok) throw new Error(await response.text())
  }

  for (const upgrade of upgrades) {
    const response = await fetch(`${url}/rest/v1/partner_sale_signals?id=eq.${encodeURIComponent(upgrade.id)}`, {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify(upgrade.record),
    })
    if (!response.ok) throw new Error(await response.text())
  }

  return {
    scanned: listings.length,
    created: records.length,
    upgraded: upgrades.length,
    matched: records.filter(row => row.contact_id).length,
    needs_match: records.filter(row => !row.contact_id).length,
    skipped_ottawa: skippedOttawa,
    awaiting_attribution: awaitingAttribution,
  }
}
