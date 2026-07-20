import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { listRecentDialerEvents, listRecentDialerPresence } from '@/lib/server/telephony-monitoring'

export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const presence = await listRecentDialerPresence({ userId: session.userId, sinceMinutes: 5, limit: 25 }).catch(() => [])
  const identities = new Set(presence.map(row => String(row.properties.identity || '')).filter(Boolean))
  if (identities.size === 0) return NextResponse.json({ context: null })

  const events = await listRecentDialerEvents({ sinceMinutes: 10, limit: 100 }).catch(() => [])
  const match = events.find(row => {
    if (row.properties.event !== 'transfer_context_created') return false
    const extra = row.properties.extra
    if (!extra || typeof extra !== 'object') return false
    return identities.has(String((extra as Record<string, unknown>).targetIdentity || ''))
  })

  if (!match) return NextResponse.json({ context: null })
  return NextResponse.json({
    context: {
      id: match.id,
      callSid: match.properties.callSid || null,
      leadId: match.leadId || null,
      phone: match.properties.phoneNumber || null,
      createdAt: match.ts,
      ...((match.properties.extra || {}) as Record<string, unknown>),
    },
  })
}
