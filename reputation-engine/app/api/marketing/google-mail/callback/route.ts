import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { finishGoogleMail, googleMailConfig } from '@/lib/server/google-mail-oauth'
export const runtime = 'nodejs'
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (user?.role !== 'owner' || !user.userId) return NextResponse.json({ error: 'Owner session required; sign in and restart the connection.' }, { status: 403, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })
  let origin: string
  try { origin = new URL(googleMailConfig().redirectUri).origin } catch { return NextResponse.json({ error: 'Google mail configuration unavailable' }, { status: 503 }) }
  let result = 'failed'
  try {
    const code = request.nextUrl.searchParams.get('code'), state = request.nextUrl.searchParams.get('state'), binding = request.cookies.get('google_mail_binding')?.value
    if (!code || !state || !binding || request.nextUrl.searchParams.has('error')) throw new Error('Authorization incomplete')
    await finishGoogleMail(code, state, user.userId, binding)
    result = 'connected'
  } catch { /* Do not log authorization codes, provider responses or tokens. */ }
  const response = NextResponse.redirect(new URL(`/marketing/google-mail?result=${result}`, origin), 303)
  response.cookies.set('google_mail_binding', '', { httpOnly: true, secure: origin.startsWith('https:'), sameSite: 'lax', maxAge: 0, path: '/api/marketing/google-mail' })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
