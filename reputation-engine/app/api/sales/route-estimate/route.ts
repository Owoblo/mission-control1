import { NextResponse } from 'next/server'

const BASE_YARD_ADDRESS = 'Windsor, ON, Canada'

type GeocodeResult = {
  lat: number
  lng: number
  displayName: string
}

async function geocode(address: string): Promise<GeocodeResult | null> {
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

async function getDrivingRoute(
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
  const route = data.routes[0]
  return {
    distanceKm: Math.round(route.distance / 1000),
    driveHours: Math.round((route.duration / 3600) * 4) / 4,
  }
}

export async function POST(request: Request) {
  try {
    const { origin, destination } = (await request.json()) as {
      origin?: string
      destination?: string
    }

    if (!origin?.trim()) {
      return NextResponse.json({ error: 'origin is required' }, { status: 400 })
    }

    const [originGeo, yardGeo, destGeo] = await Promise.all([
      geocode(origin.trim()),
      geocode(BASE_YARD_ADDRESS),
      destination?.trim() ? geocode(destination.trim()) : Promise.resolve(null),
    ])

    if (!originGeo) {
      return NextResponse.json({ error: `Could not locate: "${origin}"` }, { status: 422 })
    }
    if (!yardGeo) {
      return NextResponse.json({ error: 'Could not locate Saturn Star yard/base' }, { status: 500 })
    }

    const yardToOrigin = await getDrivingRoute(yardGeo, originGeo)
    if (!yardToOrigin) {
      return NextResponse.json({ error: 'Could not calculate yard to origin drive time' }, { status: 422 })
    }

    if (!destination?.trim()) {
      return NextResponse.json({
        pricingStatus: 'provisional',
        category: 'local',
        originResolved: originGeo.displayName,
        yardResolved: yardGeo.displayName,
        yardToOrigin,
        originToDestination: null,
        returnToOrigin: null,
        billableDistanceKm: yardToOrigin.distanceKm,
        operationalDistanceKm: yardToOrigin.distanceKm,
        billableDriveHours: yardToOrigin.driveHours,
        operationalDriveHours: yardToOrigin.driveHours,
        missingRequirements: ['Destination address or city needed for travel estimate'],
      })
    }

    if (!destGeo) {
      return NextResponse.json({ error: `Could not locate: "${destination}"` }, { status: 422 })
    }

    const [originToDestination, returnToOrigin] = await Promise.all([
      getDrivingRoute(originGeo, destGeo),
      getDrivingRoute(destGeo, originGeo),
    ])

    if (!originToDestination || !returnToOrigin) {
      return NextResponse.json({ error: 'Could not calculate driving route between these addresses' }, { status: 422 })
    }

    const category: 'local' | 'medium' | 'long-distance' =
      originToDestination.distanceKm < 80 ? 'local' : originToDestination.distanceKm < 300 ? 'medium' : 'long-distance'

    const billableDistanceKm =
      category === 'long-distance'
        ? originToDestination.distanceKm + returnToOrigin.distanceKm
        : yardToOrigin.distanceKm + originToDestination.distanceKm

    const operationalDistanceKm =
      category === 'long-distance'
        ? yardToOrigin.distanceKm + originToDestination.distanceKm + returnToOrigin.distanceKm
        : yardToOrigin.distanceKm + originToDestination.distanceKm

    const billableDriveHours =
      category === 'long-distance'
        ? originToDestination.driveHours + returnToOrigin.driveHours
        : yardToOrigin.driveHours + originToDestination.driveHours

    const operationalDriveHours =
      category === 'long-distance'
        ? yardToOrigin.driveHours + originToDestination.driveHours + returnToOrigin.driveHours
        : yardToOrigin.driveHours + originToDestination.driveHours

    return NextResponse.json({
      pricingStatus: 'ready',
      category,
      distanceKm: originToDestination.distanceKm,
      distanceMiles: Math.round(originToDestination.distanceKm * 0.621),
      driveHours: originToDestination.driveHours,
      originResolved: originGeo.displayName,
      destResolved: destGeo.displayName,
      yardResolved: yardGeo.displayName,
      yardToOrigin,
      originToDestination,
      returnToOrigin,
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
