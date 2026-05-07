import type { EstimateRouteContext } from '@/lib/types'
import { getGoogleMapsApiKey } from '@/lib/server/runtime'

const BRANCH_YARDS: Record<string, string> = {
  windsor: 'Windsor, ON, Canada',
  waterloo: 'Kitchener, ON, Canada',
  london: 'London, ON, Canada',
  ottawa: 'Ottawa, ON, Canada',
}

const BASE_YARD_ADDRESS = BRANCH_YARDS.windsor

type GeocodeResult = {
  lat: number
  lng: number
  displayName: string
}

export type AddressSuggestion = {
  label: string
  city?: string
  placeType?: 'house' | 'apartment' | 'commercial' | 'unknown'
  placeId?: string
}

function extractAddressLocality(address?: Record<string, string | undefined>) {
  if (!address) return undefined
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.county ||
    address.state
  )
}

export function classifyRouteCategory(distanceKm: number, driveHours: number): EstimateRouteContext['routeCategory'] {
  if (driveHours >= 3 || distanceKm >= 300) return 'long-distance'
  if (driveHours >= 1.25 || distanceKm >= 80) return 'medium'
  return 'local'
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ca,us`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
    cache: 'no-store',
  })
  if (!response.ok) return null
  const results = (await response.json()) as Array<{ lat: string; lon: string; display_name: string }>
  if (!results.length) return null

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
    displayName: results[0].display_name,
  }
}

function detectApartmentFromText(label: string): AddressSuggestion['placeType'] {
  const lower = label.toLowerCase()
  if (/\b(apt|unit|suite|#\s*\d|floor\s+\d|fl\.\s*\d|ph\b|penthouse|condo)\b/.test(lower)) return 'apartment'
  if (/\b(tower|towers|plaza|centre|center|heights|terrace|court|park|estates|gardens)\b/.test(lower)) return 'apartment'
  return 'unknown'
}

async function suggestWithNominatim(query: string): Promise<AddressSuggestion[]> {
  const url =
    `https://nominatim.openstreetmap.org/search` +
    `?q=${encodeURIComponent(query)}` +
    `&format=jsonv2&limit=5&addressdetails=1&countrycodes=ca,us`

  const response = await fetch(url, {
    headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
    cache: 'no-store',
  })
  if (!response.ok) return []

  const results = (await response.json()) as Array<{
    display_name: string
    type?: string
    address?: Record<string, string | undefined>
  }>

  const seen = new Set<string>()
  return results
    .map(result => {
      const placeType: AddressSuggestion['placeType'] =
        result.type === 'house' || result.type === 'residential' ? 'house'
        : result.type === 'apartments' || result.type === 'flat' ? 'apartment'
        : detectApartmentFromText(result.display_name)
      return {
        label: result.display_name,
        city: extractAddressLocality(result.address),
        placeType,
      }
    })
    .filter(r => {
      if (!r.label || seen.has(r.label)) return false
      seen.add(r.label)
      return true
    })
}

export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < 5) return []

  // Try Google Places Autocomplete when API key is available
  const apiKey = getGoogleMapsApiKey()
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
        `?input=${encodeURIComponent(trimmed)}` +
        `&types=address` +
        `&components=country:ca|country:us` +
        `&key=${apiKey}`
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const data = (await res.json()) as {
          status: string
          predictions?: Array<{
            description: string
            place_id: string
            types?: string[]
          }>
        }
        if (data.status === 'OK' || data.status === 'ZERO_RESULTS') {
          return (data.predictions || []).map(p => {
            const types = p.types || []
            const placeType: AddressSuggestion['placeType'] =
              types.includes('subpremise') ? 'apartment'
              : types.includes('establishment') || types.includes('point_of_interest') ? 'commercial'
              : types.includes('street_address') || types.includes('premise') ? detectApartmentFromText(p.description)
              : detectApartmentFromText(p.description)
            const cityMatch = p.description.match(/,\s*([^,]+),\s*ON|,\s*([^,]+),\s*MI/)
            return {
              label: p.description,
              city: cityMatch?.[1] || cityMatch?.[2] || undefined,
              placeType,
              placeId: p.place_id,
            }
          })
        }
      }
    } catch { /* fall through to Nominatim */ }
  }

  // Fallback: Nominatim (OpenStreetMap) — always works, no API key needed
  return suggestWithNominatim(trimmed)
}

export async function getDrivingRoute(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number }
): Promise<{ distanceKm: number; driveHours: number } | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
    cache: 'no-store',
  })
  if (!response.ok) return null

  const data = (await response.json()) as {
    code: string
    routes?: Array<{ distance: number; duration: number }>
  }
  if (data.code !== 'Ok' || !data.routes?.length) return null

  return {
    distanceKm: Math.round(data.routes[0].distance / 1000),
    driveHours: Math.round((data.routes[0].duration / 3600) * 4) / 4,
  }
}

export async function estimateRouteContext(input: {
  origin: string
  destination?: string
  branch?: string
}): Promise<EstimateRouteContext & {
  category?: 'local' | 'medium' | 'long-distance'
  distanceKm?: number
  distanceMiles?: number
  driveHours?: number
  yardToOrigin?: { distanceKm: number; driveHours: number } | null
  originToDestination?: { distanceKm: number; driveHours: number } | null
  returnToOrigin?: { distanceKm: number; driveHours: number } | null
  originResolved?: string
  destResolved?: string
  yardResolved?: string
}> {
  const yardAddress = (input.branch && BRANCH_YARDS[input.branch]) ? BRANCH_YARDS[input.branch] : BASE_YARD_ADDRESS

  const [originGeo, yardGeo, destGeo] = await Promise.all([
    geocodeAddress(input.origin.trim()),
    geocodeAddress(yardAddress),
    input.destination?.trim() ? geocodeAddress(input.destination.trim()) : Promise.resolve(null),
  ])

  if (!originGeo) {
    throw new Error(`Could not locate: "${input.origin}"`)
  }
  if (!yardGeo) {
    throw new Error('Could not locate Saturn Star yard/base')
  }

  const yardToOrigin = await getDrivingRoute(yardGeo, originGeo)
  if (!yardToOrigin) {
    throw new Error('Could not calculate yard to origin drive time')
  }

  if (!input.destination?.trim()) {
    return {
      pricingStatus: 'provisional',
      routeCategory: 'local',
      category: 'local',
      distanceKm: yardToOrigin.distanceKm,
      distanceMiles: Math.round(yardToOrigin.distanceKm * 0.621371),
      driveHours: yardToOrigin.driveHours,
      yardToOriginHours: yardToOrigin.driveHours,
      billableDistanceKm: yardToOrigin.distanceKm,
      operationalDistanceKm: yardToOrigin.distanceKm,
      billableDriveHours: yardToOrigin.driveHours,
      operationalDriveHours: yardToOrigin.driveHours,
      yardToOrigin,
      originToDestination: null,
      returnToOrigin: null,
      missingRequirements: ['Destination address or city needed for travel estimate'],
      originResolved: originGeo.displayName,
      yardResolved: yardGeo.displayName,
    }
  }

  if (!destGeo) {
    throw new Error(`Could not locate: "${input.destination}"`)
  }

  const [originToDestination, returnToOrigin] = await Promise.all([
    getDrivingRoute(originGeo, destGeo),
    getDrivingRoute(destGeo, originGeo),
  ])

  if (!originToDestination || !returnToOrigin) {
    throw new Error('Could not calculate driving route between these addresses')
  }

  const routeCategory = classifyRouteCategory(originToDestination.distanceKm, originToDestination.driveHours)

  const billableDistanceKm =
    routeCategory === 'long-distance'
      ? originToDestination.distanceKm + returnToOrigin.distanceKm
      : yardToOrigin.distanceKm + originToDestination.distanceKm

  const operationalDistanceKm =
    routeCategory === 'long-distance'
      ? yardToOrigin.distanceKm + originToDestination.distanceKm + returnToOrigin.distanceKm
      : yardToOrigin.distanceKm + originToDestination.distanceKm

  const billableDriveHours =
    routeCategory === 'long-distance'
      ? originToDestination.driveHours + returnToOrigin.driveHours
      : yardToOrigin.driveHours + originToDestination.driveHours

  const operationalDriveHours =
    routeCategory === 'long-distance'
      ? yardToOrigin.driveHours + originToDestination.driveHours + returnToOrigin.driveHours
      : yardToOrigin.driveHours + originToDestination.driveHours

  return {
    pricingStatus: 'ready',
    routeCategory,
    category: routeCategory,
    distanceKm: originToDestination.distanceKm,
    distanceMiles: Math.round(originToDestination.distanceKm * 0.621371),
    driveHours: originToDestination.driveHours,
    yardToOriginHours: yardToOrigin.driveHours,
    originToDestinationHours: originToDestination.driveHours,
    returnTripHours: returnToOrigin.driveHours,
    originToDestinationDistanceKm: originToDestination.distanceKm,
    yardToOriginDistanceKm: yardToOrigin.distanceKm,
    returnTripDistanceKm: returnToOrigin.distanceKm,
    billableDistanceKm,
    operationalDistanceKm,
    billableDriveHours,
    operationalDriveHours,
    yardToOrigin,
    originToDestination,
    returnToOrigin,
    missingRequirements: [],
    originResolved: originGeo.displayName,
    destResolved: destGeo.displayName,
    yardResolved: yardGeo.displayName,
  }
}
