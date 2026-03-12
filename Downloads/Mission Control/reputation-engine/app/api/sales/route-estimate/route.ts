import { NextResponse } from 'next/server'
import { getGoogleMapsApiKey } from '@/lib/server/runtime'

const DEFAULT_TRUCK_MPG = 10
const DEFAULT_GAS_PRICE_PER_GALLON = 4.75

type DirectionsResponse = {
  routes?: Array<{
    legs?: Array<{
      distance?: {
        value?: number
        text?: string
      }
      duration?: {
        value?: number
        text?: string
      }
    }>
  }>
  status?: string
  error_message?: string
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as {
      origin?: string
      destination?: string
      truckMpg?: number
      gasPricePerGallon?: number
      truckCount?: number
    }

    if (!payload.origin?.trim() || !payload.destination?.trim()) {
      return NextResponse.json({ error: 'Origin and destination are required' }, { status: 400 })
    }

    const apiKey = getGoogleMapsApiKey()
    if (!apiKey) {
      return NextResponse.json({ error: 'Google Maps API key is not configured for route estimates.' }, { status: 400 })
    }

    const origin = payload.origin.trim()
    const destination = payload.destination.trim()
    const truckMpg = Math.max(1, Number(payload.truckMpg || DEFAULT_TRUCK_MPG))
    const gasPricePerGallon = Math.max(0, Number(payload.gasPricePerGallon || DEFAULT_GAS_PRICE_PER_GALLON))
    const truckCount = Math.max(1, Number(payload.truckCount || 1))
    const directionsUrl =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}` +
      `&destination=${encodeURIComponent(destination)}&key=${encodeURIComponent(apiKey)}`

    const response = await fetch(directionsUrl, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`Failed to read Google Directions API (${response.status})`)
    }

    const data = (await response.json()) as DirectionsResponse
    if (data.status !== 'OK') {
      throw new Error(data.error_message || `Google Directions returned ${data.status || 'an unknown status'}`)
    }

    const leg = data.routes?.[0]?.legs?.[0]
    const meters = Number(leg?.distance?.value || 0)
    if (!meters) {
      throw new Error('No route distance was returned for this move.')
    }

    const distanceKm = Math.round((meters / 1000) * 10) / 10
    const distanceMiles = Math.round((distanceKm * 0.621371) * 10) / 10
    const fuelGallons = Math.round((distanceMiles / truckMpg) * truckCount * 10) / 10
    const fuelCost = Math.round(fuelGallons * gasPricePerGallon)
    const driveHours = Math.round(((Number(leg?.duration?.value || 0) / 3600) || 0) * 10) / 10

    return NextResponse.json({
      distanceKm,
      distanceMiles,
      driveHours,
      fuelGallons,
      fuelCost,
      truckMpg,
      gasPricePerGallon,
      routeText: `${leg?.distance?.text || `${distanceKm} km`} · ${leg?.duration?.text || `${driveHours} hrs`}`,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to estimate route' },
      { status: 400 }
    )
  }
}
