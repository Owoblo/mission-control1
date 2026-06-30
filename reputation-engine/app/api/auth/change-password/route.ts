import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'

interface AppUserPasswordRow {
  id: string
  password_hash: string
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!session?.userId) {
    return NextResponse.json({ error: 'Sign in with your email before changing password.' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as {
    currentPassword?: string
    newPassword?: string
  }

  const currentPassword = body.currentPassword || ''
  const newPassword = body.newPassword || ''
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: 'Current password and new password are required.' }, { status: 400 })
  }
  if (newPassword.length < 8) {
    return NextResponse.json({ error: 'New password must be at least 8 characters.' }, { status: 400 })
  }
  if (newPassword === currentPassword) {
    return NextResponse.json({ error: 'New password must be different from the current password.' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const readResponse = await fetch(
    `${url}/rest/v1/app_users?id=eq.${encodeURIComponent(session.userId)}&select=id,password_hash&limit=1`,
    { headers, cache: 'no-store' }
  )

  if (!readResponse.ok) {
    return NextResponse.json({ error: 'Could not verify your account.' }, { status: 500 })
  }

  const rows = (await readResponse.json()) as AppUserPasswordRow[]
  const user = rows[0]
  if (!user) return NextResponse.json({ error: 'Account not found.' }, { status: 404 })

  const matches = await bcrypt.compare(currentPassword, user.password_hash)
  if (!matches) {
    return NextResponse.json({ error: 'Current password is incorrect.' }, { status: 401 })
  }

  const password_hash = await bcrypt.hash(newPassword, 12)
  const updateResponse = await fetch(
    `${url}/rest/v1/app_users?id=eq.${encodeURIComponent(session.userId)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=minimal' },
      body: JSON.stringify({ password_hash }),
    }
  )

  if (!updateResponse.ok) {
    return NextResponse.json({ error: 'Could not update password.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
