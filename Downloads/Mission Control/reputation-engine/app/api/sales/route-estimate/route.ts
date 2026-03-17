import { NextResponse } from 'next/server'

async function geocode(address: string): Promise<{ lat: number; lng: number; displayName: string } | null> {
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

    if (!origin?.trim() || !destination?.trim()) {
      return NextResponse.json({ error: 'origin and destination are required' }, { status: 400 })
    }

    const [originGeo, destGeo] = await Promise.all([
      geocode(origin.trim()),
      geocode(destination.trim()),
    ])

    if (!originGeo) {
      return NextResponse.json({ error: `Could not locate: "${origin}"` }, { status: 422 })
    }
    if (!destGeo) {
      return NextResponse.json({ error: `Could not locate: "${destination}"` }, { status: 422 })
    }

    const route = await getDrivingRoute(originGeo, destGeo)
    if (!route) {
      return NextResponse.json({ error: 'Could not calculate driving route between these addresses' }, { status: 422 })
    }

    const category: 'local' | 'medium' | 'long-distance' =
      route.distanceKm < 80 ? 'local' : route.distanceKm < 300 ? 'medium' : 'long-distance'

    return NextResponse.json({
      distanceKm: route.distanceKm,
      distanceMiles: Math.round(route.distanceKm * 0.621),
      driveHours: route.driveHours,
      category,
      originResolved: originGeo.displayName,
      destResolved: destGeo.displayName,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Route estimate failed' },
      { status: 500 }
    )
  }
}
