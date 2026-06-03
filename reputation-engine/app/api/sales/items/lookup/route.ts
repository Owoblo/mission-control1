import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { lookupItemDimensions } from '@/lib/server/item-dimensions'
import { matchInventoryPreset } from '@/lib/item-presets'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const session = await hasInternalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const item = searchParams.get('item')?.trim()
  if (!item) return NextResponse.json({ error: 'item required' }, { status: 400 })

  // Check our preset library first — free and instant
  const preset = matchInventoryPreset(item)
  if (preset) {
    return NextResponse.json({
      source: 'preset',
      item,
      cubicFeet: preset.cubicFeet,
      weightLbs: preset.lbs,
      notes: `From Saturn Star inventory presets`,
      confidence: 'high',
    })
  }

  // Fall back to AI lookup
  const dims = await lookupItemDimensions(item)
  if (!dims) {
    return NextResponse.json({ error: 'Could not estimate dimensions for this item' }, { status: 404 })
  }

  return NextResponse.json({
    source: 'ai',
    item,
    ...dims,
  })
}
