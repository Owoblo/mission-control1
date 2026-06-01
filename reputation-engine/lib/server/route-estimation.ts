import type { EstimateRouteContext } from '@/lib/types'
import { getGoogleMapsApiKey } from '@/lib/server/runtime'

const BRANCH_YARDS: Record<string, string> = {
  windsor: 'Windsor, ON, Canada',
  waterloo: 'Kitchener, ON, Canada',
  london: 'London, ON, Canada',
  ottawa: 'Ottawa, ON, Canada',
}

// Hardcoded yard coordinates — never fails, no geocoding needed for known branches
const BRANCH_YARD_COORDS: Record<string, GeocodeResult> = {
  windsor:  { lat: 42.3149, lng: -83.0364, displayName: 'Windsor, ON (Saturn Star base)' },
  waterloo: { lat: 43.4516, lng: -80.4925, displayName: 'Kitchener, ON (Saturn Star base)' },
  london:   { lat: 42.9849, lng: -81.2453, displayName: 'London, ON (Saturn Star base)' },
  ottawa:   { lat: 45.4215, lng: -75.6972, displayName: 'Ottawa, ON (Saturn Star base)' },
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
  // Long distance: > 200km or > 2.5h — one-way U-Haul makes more sense than returning the truck
  if (driveHours >= 2.5 || distanceKm >= 200) return 'long-distance'
  if (driveHours >= 1.25 || distanceKm >= 80) return 'medium'
  return 'local'
}

// Resolve a place_id directly — most accurate, no re-geocoding needed
export async function geocodeByPlaceId(placeId: string): Promise<GeocodeResult | null> {
  const apiKey = getGoogleMapsApiKey()
  if (!apiKey) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=geometry,formatted_address&key=${apiKey}`
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    const data = (await res.json()) as {
      status: string
      result?: { geometry: { location: { lat: number; lng: number } }; formatted_address: string }
    }
    if (data.status === 'OK' && data.result) {
      return {
        lat: data.result.geometry.location.lat,
        lng: data.result.geometry.location.lng,
        displayName: data.result.formatted_address,
      }
    }
  } catch { /* ignore */ }
  return null
}

export async function geocodeAddress(address: string): Promise<GeocodeResult | null> {
  // Try Google Geocoding first — more reliable for addresses from Google Places autocomplete
  const apiKey = getGoogleMapsApiKey()
  if (apiKey) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${apiKey}`
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = (await res.json()) as {
          status: string
          results?: Array<{
            geometry: { location: { lat: number; lng: number } }
            formatted_address: string
          }>
        }
        if (data.status === 'OK' && data.results?.length) {
          return {
            lat: data.results[0].geometry.location.lat,
            lng: data.results[0].geometry.location.lng,
            displayName: data.results[0].formatted_address,
          }
        }
      }
    } catch { /* fall through to Nominatim */ }
  }

  // Fallback 2: Mapbox Geocoding — better rural Canadian coverage than Nominatim
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN
  if (mapboxToken) {
    try {
      const mbUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${mapboxToken}&country=ca,us&limit=1`
      const mbRes = await fetch(mbUrl, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (mbRes.ok) {
        const mbData = (await mbRes.json()) as {
          features?: Array<{ center: [number, number]; place_name: string }>
        }
        if (mbData.features?.length) {
          const [lng, lat] = mbData.features[0].center
          return { lat, lng, displayName: mbData.features[0].place_name }
        }
      }
    } catch { /* fall through to Nominatim */ }
  }

  // Fallback 3: Nominatim (OpenStreetMap)
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
  const mapboxToken = process.env.MAPBOX_ACCESS_TOKEN
  if (mapboxToken) {
    try {
      // Mapbox Directions API — production-grade, reliable, fast
      const coords = `${origin.lng},${origin.lat};${dest.lng},${dest.lat}`
      const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${mapboxToken}&overview=false`
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (res.ok) {
        const data = (await res.json()) as {
          code: string
          routes?: Array<{ distance: number; duration: number }>
        }
        if (data.code === 'Ok' && data.routes?.length) {
          return {
            distanceKm: Math.round(data.routes[0].distance / 1000),
            driveHours: Math.round((data.routes[0].duration / 3600) * 4) / 4,
          }
        }
      }
    } catch { /* fall through to OSRM */ }
  }

  // Fallback: OSRM (free, no key needed)
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
    cache: 'no-store',
    signal: AbortSignal.timeout(5000),
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
  originDisplayName?: string
  destDisplayName?: string
  yardOverride?: GeocodeResult  // nearest U-Haul depot coords — use as yard base
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
  // Use hardcoded coords for known branches — no geocoding needed, never fails
  const yardGeoHardcoded = input.branch ? BRANCH_YARD_COORDS[input.branch] : BRANCH_YARD_COORDS.windsor

  // Geocode with fallback: if full address fails, try stripping the last token
  // Also handles pre-resolved "lat,lng" format passed from place_id resolution
  async function geocodeWithFallback(address: string) {
    // If already a lat,lng coordinate (from place_id resolution), parse directly
    const latLngMatch = address.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/)
    if (latLngMatch) {
      return { lat: parseFloat(latLngMatch[1]), lng: parseFloat(latLngMatch[2]), displayName: address }
    }
    const result = await geocodeAddress(address)
    if (result) return result
    const parts = address.split(',').map(p => p.trim()).filter(Boolean)
    if (parts.length > 2) {
      return geocodeAddress(parts.slice(0, -1).join(', '))
    }
    return null
  }

  const [originGeo, destGeo] = await Promise.all([
    geocodeWithFallback(input.origin.trim()),
    input.destination?.trim() ? geocodeWithFallback(input.destination.trim()) : Promise.resolve(null),
  ])

  // Yard: use nearest U-Haul when provided (most accurate), else hardcoded branch coords
  const yardGeo = input.yardOverride ?? yardGeoHardcoded

  if (!originGeo) {
    throw new Error(`Could not locate: "${input.origin}"`)
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
