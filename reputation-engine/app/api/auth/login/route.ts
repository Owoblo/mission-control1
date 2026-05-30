import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { createSessionToken, getSessionCookieName, type UserRole } from '@/lib/auth'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'
import { clientIp, consumeRateLimit } from '@/lib/server/rate-limit'

interface AppUser {
  id: string
  email: string
  password_hash: string
  name: string
  role: UserRole
  branch?: string
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
    maxAge: 60 * 60 * 12,
  }
}

export async function POST(request: Request) {
  try {
    const rateLimit = consumeRateLimit(`auth:login:${clientIp(request)}`, {
      limit: 20,
      windowMs: 15 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds || 900) } }
      )
    }

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

      const token = await createSessionToken({ userId: user.id, role: user.role, name: user.name, branch: user.branch || undefined })
      const response = NextResponse.json({ ok: true, role: user.role, name: user.name, branch: user.branch || undefined })
      response.cookies.set(getSessionCookieName(), token, cookieOptions())
      return response
    }

    // --- Legacy owner path: password only (AUTH_PASSWORD env var) ---
    // Disabled by default; set ALLOW_LEGACY_OWNER_LOGIN=true only for a temporary break-glass window.
    if (readEnv('ALLOW_LEGACY_OWNER_LOGIN') !== 'true') {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const expectedPassword = readEnv('AUTH_PASSWORD')
    if (!expectedPassword || payload.password !== expectedPassword) {
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
    }

    const token = await createSessionToken({ role: 'owner', name: 'John.O (Admin)' })
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
