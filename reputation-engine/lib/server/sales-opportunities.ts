import { createHash } from 'node:crypto'
import { dateStamp, detectSalesBranchFromLocation, isLocationWithinBranchServiceArea, normalizeLead } from '@/lib/sales'
import { hasListingStreet, listingAddressKey, decideListingMatch } from '@/lib/listing-match'
import type { CRMLead } from '@/lib/types'
import { getSalesLeadForUpdate, getListingInventoryScan, resolveListingsByAddress, listSalesOpportunityLeadsBySourceLeadId } from './sales-repository'
import { destinationDb } from './destination-db'

export function applyDetectedBranch(lead: CRMLead) {
  return normalizeLead({ ...lead, branch: lead.branch || detectSalesBranchFromLocation(lead.originCity, lead.originAddress)
    || detectSalesBranchFromLocation(lead.destCity, lead.destAddress) })
}

/** Discovery is persisted atomically with its source link and research job. Never sends. */
export async function maybeCreateDestinationOpportunityLead(_current: CRMLead, saved: CRMLead, force = false): Promise<CRMLead> {
  if (saved.leadKind === 'realtor_opportunity' || saved.leadKind === 'partner_opportunity') return saved
  for (let attempt = 0; attempt < 3; attempt++) {
    const source = await getSalesLeadForUpdate(saved.id)
    if (!source) return saved
    const lead = source.lead
    const key = listingAddressKey(lead.destAddress, lead.destCity)
    const linked = lead.destinationOpportunityLeadId ? await getSalesLeadForUpdate(lead.destinationOpportunityLeadId) : null
    if (linked && linked.lead.primaryContactRole === 'customer') return lead // Converted client jobs retain their own operating data.
    const address = [lead.destAddress?.split(',')[0], lead.destCity || lead.destAddress?.split(',')[1], 'ON'].filter(Boolean).join(', ')
    const city = lead.destCity || lead.destAddress?.split(',')[1]
    const branch = detectSalesBranchFromLocation(city, lead.destAddress) || lead.branch
    const eligible = hasListingStreet(lead.destAddress) && !!city && !['lost', 'completed'].includes(lead.stage)
      && (!lead.moveDate || lead.moveDate >= dateStamp())
    const matchingSnapshot = linked?.lead.supabaseListing && decideListingMatch(address, [linked.lead.supabaseListing]).listing
    const unchanged = linked?.lead.realtorResearch?.version === 2 && linked.lead.realtorResearch.propertyKey === key
      && matchingSnapshot && linked.lead.sourceLeadMoveDate === lead.moveDate && eligible
    if (unchanged && !force) return lead
    // Misses are retried at most once per day, or immediately after input changes.
    if (!force && !linked && lead.destinationOpportunityLastCheckedAt?.slice(0,10) === dateStamp()
      && listingAddressKey(_current.destAddress, _current.destCity) === key && _current.moveDate === lead.moveDate
      && _current.stage === lead.stage) return lead
    const inArea = branch && isLocationWithinBranchServiceArea(branch, city, lead.destAddress)
    const decision = eligible && inArea ? await resolveListingsByAddress(address) : null
    const listing = decision?.listing || null
    let opportunity: CRMLead | null = null
    let version: string | null = null
    if (listing) {
      const prior = linked || await (async () => {
        const matches = (await listSalesOpportunityLeadsBySourceLeadId(lead.id)).filter(item =>
          listingAddressKey(item.opportunityAddress || item.originAddress, item.opportunityCity || item.originCity) === key)
        matches.sort((a,b)=>(b.realtorOutreachStartedAt || b.createdAt || '').localeCompare(a.realtorOutreachStartedAt || a.createdAt || '') || a.id.localeCompare(b.id))
        return matches.length ? getSalesLeadForUpdate(matches[0].id) : null
      })()
      version = prior?.updatedAt || null
      const old = prior?.lead
      const same = old?.realtorResearch?.propertyKey === key && !!old.supabaseListing
        && String(old.supabaseListing.zpid) === String(listing.zpid)
      const scan = same ? old?.listingScanSnapshot : await getListingInventoryScan(listing.zpid).catch(() => null)
      const now = new Date().toISOString()
      const research = same && old?.realtorResearch?.status === 'verified' ? old.realtorResearch
        : { version: 2 as const, propertyKey: key, status: 'pending' as const, checkedAt: now, candidates: [] }
      opportunity = normalizeLead({
        ...(old || {}), id: old?.id || `destination_${createHash('sha256').update(lead.id + '|' + key).digest('hex').slice(0,24)}`,
        name: `Realtor lead — ${lead.destAddress}`, leadKind: 'realtor_opportunity', source: 'destination_opportunity',
        automationStatus: 'handoff', automationHandoffReason: 'Destination opportunity requires relationship review.',
        primaryContactRole: 'realtor', stage: old?.stage || 'new', branch,
        sourceLeadId: lead.id, sourceLeadName: lead.name, sourceLeadMoveDate: lead.moveDate, sourceLeadQuoteId: lead.quoteId,
        moveDate: lead.moveDate, opportunityAddress: lead.destAddress, opportunityCity: city,
        originAddress: lead.destAddress, originCity: city, supabaseListing: listing, realtorResearch: research,
        realtorName: same ? old?.realtorName : undefined, realtorPhone: same ? old?.realtorPhone : undefined,
        realtorEmail: same ? old?.realtorEmail : undefined, realtorContactId: same ? old?.realtorContactId : undefined,
        realtorBrokerage: same ? old?.realtorBrokerage : listing.brokername || undefined,
        realtorContactKind: same ? old?.realtorContactKind : undefined,
        realtorLookupConfidence: same ? old?.realtorLookupConfidence : undefined,
        realtorLookupStatus: research.status === 'verified' ? 'matched' : 'partial',
        realtorOutreachStatus: old?.realtorOutreachStartedAt ? old.realtorOutreachStatus : 'not_started',
        inventory: same ? old?.inventory || [] : [], listingScanSnapshot: scan || null,
        totalItems: same ? old?.totalItems || 0 : 0, totalCubicFeet: same ? old?.totalCubicFeet || 0 : 0,
        totalWeightLbs: same ? old?.totalWeightLbs || 0 : 0, roomBreakdown: same ? old?.roomBreakdown || {} : {},
        createdAt: old?.createdAt || dateStamp(), opportunityDetectedAt: old?.opportunityDetectedAt || now,
        followUpDate: dateStamp(), followUpNote: 'Review the verified listing agent and existing partnership before outreach.',
        notes: old?.notes || 'Destination move opportunity. Confirm whether the listing-side client needs moving services; pricing depends on scope and trip coordination.',
      })
    } else if (linked) {
      // Preserve history, but invalidate stale identity rather than pitching the old property.
      opportunity = { ...linked.lead, sourceLeadMoveDate: lead.moveDate, moveDate: lead.moveDate,
        opportunityAddress: lead.destAddress, opportunityCity: city, supabaseListing: null,
        realtorResearch: { version: 2, propertyKey: key, status: 'stale', checkedAt: new Date().toISOString(), candidates: [],
          error: !eligible ? 'Complete the destination and confirm an upcoming active move.' : 'No unambiguous property match. Review destination.' },
        realtorContactId: undefined, realtorName: undefined, realtorPhone: undefined, realtorEmail: undefined,
        realtorBrokerage: undefined, realtorLookupStatus: 'missing', realtorContactKind: undefined,
      }
      version = linked.updatedAt
    }
    const committed = await destinationDb<boolean>('rpc/reconcile_destination_opportunity', {
      method: 'POST', body: JSON.stringify({ source_id: lead.id, source_version: source.updatedAt, opportunity,
        opportunity_version: version, source_status: listing ? (linked ? 'linked_existing' : 'generated') : !inArea && eligible ? 'outside_area' : 'no_match', property_key: key }),
    })
    if (committed) return (await getSalesLeadForUpdate(lead.id))?.lead || lead
  }
  throw new Error('Destination changed during discovery. Save again to retry.')
}
