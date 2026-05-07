import { NextResponse } from 'next/server'
import { estimateRouteContext } from '@/lib/server/route-estimation'

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
