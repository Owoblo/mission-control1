import { NextResponse } from 'next/server'
import { hasInternalSession } from '@/lib/server/session'
import { resolveVoiceCallerId } from '@/lib/server/voice-caller-id'

export async function GET(request: Request) {
  const authed = await hasInternalSession()
  if (!authed) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const resolution = await resolveVoiceCallerId({
      leadId: searchParams.get('leadId'),
      phone: searchParams.get('phone'),
      email: searchParams.get('email'),
      inboundId: searchParams.get('inboundId'),
      preferredFromNumber: searchParams.get('preferredFromNumber'),
    })

    return NextResponse.json({
      ok: true,
      ...resolution,
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve caller ID' },
      { status: 500 }
    )
  }
}
