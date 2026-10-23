import { NextResponse } from 'next/server'
import { createSessionToken, getSessionCookieName, getSessionCookieOptions, shouldRefreshSession } from '@/lib/auth'
import { getSessionUser } from '@/lib/server/session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const response = NextResponse.json({
    role: user.role ?? 'owner',
    name: user.name ?? 'Owner',
    userId: user.userId ?? null,
    branch: user.branch ?? null,
  }, { headers: { 'Cache-Control': 'private, no-store' } })
  if (shouldRefreshSession(user)) {
    const { exp: _exp, ...identity } = user
    response.cookies.set(getSessionCookieName(), await createSessionToken(identity), getSessionCookieOptions())
  }
  return response
}
