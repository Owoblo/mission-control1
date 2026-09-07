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
    const latestByIdentity = new Map<string, {
      userId?: string | null
      userName?: string | null
      platform?: string | null
    }>()
    for (const row of recentPresence) {
      const identity = String(row.properties.identity || '')
      if (!identity || latestByIdentity.has(identity)) continue
      latestByIdentity.set(identity, {
        userId: typeof row.properties.userId === 'string' ? row.properties.userId : null,
        userName: typeof row.properties.userName === 'string' ? row.properties.userName : null,
        platform: typeof row.properties.platform === 'string' ? row.properties.platform : null,
      })
    }

    const { url, headers } = requireSupabaseEnv()
    const allowedRoles = ['owner', 'manager', 'sales_rep', 'partnership_manager']
    let users: Array<{ id: string; name: string; role?: string | null }> = []

    const response = await fetch(
      `${url}/rest/v1/app_users?select=id,name,role&role=in.(${allowedRoles.join(',')})&order=name.asc&limit=50`,
      { headers, cache: 'no-store' }
    )
    if (response.ok) {
      users = (await response.json()) as Array<{ id: string; name: string; role?: string | null }>
    }

    const availableIdentities = new Set(presence.availableIdentities)
    const presentIdentities = new Set(presence.identities)
    const teamTargets = users
      .filter(user => user.id !== session.userId)
      .map(user => {
      const identity = `saturn-rep-${user.id}`
      const presenceDetail = latestByIdentity.get(identity)
      return {
        id: `client:${identity}`,
        userId: user.id,
        label: user.name || presenceDetail?.userName || 'Team member',
        role: user.role || null,
        target: `client:${identity}`,
        status: availableIdentities.has(identity)
          ? 'available'
          : presentIdentities.has(identity)
            ? 'busy'
            : 'offline',
        kind: presenceDetail?.platform === 'mobile' ? 'mobile' : 'browser',
      }
    })

    const sipUsers = Array.from(new Set((settings?.sipUsers || []).filter(Boolean)))
    const sipTargets = sipUsers
      .filter(username => !teamTargets.some(entry => entry.label.toLowerCase() === username.toLowerCase()))
      .map(username => ({
        id: `sip:${username}`,
        label: username,
        target: `sip:${username}@${SIP_DOMAIN}`,
        status: 'fallback',
        kind: 'sip',
      }))

    return NextResponse.json({
      entries: [...teamTargets, ...sipTargets],
    })
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load internal directory' },
      { status: 500 }
    )
  }
}
