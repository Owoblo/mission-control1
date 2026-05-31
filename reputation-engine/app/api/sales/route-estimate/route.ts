import { NextResponse } from 'next/server'
import { estimateRouteContext } from '@/lib/server/route-estimation'

// In-memory cache — same origin+dest+branch returns instantly for 30 minutes
const routeCache = new Map<string, { result: unknown; expiresAt: number }>()
const CACHE_TTL_MS = 30 * 60 * 1000

export async function POST(request: Request) {
  try {
    const { origin, destination, branch } = (await request.json()) as {
      origin?: string
      destination?: string
      branch?: string
    }

    if (!origin?.trim()) {
      return NextResponse.json({ error: 'origin is required' }, { status: 400 })
    }

    const cacheKey = `${origin.trim()}|${destination?.trim() || ''}|${branch || ''}`
    const cached = routeCache.get(cacheKey)
    if (cached && Date.now() < cached.expiresAt) {
      return NextResponse.json(cached.result)
    }

    const result = await estimateRouteContext({
      origin: origin.trim(),
      destination: destination?.trim(),
      branch,
    })

    routeCache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL_MS })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Route estimate failed'
    const status = /Could not locate|Could not calculate|timeout|AbortError/.test(message) ? 422 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
