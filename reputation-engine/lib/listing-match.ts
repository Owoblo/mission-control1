import type { ListingMatch, ListingMatchDecision, ListingMatchStatus } from './types'

const STREET_SUFFIX_CANONICAL: Record<string, string> = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr', boulevard: 'blvd', blvd: 'blvd', lane: 'ln', ln: 'ln',
  court: 'crt', crt: 'crt', crescent: 'cres', cres: 'cres', place: 'pl', pl: 'pl',
  terrace: 'terr', terr: 'terr', trail: 'trl', trl: 'trl', circle: 'cir', cir: 'cir',
  parkway: 'pkway', pkway: 'pkway', highway: 'hwy', hwy: 'hwy',
}

export function normalizeListingAddress(value: string) {
  return (value.split(',')[0] || value)
    .toLowerCase()
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => STREET_SUFFIX_CANONICAL[token] || token)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function extractListingUnit(value: string) {
  const normalized = normalizeListingAddress(value)
  const prefix = normalized.match(/^([a-z]?\d+[a-z]?)-(?=\d)/i)
  if (prefix?.[1]) return prefix[1].toLowerCase()
  const hash = normalized.match(/#\s*([a-z0-9-]+)/i)
  if (hash?.[1]) return hash[1].toLowerCase()
  const named = normalized.match(/\b(?:unit|apt|apartment|suite|ste)\s*([a-z0-9-]+)/i)
  return named?.[1]?.toLowerCase() || null
}

export function stripListingUnit(value: string) {
  return normalizeListingAddress(value)
    .replace(/^[a-z]?\d+[a-z]?-(?=\d)/i, '')
    .replace(/#\s*[a-z0-9-]+\b/ig, ' ')
    .replace(/\b(?:unit|apt|apartment|suite|ste)\s*[a-z0-9-]+\b/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function listingPhotoCount(listing: ListingMatch) {
  return Array.isArray(listing.carouselphotos) ? listing.carouselphotos.length : 0
}

export function scoreListingCandidate(query: string, listing: ListingMatch) {
  const queryAddress = normalizeListingAddress(query)
  const queryBase = stripListingUnit(query)
  const queryUnit = extractListingUnit(query)
  const listingAddress = normalizeListingAddress(listing.address || '')
  const listingBase = stripListingUnit(listing.address || '')
  const listingUnit = extractListingUnit(listing.address || '')
  let score = 0

  if (listingAddress === queryAddress) score += 400
  if (listingBase === queryBase) score += 220
  else if (listingBase.includes(queryBase) || queryBase.includes(listingBase)) score += 80

  // A different unit must never be rescued by having more photos.
  if (queryUnit && listingUnit) score += queryUnit === listingUnit ? 300 : -500
  else if (queryUnit && !listingUnit) score -= 250
  else if (!queryUnit && listingUnit) score -= 10

  score += Math.min(listingPhotoCount(listing), 50)
  if (listing.status === 'active' || listing.homeStatus === 'FOR_SALE') score += 15
  if (listing.furniture_scan_date) score += 10
  return score
}

export function decideListingMatch(query: string, listings: ListingMatch[]): ListingMatchDecision {
  const queryUnit = extractListingUnit(query)
  const queryBase = stripListingUnit(query)
  const related = listings
    .filter(listing => {
      const base = stripListingUnit(listing.address || '')
      return base === queryBase || base.includes(queryBase) || queryBase.includes(base)
    })
  const exactBase = related.filter(listing => stripListingUnit(listing.address || '') === queryBase)
  const baseCandidates = exactBase.length > 0 ? exactBase : related
  const cityCandidates = baseCandidates.filter(listing => listing.city && query.toLowerCase().includes(listing.city.toLowerCase()))
  const candidates = (cityCandidates.length > 0 ? cityCandidates : baseCandidates)
    .sort((left, right) => scoreListingCandidate(query, right) - scoreListingCandidate(query, left))
    .slice(0, 50)

  let status: ListingMatchStatus = 'no_match'
  let listing: ListingMatch | null = null

  if (queryUnit) {
    const exact = candidates.filter(candidate => extractListingUnit(candidate.address) === queryUnit)
    if (exact.length > 0) {
      status = 'exact_unit'
      listing = exact[0]
    } else if (candidates.length > 0) {
      status = 'unit_not_found'
    }
  } else if (candidates.length === 1 && !extractListingUnit(candidates[0].address)) {
    status = 'exact_address'
    listing = candidates[0]
  } else if (candidates.length > 0) {
    status = candidates.length > 1 ? 'ambiguous_building' : 'building_only'
  }

  return {
    status,
    listing,
    candidates,
    requestedAddress: query,
    requestedUnit: queryUnit,
    requiresSelection: !listing && candidates.length > 0,
  }
}

export function selectListingCandidate(decision: ListingMatchDecision, zpid: string) {
  const listing = decision.candidates.find(candidate => String(candidate.zpid) === String(zpid)) || null
  return listing ? { ...decision, status: 'selected' as const, listing, requiresSelection: false } : decision
}

export function extractListingReference(input: string) {
  const value = input.trim()
  const zpid = value.match(/\/(\d+)_zpid(?:\/|\?|$)/i)?.[1] || value.match(/[?&]zpid=(\d+)/i)?.[1]
  const mls = value.match(/[?&](?:mls|mlsid|listingid)=([a-z0-9-]+)/i)?.[1]
    || value.match(/\b(?:MLS|listing)\s*#?\s*([a-z0-9-]{5,})\b/i)?.[1]
    || (!/^https?:\/\//i.test(value) && /^[a-z]+\d[a-z0-9-]{4,}$/i.test(value) ? value : undefined)
  let address: string | undefined
  if (/realtor\.com/i.test(value)) {
    const slug = value.match(/\/realestateandhomes-detail\/([^/?#]+)/i)?.[1]
    if (slug) address = decodeURIComponent(slug).replace(/_/g, ', ').replace(/-/g, ' ').replace(/, M\d+.*$/i, '').trim()
  }
  return { zpid: zpid || undefined, mlsId: mls || undefined, url: /^https?:\/\//i.test(value) ? value : undefined, address }
}
