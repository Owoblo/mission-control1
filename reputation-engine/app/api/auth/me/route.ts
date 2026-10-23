import { NextResponse } from 'next/server'
import { createSessionToken, getExpiredSessionCookieOptions, getSessionCookieName, getSessionCookieOptions, shouldRefreshSession } from '@/lib/auth'
import { getSessionUser } from '@/lib/server/session'
import { currentSessionProfile } from '@/lib/server/session-profile'
export async function GET() {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const profile = await currentSessionProfile(session)
    if (!profile) {
      const response = NextResponse.json({ error: 'Sign in again to continue' }, { status: 401 })
      response.cookies.set(getSessionCookieName(), '', getExpiredSessionCookieOptions())
      return response
    }
    const user = profile.identity
    const response = NextResponse.json({ role: user.role, name: user.name || '', userId: user.userId || null, branch: user.branch || null }, { headers: { 'Cache-Control': 'private, no-store' } })
    const changed = ['role','name','branch','partnerId','partnerMemberId'].some(key => user[key as keyof typeof user] !== session[key as keyof typeof session])
    if (profile.renewable && (shouldRefreshSession(session) || changed)) {
      const { exp: _exp, ...identity } = user
      response.cookies.set(getSessionCookieName(), await createSessionToken(identity), getSessionCookieOptions())
    }
    return response
  } catch {
    return NextResponse.json({ error: 'Your profile could not be checked. Try again shortly.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store' } })
  }
}
