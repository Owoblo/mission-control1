import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createSessionToken, getSessionCookieName, type UserRole } from '@/lib/auth'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'

interface AppUser {
  id: string
  email: string
  password_hash: string
  name: string
  role: UserRole
  branch?: string
  partner_id?: string
  partner_member_id?: string
}

async function findUserByEmail(email: string): Promise<AppUser | null> {
  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/app_users?email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`,
    { headers, cache: 'no-store' }
  )
  if (!res.ok) return null
  const rows = (await res.json()) as AppUser[]
  return rows[0] ?? null
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,  // 7 days — matches JWT TTL
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { email?: string; password?: string }

    if (!payload.password) {
      return NextResponse.json({ error: 'Password required' }, { status: 400 })
    }

    // --- Multi-user path: email + password ---
    if (payload.email) {
      const user = await findUserByEmail(payload.email)
      if (!user) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
      }

      const match = await bcrypt.compare(payload.password, user.password_hash)
      if (!match) {
        return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
      }

      const token = await createSessionToken({ userId: user.id, role: user.role, name: user.name, branch: user.branch || undefined, partnerId: user.partner_id || undefined, partnerMemberId: user.partner_member_id || undefined })
      const response = NextResponse.json({ ok: true, role: user.role, name: user.name, branch: user.branch || undefined })
      response.cookies.set(getSessionCookieName(), token, cookieOptions())
      return response
    }

    // --- Legacy owner path: password only (AUTH_PASSWORD env var) ---
    const expectedPassword = readEnv('AUTH_PASSWORD')
    if (!expectedPassword || payload.password !== expectedPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    // Keep the legacy owner identity stable. Omitting userId produced the Twilio
    // identity "saturn-rep-undefined", collapsing presence and call ownership.
    const token = await createSessionToken({ userId: 'legacy-owner', role: 'owner', name: 'John.O (Admin)' })
    const response = NextResponse.json({ ok: true, role: 'owner', name: 'John.O (Admin)' })
    response.cookies.set(getSessionCookieName(), token, cookieOptions())
    return response
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 400 }
    )
  }
}
