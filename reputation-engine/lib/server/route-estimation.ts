import type { EstimateRouteContext } from '@/lib/types'
import { getGoogleMapsApiKey } from './runtime'

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

const ROUTE_BRANCH_ALIASES: Record<string, string[]> = {
  waterloo: [
    'waterloo',
    'kitchener',
    'cambridge',
    'guelph',
    'elmira',
    'st jacobs',
    'st. jacobs',
    'baden',
    'wilmot',
    'new hamburg',
    'wellesley',
    'elora',
    'fergus',
    'centre wellington',
    'conestogo',
    'breslau',
    'ayr',
    'preston',
    'hespeler',
    'doon',
    'kw',
    'k w',
  ],
  london: ['london', 'st thomas', 'st. thomas', 'woodstock', 'stratford', 'ingersoll', 'tillsonburg'],
  ottawa: ['ottawa', 'kanata', 'orleans', 'nepean', 'barrhaven', 'gatineau', 'gloucester', 'stittsville'],
  windsor: ['windsor', 'tecumseh', 'lasalle', 'la salle', 'amherstburg', 'lakeshore', 'essex', 'leamington', 'kingsville'],
}

type GeocodeResult = {
  lat: number
  lng: number
  displayName: string
}

export type AddressSuggestion = {
  label: string
  city?: string
  region?: string
  country?: string
  countryCode?: 'ca' | 'us'
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

function extractRouteCity(value?: string) {
  const parts = (value || '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)
  return parts.find(part => !/^\d/.test(part) && !/^(on|ontario|canada|united states|usa)$/.test(part))
}

function normalizeRouteBranch(value?: string): keyof typeof BRANCH_YARDS | undefined {
  return value && BRANCH_YARDS[value] ? value : undefined
}

function normalizeRouteLocationText(value?: string) {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function resolveRouteBranchForEstimate(input: {
  branch?: string
  origin?: string
  destination?: string
  originDisplayName?: string
  destDisplayName?: string
}): keyof typeof BRANCH_YARDS {
  return inferRouteBranchForEstimate(input) || 'windsor'
}

function inferRouteBranchForEstimate(input: {
  branch?: string
  origin?: string
  destination?: string
  originDisplayName?: string
  destDisplayName?: string
}): keyof typeof BRANCH_YARDS | undefined {
  const explicitBranch = normalizeRouteBranch(input.branch)
  if (explicitBranch) return explicitBranch

  const haystack = normalizeRouteLocationText([
    input.origin,
    input.destination,
    input.originDisplayName,
    input.destDisplayName,
  ].filter(Boolean).join(' '))

  for (const branch of ['waterloo', 'london', 'ottawa', 'windsor'] as Array<keyof typeof BRANCH_YARDS>) {
    if (ROUTE_BRANCH_ALIASES[branch].some(alias => haystack.includes(normalizeRouteLocationText(alias)))) {
      return branch
    }
  }

  return undefined
}

export function findNearestRouteBranch(origin: Pick<GeocodeResult, 'lat' | 'lng'>): keyof typeof BRANCH_YARDS {
  let nearest: keyof typeof BRANCH_YARDS = 'windsor'
  let nearestDistance = Number.POSITIVE_INFINITY

  for (const [branch, yard] of Object.entries(BRANCH_YARD_COORDS) as Array<
    [keyof typeof BRANCH_YARDS, GeocodeResult]
  >) {
    const latDistance = (origin.lat - yard.lat) * 111.32
    const meanLatitudeRadians = ((origin.lat + yard.lat) / 2) * (Math.PI / 180)
    const lngDistance = (origin.lng - yard.lng) * 111.32 * Math.cos(meanLatitudeRadians)
    const straightLineDistance = Math.hypot(latDistance, lngDistance)
    if (straightLineDistance < nearestDistance) {
      nearest = branch
      nearestDistance = straightLineDistance
    }
  }

  return nearest
}

export function normalizeDrivingRoute(distanceMeters: number, durationSeconds: number) {
  const rawDistanceKm = Math.max(0, distanceMeters / 1000)
  const rawDriveHours = Math.max(0, durationSeconds / 3600)
  return {
    distanceKm: rawDistanceKm > 0 ? Math.max(1, Math.round(rawDistanceKm)) : 0,
    driveHours: rawDriveHours > 0 ? Math.max(0.25, Math.round(rawDriveHours * 4) / 4) : 0,
  }
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
  // Canadian unit-prefix format: "601-203 Catherine St"
  if (/^[a-z]?\d+[a-z]?-\d+\s/.test(label.trim())) return 'apartment'
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
      const normalizedCountryCode: AddressSuggestion['countryCode'] =
        result.address?.country_code?.toLowerCase() === 'ca' ? 'ca'
        : result.address?.country_code?.toLowerCase() === 'us' ? 'us'
        : undefined
      return {
        label: result.display_name,
        city: extractAddressLocality(result.address),
        region: result.address?.state,
        country: result.address?.country,
        countryCode: normalizedCountryCode,
        placeType,
      }
    })
    .filter(r => {
      if (!r.label || seen.has(r.label)) return false
      seen.add(r.label)
      return true
    })
}

type GoogleAddressPrediction = {
  description: string
  place_id: string
  types?: string[]
  structured_formatting?: {
    main_text?: string
    secondary_text?: string
  }
}

function googlePredictionToSuggestion(
  prediction: GoogleAddressPrediction,
  countryCode: 'ca' | 'us'
): AddressSuggestion {
  const types = prediction.types || []
  const placeType: AddressSuggestion['placeType'] =
    types.includes('subpremise') ? 'apartment'
    : types.includes('establishment') || types.includes('point_of_interest') ? 'commercial'
    : detectApartmentFromText(prediction.description)
  const parts = prediction.description.split(',').map(part => part.trim())
  const regionIndex = parts.findIndex(part => countryCode === 'ca'
    ? /^(ON|Ontario|QC|Quebec|Québec|BC|British Columbia|AB|Alberta|MB|Manitoba|SK|Saskatchewan|NS|Nova Scotia|NB|New Brunswick|NL|Newfoundland and Labrador|PE|Prince Edward Island|YT|Yukon|NT|Northwest Territories|NU|Nunavut)$/i.test(part)
    : /^[A-Z]{2}$/i.test(part))
  return {
    label: prediction.description,
    city: regionIndex > 0 ? parts[regionIndex - 1] : undefined,
    region: regionIndex >= 0 ? parts[regionIndex] : undefined,
    country: countryCode === 'ca' ? 'Canada' : 'United States',
    countryCode,
    placeType,
    placeId: prediction.place_id,
  }
}

async function suggestWithGoogle(
  query: string,
  apiKey: string,
  countryCode: 'ca' | 'us'
): Promise<AddressSuggestion[]> {
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json` +
    `?input=${encodeURIComponent(query)}` +
    `&types=address` +
    `&components=country:${countryCode}` +
    `&key=${apiKey}`
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
  if (!res.ok) return []
  const data = (await res.json()) as {
    status: string
    predictions?: GoogleAddressPrediction[]
  }
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return []
  return (data.predictions || []).map(prediction => googlePredictionToSuggestion(prediction, countryCode))
}

export async function suggestAddresses(query: string): Promise<AddressSuggestion[]> {
  const trimmed = query.trim()
  if (trimmed.length < 5) return []

  // Try Google Places Autocomplete when API key is available
  const apiKey = getGoogleMapsApiKey()
  if (apiKey) {
    try {
      // Canadian results are deliberately fetched and ranked first. Asking Google
      // for CA and US in one request lets similarly named US streets outrank Ontario.
      const canadian = await suggestWithGoogle(trimmed, apiKey, 'ca')
      const american = canadian.length >= 5 ? [] : await suggestWithGoogle(trimmed, apiKey, 'us')
      return [...canadian, ...american].slice(0, 8)
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
          return normalizeDrivingRoute(data.routes[0].distance, data.routes[0].duration)
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
  return normalizeDrivingRoute(data.routes[0].distance, data.routes[0].duration)
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
  branch?: keyof typeof BRANCH_YARDS
}> {
  let routeBranch = inferRouteBranchForEstimate(input)

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

  if (!originGeo) {
    throw new Error(`Could not locate: "${input.origin}"`)
  }

  // Unknown cities must never silently inherit Windsor. Once the origin is
  // geocoded, choose the closest yard. Explicit staff selection still wins.
  routeBranch ||= findNearestRouteBranch(originGeo)
  const yardGeoHardcoded = BRANCH_YARD_COORDS[routeBranch] || BRANCH_YARD_COORDS.windsor

  // Yard: always use hardcoded branch coords for routing
  // U-Haul pickup distance is handled separately in the Live Margin — keeps pricing engine clean
  const yardGeo = yardGeoHardcoded

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
      branch: routeBranch,
    }
  }

  if (!destGeo) {
    throw new Error(`Could not locate: "${input.destination}"`)
  }

  const [originToDestination, returnToOrigin] = await Promise.all([
    getDrivingRoute(originGeo, destGeo),
    getDrivingRoute(destGeo, yardGeo),
  ])

	  if (!originToDestination || !returnToOrigin) {
	    throw new Error('Could not calculate driving route between these addresses')
	  }

  const originCity = extractRouteCity(input.origin)
  const destCity = extractRouteCity(input.destination)
  if (
    originCity &&
    destCity &&
    originCity === destCity &&
    originToDestination.distanceKm > 120
  ) {
    throw new Error(
      `Route estimate looks wrong for a local ${originCity} move. Please select the destination from autocomplete or include city/province.`
    )
  }

	  const routeCategory = classifyRouteCategory(originToDestination.distanceKm, originToDestination.driveHours)

  const billableDistanceKm =
    routeCategory === 'long-distance'
      ? originToDestination.distanceKm + returnToOrigin.distanceKm
      : yardToOrigin.distanceKm + originToDestination.distanceKm + returnToOrigin.distanceKm

  const operationalDistanceKm =
    yardToOrigin.distanceKm + originToDestination.distanceKm + returnToOrigin.distanceKm

  const billableDriveHours =
    routeCategory === 'long-distance'
      ? originToDestination.driveHours + returnToOrigin.driveHours
      : yardToOrigin.driveHours + originToDestination.driveHours + returnToOrigin.driveHours

  const operationalDriveHours =
    yardToOrigin.driveHours + originToDestination.driveHours + returnToOrigin.driveHours

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
    branch: routeBranch,
  }
}
