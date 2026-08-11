import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookieName, getSessionPayload } from '@/lib/auth'
import { isAuthorizedCronRequest, isCronApiPath } from '@/lib/server/cron-auth'
import { getWorkerSharedSecret } from '@/lib/server/runtime'

const PUBLIC_PATHS = new Set(['/login'])

// Webhooks / public API — no session cookie
const PUBLIC_API_PATHS = new Set([
  '/api/sales/twilio/sms',
  '/api/sales/inbox/email-inbound',
  '/api/sales/operations/sms',
  '/api/sales/operations/twiml',
  '/api/sales/emails/backfill',
  '/api/sales/stripe/checkout',
  '/api/sales/stripe/webhook',
  '/api/sales/stripe/webhook/dexa',
  '/api/partners/referral-capture',
])

// All Twilio dialer callbacks — Twilio hits these without auth, so the whole prefix is public
function isPublicDialerPath(pathname: string) {
  return pathname.startsWith('/api/sales/dialer/')
}

function isPublicMarketingDialerPath(pathname: string) {
  return (
    pathname === '/api/marketing/dialer/twiml' ||
    pathname === '/api/marketing/dialer/call-status' ||
    pathname === '/api/marketing/dialer/recording-callback'
  )
}

const INTERNAL_SECRET_API_PATHS = new Set([
  '/api/sales/automation/ingest',
  '/api/sales/automation/process',
  '/api/sales/automation/reactivate',
])

// QR code tracking is public (scanned by mail recipient, no login)
function isPublicMarketingPath(pathname: string) {
  return pathname.startsWith('/api/marketing/qr/')
}

// Manager approval links sent via email — no login required
function isApprovalPath(pathname: string) {
  return pathname.endsWith('/approve-margin')
}

function hasInternalSecretBypass(request: NextRequest, pathname: string) {
  if (!INTERNAL_SECRET_API_PATHS.has(pathname)) return false
  const secret = request.headers.get('x-internal-secret')
  const workerSecret = getWorkerSharedSecret()
  return !!secret && !!workerSecret && secret === workerSecret
}

function hasResendPollBypass(request: NextRequest, pathname: string) {
  if (pathname !== '/api/sales/inbox/resend-poll') return false
  const secret = request.headers.get('x-internal-secret')
  const workerSecret = getWorkerSharedSecret()
  return !!secret && !!workerSecret && secret === workerSecret
}

function hasCronBypass(request: NextRequest, pathname: string) {
  return isCronApiPath(pathname) && isAuthorizedCronRequest(request)
}

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (
    PUBLIC_PATHS.has(pathname) ||
    PUBLIC_API_PATHS.has(pathname) ||
    isPublicDialerPath(pathname) ||
    isPublicMarketingDialerPath(pathname) ||
    isPublicMarketingPath(pathname) ||
    isApprovalPath(pathname) ||
    hasCronBypass(request, pathname) ||
    hasInternalSecretBypass(request, pathname) ||
    hasResendPollBypass(request, pathname)
  ) {
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
    pathname.startsWith('/partner-portal') ||
    pathname.startsWith('/api/partner-portal') ||
    pathname.startsWith('/trigger') ||
    pathname.startsWith('/api/partners') ||
    pathname.startsWith('/api/auth/me')

  if (!needsAuth) return NextResponse.next()

  const authorization = request.headers.get('authorization')?.trim() || ''
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)
  const token = bearerMatch?.[1]?.trim() || request.cookies.get(getSessionCookieName())?.value
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

  if (pathname.startsWith('/partner-portal') || pathname.startsWith('/api/partner-portal')) {
    const canAccessPartner = role === 'partner_admin' || role === 'partner_dispatcher' || role === 'partner_crew'
    if (!canAccessPartner || !payload.partnerId) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.redirect(new URL('/login', request.url))
    }
  }

  // Owner-only: admin pages
  if ((pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) && role !== 'owner') {
    if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.redirect(new URL(role === 'partnership_manager' ? '/marketing/partners?tab=phone' : '/sales', request.url))
  }

  // Sales workspace is only for sales-capable roles.
  if (pathname.startsWith('/sales') || pathname.startsWith('/api/sales')) {
    const operationsPath = pathname.startsWith('/sales/operations') || pathname.startsWith('/api/sales/operations') || pathname.startsWith('/sales/contractors') || pathname.startsWith('/api/sales/subcontractors') || pathname.startsWith('/api/sales/subcontractor-offers') || pathname.startsWith('/sales/partner-operations') || pathname.startsWith('/api/sales/partner-operations') || pathname.startsWith('/sales/partner-simulations') || pathname.startsWith('/api/sales/partner-pilots')
    const canAccessSales = role === 'owner' || role === 'manager' || role === 'sales_rep' || (role === 'operations_lead' && operationsPath)
    if (!canAccessSales) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.redirect(new URL(role === 'partnership_manager' ? '/marketing/partners?tab=phone' : '/crew/calendar', request.url))
    }
  }

  // Crew-only route guard: /crew/* requires crew, manager, or owner
  if (pathname.startsWith('/crew') || pathname.startsWith('/api/crew')) {
    const canAccessCrew = role === 'owner' || role === 'manager' || role === 'operations_lead' || role === 'crew'
    if (!canAccessCrew) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.redirect(new URL(role === 'partnership_manager' ? '/marketing/partners?tab=phone' : '/sales', request.url))
    }
  }

  // Partnership workspace is for owners, managers, and partnership managers.
  if (pathname.startsWith('/marketing') || pathname.startsWith('/api/marketing')) {
    const canAccessMarketing = role === 'owner' || role === 'manager' || role === 'partnership_manager'
    if (!canAccessMarketing) {
      if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      return NextResponse.redirect(new URL(role === 'crew' ? '/crew/calendar' : '/sales', request.url))
    }
    if (role === 'partnership_manager' && pathname.startsWith('/marketing') && !pathname.startsWith('/marketing/partners')) {
      return NextResponse.redirect(new URL('/marketing/partners?tab=phone', request.url))
    }
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
    '/partner-portal/:path*',
    '/api/partner-portal/:path*',
    '/trigger',
    '/api/partners/:path*',
    '/login',
    '/api/auth/me',
  ],
}
