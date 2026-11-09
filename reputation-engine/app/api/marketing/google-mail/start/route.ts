import { randomBytes } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { googleMailConfig, startGoogleMail } from '@/lib/server/google-mail-oauth'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  const user = await getSessionUser()
  if (user?.role !== 'owner' || !user.userId) return NextResponse.json({ error: 'Owner access required' }, { status: 403 })
  try {
    const config = googleMailConfig()
    if (request.headers.get('origin') !== new URL(config.redirectUri).origin) return NextResponse.json({ error: 'Invalid origin' }, { status: 403 })
    const form = await request.formData()
    const binding = randomBytes(32).toString('base64url')
    const url = await startGoogleMail(String(form.get('email') || '').trim().toLowerCase(), user.userId, binding)
    const response = NextResponse.redirect(url, 303)
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.cookies.set('google_mail_binding', binding, { httpOnly: true, secure: config.redirectUri.startsWith('https:'), sameSite: 'lax', maxAge: 600, path: '/api/marketing/google-mail' })
    return response
  } catch { return NextResponse.json({ error: 'Google mailbox connection could not start. Check server configuration and storage.' }, { status: 503 }) }
}
