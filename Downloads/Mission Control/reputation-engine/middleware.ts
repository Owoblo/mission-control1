import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth'

const PUBLIC_PATHS = new Set(['/login'])

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next()
  }

  const needsSalesAuth = pathname.startsWith('/sales') || pathname.startsWith('/api/sales')
  if (!needsSalesAuth) {
    return NextResponse.next()
  }

  const token = request.cookies.get(getSessionCookieName())?.value
  const isValid = await verifySessionToken(token)
  if (isValid) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/sales')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('next', `${pathname}${search}`)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/sales/:path*', '/api/sales/:path*', '/login'],
}
