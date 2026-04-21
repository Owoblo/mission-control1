import { NextResponse } from 'next/server'
import { suggestAddresses } from '@/lib/server/route-estimation'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const query = searchParams.get('q')?.trim() || ''

    if (query.length < 5) {
      return NextResponse.json({ suggestions: [] })
    }

    const suggestions = await suggestAddresses(query)
    return NextResponse.json({ suggestions })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Address suggestion failed' },
      { status: 500 }
    )
  }
}
