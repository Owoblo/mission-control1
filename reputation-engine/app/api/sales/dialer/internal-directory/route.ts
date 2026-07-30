import { NextResponse } from 'next/server'
import { getDialerSettings } from '@/lib/server/dialer-settings'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getRequestSessionUser } from '@/lib/server/request-session'
import { getHealthyBrowserPresence, listRecentDialerPresence } from '@/lib/server/telephony-monitoring'

const SIP_DOMAIN = 'saturn.sip.twilio.com'

export async function GET(request: Request) {
  try {
    const session = await getRequestSessionUser(request)
    if (!session || !['owner', 'manager', 'sales_rep', 'partnership_manager'].includes(session.role || '')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const [presence, settings] = await Promise.all([
      getHealthyBrowserPresence({ maxAgeSeconds: 90 }).catch(() => ({
        active: false,
        sessionCount: 0,
        sessions: [] as string[],
        userIds: [] as string[],
        identities: [] as string[],
        availableIdentities: [] as string[],
      })),
      getDialerSettings().catch(() => null),
    ])
    const recentPresence = await listRecentDialerPresence({ sinceMinutes: 5, limit: 200 }).catch(() => [])
    const latestByIdentity = new Map<string, { userId?: string | null }>()
    for (const row of recentPresence) {
      const identity = String(row.properties.identity || '')
      if (!identity || latestByIdentity.has(identity)) continue
      latestByIdentity.set(identity, {
        userId: typeof row.properties.userId === 'string' ? row.properties.userId : null,
      })
    }

    const { url, headers } = requireSupabaseEnv()
    const uniqueUserIds = Array.from(new Set([
      ...presence.userIds.filter(Boolean),
      ...Array.from(latestByIdentity.values()).map(entry => entry.userId || '').filter(Boolean),
    ]))
    let users: Array<{ id: string; name: string; role?: string | null }> = []

    if (uniqueUserIds.length > 0) {
      const response = await fetch(
        `${url}/rest/v1/app_users?select=id,name,role&id=in.(${uniqueUserIds.map(id => `"${id}"`).join(',')})`,
        { headers, cache: 'no-store' }
      )
      if (response.ok) {
        users = (await response.json()) as Array<{ id: string; name: string; role?: string | null }>
      }
    }

    const userById = new Map(users.map(user => [user.id, user]))
    const browserTargets = presence.availableIdentities.map(identity => {
      const matchingUserId = latestByIdentity.get(identity)?.userId || null
      const user = matchingUserId ? userById.get(matchingUserId) : null
      return {
        id: `client:${identity}`,
        label: user?.name || identity,
        target: `client:${identity}`,
        status: 'available',
        kind: 'browser',
      }
    })

    const sipUsers = Array.from(new Set((settings?.sipUsers || []).filter(Boolean)))
    const sipTargets = sipUsers
      .filter(username => !browserTargets.some(entry => entry.label.toLowerCase() === username.toLowerCase()))
      .map(username => ({
        id: `sip:${username}`,
        label: username,
        target: `sip:${username}@${SIP_DOMAIN}`,
        status: 'fallback',
        kind: 'sip',
      }))

    return NextResponse.json({
      entries: [...browserTargets, ...sipTargets],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load internal directory' },
      { status: 500 }
    )
  }
}
