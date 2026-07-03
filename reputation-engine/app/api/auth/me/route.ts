import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    role: user.role ?? 'owner',
    name: user.name ?? 'Owner',
    userId: user.userId ?? null,
    branch: user.branch ?? null,
  })
}
