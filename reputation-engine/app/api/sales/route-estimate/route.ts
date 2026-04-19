import { NextResponse } from 'next/server'

// Branch yards — origin address determines which yard we depart from
const BRANCH_YARDS: Record<string, string> = {
  windsor: 'Windsor, ON, Canada',
  london: 'London, ON, Canada',
  waterloo: 'Waterloo, ON, Canada',
  kitchener: 'Kitchener, ON, Canada',
  cambridge: 'Cambridge, ON, Canada',
}

const DEFAULT_YARD = 'Windsor, ON, Canada'

// Long distance threshold: 3-hour drive one-way
const LONG_DISTANCE_HOURS = 3
// Medium distance: 1.5h drive one-way
const MEDIUM_DISTANCE_HOURS = 1.5

function getYardForOrigin(originCity: string): string {
  const lower = (originCity || '').toLowerCase()
  for (const [city, yard] of Object.entries(BRANCH_YARDS)) {
    if (lower.includes(city)) return yard
  }
  return DEFAULT_YARD
}

type RouteSegment = {
  distanceKm: number
  driveHours: number
}

// --- Google Maps Distance Matrix ---
async function getDrivingRouteGoogleMaps(
  origin: string,
  destination: string
): Promise<RouteSegment | null> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY
  if (!apiKey) return null

  const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&mode=driving&units=metric&key=${encodeURIComponent(apiKey)}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) return null

  const data = (await response.json()) as {
    status: string
    rows?: Array<{
      elements?: Array<{
        status: string
        distance?: { value: number }
        duration?: { value: number }
      }>
    }>
  }

  const element = data.rows?.[0]?.elements?.[0]
  if (!element || element.status !== 'OK') return null

  return {
    distanceKm: Math.round((element.distance?.value || 0) / 1000),
    driveHours: Math.round(((element.duration?.value || 0) / 3600) * 4) / 4,
  }
}

// --- OSRM fallback (geocode via Nominatim + route via OSRM) ---
async function geocodeNominatim(address: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1&countrycodes=ca,us`
  const response = await fetch(url, {
    headers: { 'User-Agent': 'SaturnStarMissionControl/1.0 (business@starmovers.ca)' },
    cache: 'no-store',
  })
  if (!response.ok) return null
  const results = (await response.json()) as Array<{ lat: string; lon: string }>
  if (!results.length) return null
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) }
}

async function getDrivingRouteOSRM(
  origin: { lat: number; lng: number },
  dest: { lat: number; lng: number }
): Promise<RouteSegment | null> {
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
  const route = data.routes[0]
  return {
    distanceKm: Math.round(route.distance / 1000),
    driveHours: Math.round((route.duration / 3600) * 4) / 4,
  }
}

async function getRoute(origin: string, destination: string): Promise<RouteSegment | null> {
  // Try Google Maps first (more accurate), fall back to OSRM
  const googleResult = await getDrivingRouteGoogleMaps(origin, destination).catch(() => null)
  if (googleResult) return googleResult

  const [originGeo, destGeo] = await Promise.all([
    geocodeNominatim(origin),
    geocodeNominatim(destination),
  ])
  if (!originGeo || !destGeo) return null
  return getDrivingRouteOSRM(originGeo, destGeo).catch(() => null)
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      origin?: string
      destination?: string
      originCity?: string
      // Manual override — rep can bypass route calculation
      manualDistanceKm?: number
      manualDriveHours?: number
    }

    const { origin, destination, originCity } = body
    const manualDistanceKm = body.manualDistanceKm ? Number(body.manualDistanceKm) : undefined
    const manualDriveHours = body.manualDriveHours ? Number(body.manualDriveHours) : undefined

    if (!origin?.trim() && !manualDriveHours) {
      return NextResponse.json({ error: 'origin is required (or provide manualDriveHours)' }, { status: 400 })
    }

    // Branch-aware yard
    const yardAddress = getYardForOrigin(originCity || origin || '')

    // If rep provided a manual override, skip route calculation
    if (manualDriveHours !== undefined) {
      const hours = manualDriveHours
      const distKm = manualDistanceKm || Math.round(hours * 95) // rough est: ~95 km/h highway avg
      const category: 'local' | 'medium' | 'long-distance' =
        hours >= LONG_DISTANCE_HOURS ? 'long-distance' : hours >= MEDIUM_DISTANCE_HOURS ? 'medium' : 'local'
      return NextResponse.json({
        pricingStatus: 'ready',
        category,
        distanceKm: distKm,
        distanceMiles: Math.round(distKm * 0.621),
        driveHours: hours,
        isManualOverride: true,
        yardResolved: yardAddress,
        yardToOrigin: null,
        originToDestination: { distanceKm: distKm, driveHours: hours },
        returnToOrigin: { distanceKm: distKm, driveHours: hours },
        billableDistanceKm: category === 'long-distance' ? distKm * 2 : distKm,
        operationalDistanceKm: category === 'long-distance' ? distKm * 2 : distKm,
        billableDriveHours: category === 'long-distance' ? hours * 2 : hours,
        operationalDriveHours: category === 'long-distance' ? hours * 2 : hours,
        missingRequirements: [] as string[],
      })
    }

    const originFull = origin!.trim()
    const destFull = destination?.trim()

    // Parallel: yard→origin + origin→dest (if we have a dest)
    const [yardToOriginResult, originToDestResult] = await Promise.all([
      getRoute(yardAddress, originFull),
      destFull ? getRoute(originFull, destFull) : Promise.resolve(null),
    ])

    if (!yardToOriginResult) {
      return NextResponse.json({ error: `Could not calculate route from yard to "${originFull}"` }, { status: 422 })
    }

    if (!destFull) {
      return NextResponse.json({
        pricingStatus: 'provisional',
        category: 'local',
        yardResolved: yardAddress,
        yardToOrigin: yardToOriginResult,
        originToDestination: null,
        returnToOrigin: null,
        billableDistanceKm: yardToOriginResult.distanceKm,
        operationalDistanceKm: yardToOriginResult.distanceKm,
        billableDriveHours: yardToOriginResult.driveHours,
        operationalDriveHours: yardToOriginResult.driveHours,
        missingRequirements: ['Destination address or city needed for travel estimate'],
      })
    }

    if (!originToDestResult) {
      return NextResponse.json({ error: `Could not calculate route from "${originFull}" to "${destFull}"` }, { status: 422 })
    }

    // Get return trip (dest→origin) in parallel with nothing else
    const returnToOriginResult = await getRoute(destFull, originFull)
    if (!returnToOriginResult) {
      return NextResponse.json({ error: 'Could not calculate return route' }, { status: 422 })
    }

    // Category based on drive HOURS (not km) — 3+ hours = long distance
    const category: 'local' | 'medium' | 'long-distance' =
      originToDestResult.driveHours >= LONG_DISTANCE_HOURS
        ? 'long-distance'
        : originToDestResult.driveHours >= MEDIUM_DISTANCE_HOURS
          ? 'medium'
          : 'local'

    const billableDistanceKm =
      category === 'long-distance'
        ? originToDestResult.distanceKm + returnToOriginResult.distanceKm
        : yardToOriginResult.distanceKm + originToDestResult.distanceKm

    const operationalDistanceKm =
      category === 'long-distance'
        ? yardToOriginResult.distanceKm + originToDestResult.distanceKm + returnToOriginResult.distanceKm
        : yardToOriginResult.distanceKm + originToDestResult.distanceKm

    const billableDriveHours =
      category === 'long-distance'
        ? originToDestResult.driveHours + returnToOriginResult.driveHours
        : yardToOriginResult.driveHours + originToDestResult.driveHours

    const operationalDriveHours =
      category === 'long-distance'
        ? yardToOriginResult.driveHours + originToDestResult.driveHours + returnToOriginResult.driveHours
        : yardToOriginResult.driveHours + originToDestResult.driveHours

    return NextResponse.json({
      pricingStatus: 'ready',
      category,
      distanceKm: originToDestResult.distanceKm,
      distanceMiles: Math.round(originToDestResult.distanceKm * 0.621),
      driveHours: originToDestResult.driveHours,
      yardResolved: yardAddress,
      yardToOrigin: yardToOriginResult,
      originToDestination: originToDestResult,
      returnToOrigin: returnToOriginResult,
      billableDistanceKm,
      operationalDistanceKm,
      billableDriveHours,
      operationalDriveHours,
      missingRequirements: [] as string[],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Route estimate failed' },
      { status: 500 }
    )
  }
}
