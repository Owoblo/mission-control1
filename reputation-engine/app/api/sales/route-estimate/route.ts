import { NextResponse } from 'next/server'
import { estimateRouteContext, geocodeByPlaceId } from '@/lib/server/route-estimation'

// In-memory cache — same origin+dest+branch returns instantly for 30 minutes
const routeCache = new Map<string, { result: unknown; expiresAt: number }>()
const CACHE_TTL_MS = 10 * 60 * 1000  // 10 min — keeps it fresh without hammering the API

export async function POST(request: Request) {
  try {
    const { origin, destination, branch, originPlaceId, destPlaceId, yardLat, yardLng, yardName } = (await request.json()) as {
      origin?: string
      destination?: string
      branch?: string
      originPlaceId?: string
      destPlaceId?: string
      yardLat?: number
      yardLng?: number
      yardName?: string
    }

    if (!origin?.trim()) {
      return NextResponse.json({ error: 'origin is required' }, { status: 400 })
    }

    // Include yard coords in cache key — different U-Haul depots = different routes
    const yardKey = yardLat != null ? `${Math.round(yardLat * 1000)},${Math.round(yardLng! * 1000)}` : branch || ''
    const cacheKey = `${originPlaceId || origin.trim()}|${destPlaceId || destination?.trim() || ''}|${yardKey}`
    const cached = routeCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.result)
    }

    // If we have place_ids from Google Places autocomplete, resolve coordinates directly
    // — much more reliable than re-geocoding the address string
    const [originGeoOverride, destGeoOverride] = await Promise.all([
      originPlaceId ? geocodeByPlaceId(originPlaceId) : Promise.resolve(null),
      destPlaceId ? geocodeByPlaceId(destPlaceId) : Promise.resolve(null),
    ])

    const result = await estimateRouteContext({
      origin: originGeoOverride
        ? `${originGeoOverride.lat},${originGeoOverride.lng}`
        : origin.trim(),
      destination: destGeoOverride
        ? `${destGeoOverride.lat},${destGeoOverride.lng}`
        : destination?.trim(),
      branch,
      originDisplayName: originGeoOverride?.displayName,
      destDisplayName: destGeoOverride?.displayName,
      // Use nearest U-Haul as yard when provided — most accurate operational base
      yardOverride: yardLat != null && yardLng != null
        ? { lat: yardLat, lng: yardLng, displayName: yardName || 'Nearest U-Haul depot' }
        : undefined,
    })

    routeCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Route estimate failed'
    const status = /Could not locate|Could not calculate|timeout|AbortError/.test(message) ? 422 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
