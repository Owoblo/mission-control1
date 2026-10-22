import { NextResponse } from 'next/server'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { listRecentDialerEvents, listRecentDialerPresence } from '@/lib/server/telephony-monitoring'

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const requestedCallSid = new URL(request.url).searchParams.get('callSid')?.trim() || ''

  const presence = await listRecentDialerPresence({ userId: session.userId, sinceMinutes: 5, limit: 25 }).catch(() => [])
  const identities = new Set(presence.map(row => String(row.properties.identity || '')).filter(Boolean))
  if (identities.size === 0) return NextResponse.json({ context: null })

  const events = await listRecentDialerEvents({ sinceMinutes: 10, limit: 100 }).catch(() => [])
  const matchesIdentity = (row: typeof events[number]) => {
    if (row.properties.event !== 'transfer_context_created') return false
    const extra = row.properties.extra
    if (!extra || typeof extra !== 'object') return false
    return identities.has(String((extra as Record<string, unknown>).targetIdentity || ''))
  }

  const exactMatch = requestedCallSid
    ? events.find(row => matchesIdentity(row) && String(((row.properties.extra || {}) as Record<string, unknown>).targetCallSid || '') === requestedCallSid)
    : undefined
  const match = exactMatch || events.find(row => {
    if (!matchesIdentity(row)) return false
    const extra = (row.properties.extra || {}) as Record<string, unknown>
    const hasTargetCallSid = Boolean(extra.targetCallSid)
    return !requestedCallSid || (!hasTargetCallSid && Date.now() - Date.parse(row.ts) < 60_000)
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
