import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import {
  DEFAULT_SETTINGS,
  getDialerSettings,
  saveDialerSettings,
  type DialerSettings,
} from '@/lib/server/dialer-settings'
import { requireSupabaseEnv } from '@/lib/server/runtime'

const SETUP_SQL = `-- Run this once in your Supabase SQL editor
CREATE TABLE IF NOT EXISTS saturn_config (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);`

async function checkTableExists() {
  try {
    const { url, headers } = requireSupabaseEnv()
    const res = await fetch(
      `${url}/rest/v1/saturn_config?key=eq.dialer&select=key&limit=1`,
      { headers, cache: 'no-store' }
    )
    return res.ok
  } catch {
    return false
  }
}

export async function GET() {
  const session = await getSessionUser()
  if (!session || (session.role !== 'owner' && session.role !== 'manager')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const tableExists = await checkTableExists()
  if (!tableExists) {
    return NextResponse.json({ settings: DEFAULT_SETTINGS, tableExists: false, setupSql: SETUP_SQL })
  }

  const settings = await getDialerSettings()
  return NextResponse.json({ settings, tableExists: true })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!session || session.role !== 'owner') {
    return NextResponse.json({ error: 'Only the owner can change dialer settings.' }, { status: 403 })
  }

  const patch = (await request.json()) as Partial<DialerSettings>
  const current = await getDialerSettings()
  const merged: DialerSettings = { ...current, ...patch }
  await saveDialerSettings(merged)
  return NextResponse.json({ ok: true, settings: merged })
}
