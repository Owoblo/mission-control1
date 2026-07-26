import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import {
  getDialerSettings,
  normalizeBlockedCallerPhone,
  saveDialerSettings,
  type BlockedCaller,
} from '@/lib/server/dialer-settings'

const ALLOWED_ROLES = new Set(['owner', 'manager', 'sales_rep'])

async function authorizedSession() {
  const session = await getSessionUser()
  return session?.role && ALLOWED_ROLES.has(session.role) ? session : null
}

export async function GET() {
  const session = await authorizedSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const settings = await getDialerSettings()
  return NextResponse.json({ blockedCallers: settings.blockedCallers || [] })
}

export async function POST(request: Request) {
  const session = await authorizedSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json() as { phone?: string; tag?: string; displayName?: string; note?: string }
  const phone = normalizeBlockedCallerPhone(body.phone)
  if (!phone) return NextResponse.json({ error: 'Enter a valid phone number.' }, { status: 400 })

  const settings = await getDialerSettings()
  const existing = (settings.blockedCallers || []).filter(entry => normalizeBlockedCallerPhone(entry.phone) !== phone)
  const entry: BlockedCaller = {
    phone,
    tag: (body.tag || 'Spam').trim().slice(0, 60) || 'Spam',
    displayName: (body.displayName || '').trim().slice(0, 100) || undefined,
    note: (body.note || '').trim().slice(0, 240) || undefined,
    blockedAt: new Date().toISOString(),
    blockedBy: session.name || session.userId || 'CRM user',
  }
  const next = { ...settings, blockedCallers: [entry, ...existing] }
  await saveDialerSettings(next)
  return NextResponse.json({ ok: true, blockedCaller: entry, blockedCallers: next.blockedCallers })
}

export async function DELETE(request: Request) {
  const session = await authorizedSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const phone = normalizeBlockedCallerPhone(new URL(request.url).searchParams.get('phone'))
  if (!phone) return NextResponse.json({ error: 'A valid phone number is required.' }, { status: 400 })
  const settings = await getDialerSettings()
  const blockedCallers = (settings.blockedCallers || []).filter(entry => normalizeBlockedCallerPhone(entry.phone) !== phone)
  await saveDialerSettings({ ...settings, blockedCallers })
  return NextResponse.json({ ok: true, blockedCallers })
}
