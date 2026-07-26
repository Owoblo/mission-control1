import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { approveItemDimensions, lookupItemDimensions } from '@/lib/server/item-dimensions'
import { matchInventoryPreset } from '@/lib/item-presets'
import { getSessionUser } from '@/lib/server/session'

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
      cubicFeet: preset.item.cubicFeet,
      weightLbs: preset.item.weightLbs,
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

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as {
    item?: string
    cubicFeet?: number
    weightLbs?: number
    notes?: string
  }
  const item = body.item?.trim()
  const cubicFeet = Number(body.cubicFeet)
  const weightLbs = Number(body.weightLbs)
  if (!item || !Number.isFinite(cubicFeet) || cubicFeet <= 0 || !Number.isFinite(weightLbs) || weightLbs <= 0) {
    return NextResponse.json({ error: 'Valid item, cubic feet, and weight are required.' }, { status: 400 })
  }

  try {
    const result = await approveItemDimensions({
      itemName: item,
      cubicFeet,
      weightLbs,
      notes: body.notes?.trim().slice(0, 300),
      reviewedBy: session.name || session.userId,
    })
    return NextResponse.json({ ok: true, source: 'operator_catalog', item, ...result })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save item dimensions.' }, { status: 500 })
  }
}
