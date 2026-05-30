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
