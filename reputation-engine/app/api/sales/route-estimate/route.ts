import { NextResponse } from 'next/server'
import { estimateRouteContext } from '@/lib/server/route-estimation'

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
    const { origin, destination, branch } = (await request.json()) as {
      origin?: string
      destination?: string
      branch?: string
    }

    const { origin, destination, originCity } = body
    const manualDistanceKm = body.manualDistanceKm ? Number(body.manualDistanceKm) : undefined
    const manualDriveHours = body.manualDriveHours ? Number(body.manualDriveHours) : undefined

    if (!origin?.trim() && !manualDriveHours) {
      return NextResponse.json({ error: 'origin is required (or provide manualDriveHours)' }, { status: 400 })
    }

    const result = await estimateRouteContext({
      origin: origin.trim(),
      destination: destination?.trim(),
      branch,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Route estimate failed'
    const status = /Could not locate|Could not calculate/.test(message) ? 422 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
