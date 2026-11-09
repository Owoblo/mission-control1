import { NextRequest, NextResponse } from 'next/server'
import { getSessionCookieName, getSessionPayload } from '@/lib/auth'
export async function syntheticPreviewBoundary(request: NextRequest): Promise<NextResponse | null> {
  if (process.env.CRM_SYNTHETIC_PREVIEW !== '1') return null
  if (process.env.VERCEL_ENV === 'production' || !process.env.CRM_PREVIEW_PASSWORD) return new NextResponse('Synthetic preview configuration is unavailable.', { status: 503 })
  let credential = ''
  try { credential = atob((request.headers.get('authorization') || '').replace(/^Basic /, '')) } catch { /* deny */ }
  if (credential !== `preview:${process.env.CRM_PREVIEW_PASSWORD}`) return new NextResponse('Protected CRM preview', { status: 401, headers: { 'WWW-Authenticate': 'Basic realm="Synthetic CRM preview", charset="UTF-8"', 'Cache-Control': 'no-store' } })
  const path = request.nextUrl.pathname
  // The only state change allowed is issuing a synthetic role cookie; all
  // original provider callbacks, payment endpoints, cron and write routes stop here.
  if (!['GET', 'HEAD'].includes(request.method)) return NextResponse.json({ error: 'All writes and external side effects are disabled in this synthetic preview.' }, { status: 405 })
  if (path === '/preview' || path === '/api/preview/session') return NextResponse.next()
  const session = await getSessionPayload(request.cookies.get(getSessionCookieName())?.value)
  if (!session) return path.startsWith('/api/') ? NextResponse.json({ error: 'Synthetic session required' }, { status: 401 }) : NextResponse.redirect(new URL('/preview', request.url))
  if (path.startsWith('/api/')) {
    if (path === '/api/preview/fixture') return NextResponse.next()
    const target = request.nextUrl.clone()
    target.pathname = '/api/preview/fixture'; target.searchParams.set('__path', path)
    return NextResponse.rewrite(target)
  }
  return null // Existing market/role middleware still protects CRM pages.
}
