import { NextResponse } from 'next/server'
import { getSalesOverview } from '@/lib/server/sales-repository'

export async function GET() {
  try {
    const overview = await getSalesOverview()
    return NextResponse.json(overview)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load sales overview' },
      { status: 500 }
    )
  }
}
