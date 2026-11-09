import { NextResponse } from 'next/server'
import { createSessionToken, getSessionCookieName } from '@/lib/auth'
export async function GET(request: Request) {
  if (process.env.CRM_SYNTHETIC_PREVIEW !== '1' || process.env.VERCEL_ENV === 'production') return new NextResponse('Not found', { status: 404 })
  const selection = new URL(request.url).searchParams.get('role') || 'owner'
  const profiles = {
    owner: { role: 'owner' as const, name: 'Synthetic Owner' },
    windsor: { role: 'manager' as const, name: 'Windsor Fixture Manager', branch: 'windsor' },
    toronto: { role: 'partnership_manager' as const, name: 'Toronto Fixture Manager', branch: 'toronto' },
    denied: { role: 'crew' as const, name: 'Denied Fixture User' },
  }
  const profile = profiles[selection as keyof typeof profiles]
  if (!profile) return new NextResponse('Invalid fixture role', { status: 400 })
  const response = new NextResponse(null, { status: 307, headers: { Location: '/marketing/partners?tab=phone' } })
  response.cookies.set(getSessionCookieName(), await createSessionToken({ ...profile, userId: `fixture-${selection}` }), { httpOnly: true, sameSite: 'lax', secure: new URL(request.url).protocol === 'https:', path: '/' })
  return response
}
