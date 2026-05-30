import { NextResponse } from 'next/server'
import { geocodeAddress, getDrivingRoute } from '@/lib/server/route-estimation'
import { getGoogleMapsApiKey } from '@/lib/server/runtime'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const address = searchParams.get('address')?.trim()
    if (!address) return NextResponse.json({ error: 'address required' }, { status: 400 })

    // Geocode the job origin
    const origin = await geocodeAddress(address)
    if (!origin) return NextResponse.json({ error: 'Could not geocode address' }, { status: 400 })

    // Find nearby U-Haul locations via Google Places Text Search
    const apiKey = getGoogleMapsApiKey()
    if (!apiKey) return NextResponse.json({ error: 'Google Maps API key not configured' }, { status: 500 })

    const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json` +
      `?query=U-Haul+truck+rental` +
      `&location=${origin.lat},${origin.lng}` +
      `&radius=30000` +
      `&key=${apiKey}`

    const placesRes = await fetch(placesUrl, { cache: 'no-store' })
    if (!placesRes.ok) return NextResponse.json({ error: 'Places API failed' }, { status: 500 })

    const placesData = (await placesRes.json()) as {
      status: string
      results?: Array<{
        name: string
        formatted_address: string
        geometry: { location: { lat: number; lng: number } }
      }>
    }

    if (placesData.status !== 'OK' || !placesData.results?.length) {
      return NextResponse.json({ error: 'No U-Haul locations found nearby' }, { status: 404 })
    }

    // Get driving distance to the closest 3 results, pick the nearest by drive time
    const candidates = placesData.results.slice(0, 3)
    const routes = await Promise.all(
      candidates.map(async place => {
        const route = await getDrivingRoute(
          { lat: place.geometry.location.lat, lng: place.geometry.location.lng },
          { lat: origin.lat, lng: origin.lng }
        )
        return { place, route }
      })
    )

    const best = routes
      .filter(r => r.route !== null)
      .sort((a, b) => (a.route?.distanceKm ?? 999) - (b.route?.distanceKm ?? 999))[0]

    if (!best?.route) {
      // Fallback: just return the first result with no distance
      const fallback = candidates[0]
      return NextResponse.json({
        name: fallback.name,
        address: fallback.formatted_address,
        distanceKm: null,
      })
    }

    return NextResponse.json({
      name: best.place.name,
      address: best.place.formatted_address,
      distanceKm: best.route.distanceKm,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to find nearest U-Haul' },
      { status: 500 }
    )
  }
}
