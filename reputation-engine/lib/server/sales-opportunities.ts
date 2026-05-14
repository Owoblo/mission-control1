import { dateStamp, detectSalesBranchFromLocation, isLocationWithinBranchServiceArea, normalizeLead, uid } from '@/lib/sales'
import type { CRMLead, DestinationOpportunityStatus, RealtorLookupStatus } from '@/lib/types'
import {
  getListingInventoryScan,
  listSalesOpportunityLeadsBySourceLeadId,
  lookupListingsByAddress,
  saveFollowUpLog,
  saveSalesLead,
} from '@/lib/server/sales-repository'
import { readEnv } from '@/lib/server/runtime'

function normalizeAddressKey(...values: Array<string | null | undefined>) {
  return values
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildDestinationLabel(lead: CRMLead) {
  return [lead.destAddress, lead.destCity].filter(Boolean).join(', ').trim() || 'destination address'
}

function buildOpportunityLeadName(lead: CRMLead) {
  return `Realtor lead — ${lead.destAddress || lead.destCity || 'move opportunity'}`
}

function buildOpportunityNote(sourceLead: CRMLead, extras: { brokerage?: string; hasScan?: boolean }) {
  const lines = [
    `Auto-generated from lead ${sourceLead.id}.`,
    `Source move: ${sourceLead.name || 'Customer'} into ${buildDestinationLabel(sourceLead)}.`,
    `Pitch: offer the current occupant a discounted move since Saturn Star is already coordinating trucks to this address.`,
  ]

  if (sourceLead.moveDate) {
    lines.push(`Planned move date on source lead: ${sourceLead.moveDate}.`)
  }

  if (extras.brokerage) {
    lines.push(`Listing brokerage on file: ${extras.brokerage}.`)
  }

  if (extras.hasScan) {
    lines.push('MLS inventory scan is already available for remote quote support.')
  } else {
    lines.push('No stored inventory scan was found yet.')
  }

  return lines.join(' ')
}

function inferLeadBranch(lead: CRMLead) {
  return (
    lead.branch ||
    detectSalesBranchFromLocation(lead.originCity, lead.originAddress) ||
    detectSalesBranchFromLocation(lead.destCity, lead.destAddress) ||
    detectSalesBranchFromLocation(lead.opportunityCity, lead.opportunityAddress)
  )
}

// Runs in background — no await, failures are silent
export async function runRealtorLookupBackground(lead: CRMLead) {
  const apiKey = readEnv('OPENAI_API_KEY')
  if (!apiKey) return
  if (lead.realtorName && (lead.realtorPhone || lead.realtorEmail)) return // already have full contact

  const address = [lead.opportunityAddress || lead.originAddress, lead.opportunityCity || lead.originCity]
    .filter(Boolean).join(', ')
  if (!address) return

  try {
    const brokerage = lead.realtorBrokerage || ''
    const query = `Who is the listing agent/realtor for ${address}${brokerage ? ` listed by ${brokerage}` : ''}? Find their name, phone number, and email address.`

    const searchRes = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', tools: [{ type: 'web_search_preview' }], input: query }),
      signal: AbortSignal.timeout(45000),
    })
    if (!searchRes.ok) return

    const searchData = (await searchRes.json()) as {
      output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>
      output_text?: string
    }
    const rawText =
      searchData.output_text ||
      searchData.output?.flatMap(item => item.content || []).find(c => c.type === 'output_text')?.text || ''
    if (!rawText) return

    const extractRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        max_tokens: 250,
        temperature: 0.0,
        messages: [{ role: 'user', content: `Extract realtor contact info from this text about ${address}:\n\n${rawText}\n\nReturn JSON only: {"realtorName": null, "realtorPhone": null, "realtorEmail": null, "realtorBrokerage": null}. Use null if not found. Do NOT invent numbers.` }],
      }),
    })
    const extractData = (await extractRes.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const content = extractData.choices?.[0]?.message?.content || '{}'
    const extracted: Record<string, string | null> = JSON.parse(content)

    const updates: Partial<CRMLead> = { realtorEnrichedAt: new Date().toISOString() }
    if (extracted.realtorName && !lead.realtorName) updates.realtorName = extracted.realtorName
    if (extracted.realtorPhone && !lead.realtorPhone) updates.realtorPhone = extracted.realtorPhone
    if (extracted.realtorEmail && !lead.realtorEmail) updates.realtorEmail = extracted.realtorEmail
    if (extracted.realtorBrokerage && !lead.realtorBrokerage) updates.realtorBrokerage = extracted.realtorBrokerage

    const name = updates.realtorName || lead.realtorName
    const phone = updates.realtorPhone || lead.realtorPhone
    const email = updates.realtorEmail || lead.realtorEmail
    updates.realtorLookupStatus = (phone || email) ? 'matched' : name ? 'partial' : 'missing'

    if (Object.keys(updates).length > 1) {
      await saveSalesLead({ ...lead, ...updates })
    }
  } catch { /* non-fatal */ }
}

export function applyDetectedBranch(lead: CRMLead) {
  const detectedBranch = inferLeadBranch(lead)
  return detectedBranch && detectedBranch !== lead.branch
    ? normalizeLead({ ...lead, branch: detectedBranch })
    : normalizeLead(lead)
}

function getLookupStatus(input: { realtorName?: string; realtorEmail?: string; realtorPhone?: string; brokerage?: string }): RealtorLookupStatus {
  if (input.realtorEmail || input.realtorPhone) return 'matched'
  if (input.realtorName || input.brokerage) return 'partial'
  return 'missing'
}

async function updateSourceOpportunityStatus(lead: CRMLead, status: DestinationOpportunityStatus, leadId?: string) {
  const next = await saveSalesLead({
    ...lead,
    destinationOpportunityLeadId: leadId,
    destinationOpportunityStatus: status,
    destinationOpportunityLastCheckedAt: new Date().toISOString(),
  })
  return next
}

export async function maybeCreateDestinationOpportunityLead(current: CRMLead, saved: CRMLead) {
  if (saved.leadKind === 'realtor_opportunity') {
    return saved
  }

  const currentDestKey = normalizeAddressKey(current.destAddress, current.destCity)
  const nextDestKey = normalizeAddressKey(saved.destAddress, saved.destCity)
  const destinationChanged = currentDestKey !== nextDestKey
  const shouldEvaluate = destinationChanged || (!saved.destinationOpportunityLeadId && !saved.destinationOpportunityStatus)

  if (!shouldEvaluate || nextDestKey.length < 8) {
    return saved
  }

  const branch = inferLeadBranch(saved)
  if (!branch || !isLocationWithinBranchServiceArea(branch, saved.destCity, saved.destAddress)) {
    return updateSourceOpportunityStatus({ ...saved, branch }, 'outside_area')
  }

  const listing = (await lookupListingsByAddress(buildDestinationLabel(saved)))[0] || null
  if (!listing) {
    return updateSourceOpportunityStatus({ ...saved, branch }, 'no_match')
  }

  const listingCity = listing.city || saved.destCity
  if (!isLocationWithinBranchServiceArea(branch, listingCity, listing.address || saved.destAddress)) {
    return updateSourceOpportunityStatus({ ...saved, branch }, 'outside_area')
  }

  const existingOpportunityLeads = await listSalesOpportunityLeadsBySourceLeadId(saved.id)
  const existing = existingOpportunityLeads.find(item => {
    const itemKey = normalizeAddressKey(item.opportunityAddress, item.opportunityCity, item.originAddress, item.originCity)
    return itemKey === nextDestKey
  })

  const scan = await getListingInventoryScan(listing.zpid).catch(() => null)
  const brokerage = listing.brokername?.trim() || undefined
  const now = new Date().toISOString()
  const realtorLookupStatus = getLookupStatus({ brokerage })

  if (existing) {
    const nextOpportunity = await saveSalesLead({
      ...existing,
      branch,
      sourceLeadId: saved.id,
      sourceLeadName: saved.name,
      sourceLeadMoveDate: saved.moveDate,
      sourceLeadQuoteId: saved.quoteId,
      opportunityAddress: saved.destAddress,
      opportunityCity: saved.destCity,
      opportunityDetectedAt: existing.opportunityDetectedAt || now,
      moveDate: saved.moveDate,
      moveType: existing.moveType || saved.moveType,
      originAddress: saved.destAddress,
      originCity: saved.destCity,
      supabaseListing: listing,
      inventory: (existing.inventory && existing.inventory.length > 0) ? existing.inventory : (scan?.inventory || []),
      totalItems: existing.totalItems || scan?.totalItems || 0,
      totalCubicFeet: existing.totalCubicFeet || scan?.totalCubicFeet || 0,
      totalWeightLbs: existing.totalWeightLbs || scan?.totalWeightLbs || 0,
      roomBreakdown: (existing.roomBreakdown && Object.keys(existing.roomBreakdown).length > 0) ? existing.roomBreakdown : (scan?.roomBreakdown || {}),
      realtorBrokerage: existing.realtorBrokerage || brokerage,
      realtorLookupStatus: getLookupStatus({
        realtorName: existing.realtorName,
        realtorEmail: existing.realtorEmail,
        realtorPhone: existing.realtorPhone,
        brokerage: existing.realtorBrokerage || brokerage,
      }),
      notes: existing.notes || buildOpportunityNote(saved, { brokerage, hasScan: !!scan }),
    })

    return updateSourceOpportunityStatus({ ...saved, branch }, 'linked_existing', nextOpportunity.id)
  }

  const opportunityLead = await saveSalesLead(
    normalizeLead({
      id: uid('lead'),
      name: buildOpportunityLeadName(saved),
      stage: 'new',
      branch,
      leadKind: 'realtor_opportunity',
      primaryContactRole: 'realtor',
      source: 'destination_opportunity',
      moveDate: saved.moveDate,
      moveType: saved.moveType || 'residential',
      originAddress: saved.destAddress,
      originCity: saved.destCity,
      supabaseListing: listing,
      realtorBrokerage: brokerage,
      realtorLookupStatus,
      sourceLeadId: saved.id,
      sourceLeadName: saved.name,
      sourceLeadMoveDate: saved.moveDate,
      sourceLeadQuoteId: saved.quoteId,
      opportunityAddress: saved.destAddress,
      opportunityCity: saved.destCity,
      opportunityDetectedAt: now,
      followUpDate: dateStamp(),
      followUpNote: 'Reach out to the listing side about a destination-move opportunity.',
      moveReason: 'Destination-side opportunity lead',
      notes: buildOpportunityNote(saved, { brokerage, hasScan: !!scan }),
      inventory: scan?.inventory || [],
      totalItems: scan?.totalItems || 0,
      totalCubicFeet: scan?.totalCubicFeet || 0,
      totalWeightLbs: scan?.totalWeightLbs || 0,
      roomBreakdown: scan?.roomBreakdown || {},
      callLogs: [],
      createdAt: dateStamp(),
    })
  )

  await Promise.all([
    saveFollowUpLog({
      id: uid('fu'),
      leadId: saved.id,
      type: 'note',
      date: now,
      createdAt: now,
      notes: `Destination opportunity lead generated: ${opportunityLead.name} (${opportunityLead.id}).`,
    }),
    saveFollowUpLog({
      id: uid('fu'),
      leadId: opportunityLead.id,
      type: 'note',
      date: now,
      createdAt: now,
      notes: `Lead auto-generated from source lead ${saved.id} for ${buildDestinationLabel(saved)}.`,
    }),
  ])

  // Auto-lookup realtor contact in background — don't block the save flow
  void runRealtorLookupBackground(opportunityLead)

  return updateSourceOpportunityStatus({ ...saved, branch }, 'generated', opportunityLead.id)
}
