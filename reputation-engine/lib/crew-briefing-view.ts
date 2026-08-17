import { assessMoveIntelligence } from './move-intelligence'
import type { CRMLead, CRMQuote } from './types'

function listingPhotoUrls(lead: CRMLead) {
  return (lead.supabaseListing?.carouselphotos || []).map(photo => typeof photo === 'string' ? photo : photo.url).filter(Boolean)
}

export function buildLiveCrewBriefing(lead: CRMLead, quote: CRMQuote | null, authorizedBrief = '') {
  const intelligence = assessMoveIntelligence({
    inventory: lead.inventory || [],
    jobFactors: lead.jobFactors,
    originAddress: quote?.originAddress || lead.originAddress,
    destinationAddress: quote?.destAddress || lead.destAddress,
    legs: quote?.legs,
  })
  const pathByKey = new Map(intelligence.paths.map(path => [path.itemKey, path]))
  const inventory = (lead.inventory || []).map((item, index) => {
    const key = item.id || `${(item.roomId || item.sourcePhotoRoom || item.room || 'room').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${(item.name || item.item || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-')}:${index}`
    const path = pathByKey.get(key)
    return {
      id: key,
      label: item.name || item.item || 'Item',
      quantity: Math.max(1, Number(item.qty || 1)),
      room: item.room || item.sourcePhotoRoom || 'Room not assigned',
      destinationRoom: item.destinationRoom || '',
      included: item.included !== false,
      exclusionReason: item.exclusionReason || item.policyReason || '',
      notes: item.notes || '',
      handling: path?.handling.level || 'standard',
      handlingFlags: path?.handling.flags || [],
      assemblyRequired: (path?.handling.disassemblyLikelihood || 0) >= 0.65,
      pathRisks: path?.risks || [],
    }
  })
  const media = (lead.mediaAssets || [])
    .filter(asset => !asset.removed && asset.kind === 'image' && asset.category !== 'receipt')
    .map(asset => ({ id: asset.id, url: asset.url, label: asset.room || asset.partyLabel || asset.filename || 'Customer photo', source: asset.source }))
  const knownUrls = new Set(media.map(photo => photo.url))
  const photos = [...media, ...listingPhotoUrls(lead).filter(url => !knownUrls.has(url)).map((url, index) => ({ id: `listing-${index}`, url, label: 'Property reference', source: 'listing' }))].slice(0, 40)
  const directLeg = {
    id: 'direct', label: 'Move route', type: 'move',
    origin: [quote?.originAddress || lead.originAddress, quote?.originCity || lead.originCity].filter(Boolean).join(', ') || 'Pickup TBD',
    destination: [quote?.destAddress || lead.destAddress, quote?.destCity || lead.destCity].filter(Boolean).join(', ') || 'Delivery TBD',
    scheduledDate: quote?.moveDate || lead.moveDate || '', notes: '',
  }
  const routeLegs = quote?.legs?.length ? quote.legs.map((leg, index) => ({
    id: leg.id, label: leg.label || `Leg ${index + 1}`, type: leg.type,
    origin: [leg.originAddress, leg.originCity].filter(Boolean).join(', ') || 'Pickup TBD',
    destination: [leg.destAddress, leg.destCity].filter(Boolean).join(', ') || 'Delivery TBD',
    scheduledDate: leg.scheduledDate || '', notes: leg.notes || '',
  })) : [directLeg]
  const factors = lead.jobFactors
  const specialInstructions = Array.from(new Set([
    lead.crewNote,
    factors?.specialtyNotes,
    factors?.hasPiano ? 'Piano requires specialty handling.' : '',
    factors?.hasSafe ? 'Safe requires weight and equipment verification before lifting.' : '',
    factors?.hasHotTub ? 'Hot tub is flagged—verify it is excluded from crew scope.' : '',
    factors?.hasPoolTable ? 'Pool table is flagged—verify it is excluded from crew scope.' : '',
    factors?.packingStatus === 'not-started' ? 'Packing is reported as not started.' : '',
    factors?.packingStatus === 'partial' ? 'Packing is only partially complete.' : '',
  ].filter((value): value is string => Boolean(value?.trim()))))
  const changes = (quote?.changeLog || []).map(change => ({
    id: change.id, reason: change.reason, note: change.note || '', status: change.approvalStatus || 'not_required', changedAt: change.changedAt,
  }))
  return {
    generatedAt: new Date().toISOString(),
    sourceUpdatedAt: [lead.lastTouchedAt, quote?.acceptedAt, quote?.sentAt, ...changes.map(change => change.changedAt)].filter(Boolean).sort().at(-1) || '',
    quoteStatus: quote?.status || 'unknown',
    authorizedBrief,
    routeLegs,
    inventory,
    photos,
    specialInstructions,
    scopeLines: (quote?.lineItems || []).map(line => ({ description: line.description, details: line.details || '' })),
    changes,
    intelligence: {
      level: intelligence.level,
      uncertaintyPct: intelligence.uncertaintyPct,
      risks: intelligence.risks,
      unresolved: intelligence.questions.map(question => question.question),
    },
  }
}
