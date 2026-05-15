import type { ListingMatch } from './types'

function coercePositiveNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return parsed
}

export function getListingBedrooms(listing?: ListingMatch | null) {
  return coercePositiveNumber(listing?.bedrooms ?? listing?.beds)
}

export function getListingBathrooms(listing?: ListingMatch | null) {
  return coercePositiveNumber(listing?.bathrooms ?? listing?.baths)
}

export function getListingPropertyContext(listing?: ListingMatch | null) {
  const bedrooms = getListingBedrooms(listing)
  const bathrooms = getListingBathrooms(listing)
  if (!bedrooms && !bathrooms) return undefined
  return { bedrooms, bathrooms }
}

function formatCount(value: number, singular: string, plural = `${singular}s`) {
  return `${value % 1 === 0 ? value.toFixed(0) : value.toFixed(1)} ${value === 1 ? singular : plural}`
}

export function formatListingPropertySummary(listing?: ListingMatch | null) {
  const bedrooms = getListingBedrooms(listing)
  const bathrooms = getListingBathrooms(listing)
  const parts: string[] = []
  if (bedrooms) parts.push(formatCount(bedrooms, 'bed'))
  if (bathrooms) parts.push(formatCount(bathrooms, 'bath'))
  return parts.join(' · ')
}

function normalizeOptionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function coerceStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map(item => normalizeOptionalText(item))
      .filter((item): item is string => !!item)
  }
  const text = normalizeOptionalText(value)
  if (!text) return []
  return text
    .split(/[,;|]+/)
    .map(item => item.trim())
    .filter(Boolean)
}

export function getListingDescription(listing?: ListingMatch | null) {
  return normalizeOptionalText(listing?.description) || normalizeOptionalText(listing?.propertyDescription)
}

export function getListingParkingFeatures(listing?: ListingMatch | null) {
  return coerceStringArray(listing?.parkingFeatures)
}

export function getListingStreetViewMetadataUrl(listing?: ListingMatch | null) {
  return normalizeOptionalText(listing?.streetViewMetadataUrl)
}

export function getListingStreetViewUrl(listing?: ListingMatch | null) {
  return normalizeOptionalText(listing?.streetViewUrl)
}

function coercePositiveWholeNumber(value: unknown) {
  const parsed = coercePositiveNumber(value)
  return parsed ? Math.round(parsed) : undefined
}

export function getListingOperationalHighlights(listing?: ListingMatch | null) {
  if (!listing) return []

  const highlights: string[] = []
  const parkingFeatures = getListingParkingFeatures(listing)
  const basement = normalizeOptionalText(listing.basement)
  const livingArea = coercePositiveWholeNumber(listing.livingArea)
  const lotSize = coercePositiveWholeNumber(listing.lotSize)
  const yearBuilt = coercePositiveWholeNumber(listing.yearBuilt)
  const homeStatus = normalizeOptionalText(listing.homeStatus)

  if (parkingFeatures.length > 0) highlights.push(parkingFeatures.join(' · '))
  if (basement) highlights.push(basement)
  if (livingArea) highlights.push(`${livingArea.toLocaleString()} sq ft`)
  if (lotSize) highlights.push(`${lotSize.toLocaleString()} sq ft lot`)
  if (yearBuilt) highlights.push(`Built ${yearBuilt}`)
  if (homeStatus) highlights.push(homeStatus.replace(/_/g, ' '))
  if (getListingStreetViewMetadataUrl(listing)) highlights.push('Street View metadata available')

  return highlights
}

function getListingCompletenessScore(listing?: ListingMatch | null) {
  if (!listing) return 0

  let score = 0
  score += (listing.carouselphotos || []).length
  if (getListingBedrooms(listing)) score += 8
  if (getListingBathrooms(listing)) score += 8
  if (getListingDescription(listing)) score += 10
  if (getListingParkingFeatures(listing).length > 0) score += 8
  if (normalizeOptionalText(listing.basement)) score += 4
  if (coercePositiveNumber(listing.livingArea)) score += 4
  if (coercePositiveNumber(listing.yearBuilt)) score += 2
  if (getListingStreetViewMetadataUrl(listing)) score += 4
  return score
}

export function hasRichListingContext(listing?: ListingMatch | null) {
  if (!listing) return false
  return Boolean(
    getListingBedrooms(listing) ||
    getListingBathrooms(listing) ||
    getListingDescription(listing) ||
    getListingParkingFeatures(listing).length > 0 ||
    normalizeOptionalText(listing.basement) ||
    coercePositiveNumber(listing.livingArea) ||
    coercePositiveNumber(listing.yearBuilt) ||
    getListingStreetViewMetadataUrl(listing)
  )
}

export function shouldPreferListingSnapshot(current?: ListingMatch | null, candidate?: ListingMatch | null) {
  if (!candidate) return false
  if (!current) return true
  return getListingCompletenessScore(candidate) > getListingCompletenessScore(current)
}
