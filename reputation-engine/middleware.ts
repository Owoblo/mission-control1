import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookieName, getSessionPayload } from '@/lib/auth'

const PUBLIC_PATHS = new Set(['/login'])

// Webhooks / public API — no session cookie
const PUBLIC_API_PATHS = new Set([
  '/api/sales/dialer/twiml',
  '/api/sales/dialer/recording-callback',
  '/api/sales/dialer/dial-status',
  '/api/sales/dialer/call-status',
  '/api/sales/twilio/sms',
  '/api/sales/inbox/email-inbound',
  '/api/sales/stripe/checkout',
  '/api/sales/stripe/webhook',
])

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname) || PUBLIC_API_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const needsAuth =
    pathname.startsWith('/sales') ||
    pathname.startsWith('/api/sales') ||
    pathname.startsWith('/crew') ||
    pathname.startsWith('/api/crew') ||
    pathname.startsWith('/admin') ||
    pathname.startsWith('/api/admin') ||
    pathname.startsWith('/marketing') ||
    pathname.startsWith('/api/marketing') ||
    pathname.startsWith('/partners') ||
    pathname.startsWith('/trigger') ||
    pathname.startsWith('/api/partners') ||
    pathname.startsWith('/api/auth/me')

  if (!needsAuth) return NextResponse.next()

  const token = request.cookies.get(getSessionCookieName())?.value
  const payload = await getSessionPayload(token)

  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', `${pathname}${search}`)
    return NextResponse.redirect(loginUrl)
  }

  // Role defaults to 'owner' for legacy tokens without role
  const role = payload.role ?? 'owner'

  // Owner-only: admin pages
  if ((pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) && role !== 'owner') {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.redirect(new URL('/sales', request.url))
  }

  // Crew members: redirect /sales/* to their calendar
  if (pathname.startsWith('/sales') && role === 'crew') {
    return NextResponse.redirect(new URL('/crew/calendar', request.url))
  }

  // Crew-only route guard: /crew/* requires crew, manager, or owner
  if (pathname.startsWith('/crew') && role === 'sales_rep') {
    return NextResponse.redirect(new URL('/sales', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/sales/:path*',
    '/api/sales/:path*',
    '/crew/:path*',
    '/api/crew/:path*',
    '/admin/:path*',
    '/api/admin/:path*',
    '/marketing/:path*',
    '/api/marketing/:path*',
    '/partners/:path*',
    '/trigger',
    '/api/partners/:path*',
    '/login',
    '/api/auth/me',
  ],
}
