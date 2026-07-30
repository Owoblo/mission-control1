import bcrypt from 'bcryptjs'
import { createSessionToken, type UserRole } from '@/lib/auth'
import { readEnv, requireSupabaseEnv } from '@/lib/server/runtime'

interface AppUser {
  id: string
  email: string
  password_hash: string
  name: string
  role: UserRole
  branch?: string | null
}

const MOBILE_ROLES: UserRole[] = ['owner', 'manager', 'sales_rep', 'partnership_manager']

async function findUserByEmail(email: string): Promise<AppUser | null> {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(
    `${url}/rest/v1/app_users?email=eq.${encodeURIComponent(email.toLowerCase())}&limit=1`,
    { headers, cache: 'no-store' },
  )
  if (!response.ok) throw new Error('Staff directory is temporarily unavailable')
  const rows = await response.json() as AppUser[]
  return rows[0] || null
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string }
    const email = body.email?.trim().toLowerCase()
    if (!body.password) {
      return Response.json({ error: 'Password is required' }, { status: 400 })
    }

    if (!email) {
      const expectedPassword = readEnv('AUTH_PASSWORD')
      if (!expectedPassword || body.password !== expectedPassword) {
        return Response.json({ error: 'Invalid password' }, { status: 401 })
      }

      const user = {
        id: 'legacy-owner',
        name: 'John.O (Admin)',
        role: 'owner' as const,
        branch: null,
      }
      const token = await createSessionToken({
        userId: user.id,
        role: user.role,
        name: user.name,
      })
      return Response.json({ ok: true, token, user })
    }

    const user = await findUserByEmail(email)
    const passwordMatches = user
      ? await bcrypt.compare(body.password, user.password_hash)
      : false
    if (!user || !passwordMatches || !MOBILE_ROLES.includes(user.role)) {
      return Response.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    const token = await createSessionToken({
      userId: user.id,
      role: user.role,
      name: user.name,
      branch: user.branch || undefined,
    })
    return Response.json({
      ok: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        branch: user.branch || null,
      },
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Sign in failed' },
      { status: 500 },
    )
  }
}
