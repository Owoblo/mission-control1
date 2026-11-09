import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { contactSearchQuery, searchContacts } from '@/lib/server/contact-search'

export async function GET(request: Request) {
  const session = await getSessionUser()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['owner', 'manager', 'partnership_manager'].includes(session.role || '')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const params = new URL(request.url).searchParams
  try { contactSearchQuery(params, session) }
  catch { return NextResponse.json({ error: 'Invalid search parameters or cursor' }, { status: 400 }) }
  try {
    return NextResponse.json(await searchContacts(params, session, request.signal), { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'Contact search is temporarily unavailable. Please retry.' }, { status: 503, headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '5' } })
  }
}
