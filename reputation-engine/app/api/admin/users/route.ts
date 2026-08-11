import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { canAccessOperationsWorkspace } from '@/lib/server/sales-permissions'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { UserRole } from '@/lib/auth'

interface AppUser {
  id: string
  email: string
  name: string
  role: UserRole
  branch?: string
  created_at: string
}

function ownerOnly(role?: string) {
  return role === 'owner'
}

export async function GET() {
  const session = await getSessionUser()
  if (!canAccessOperationsWorkspace(session)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { url, headers } = requireSupabaseEnv()
  const baseSelect = 'select=id,email,name,role,branch,created_at&order=created_at.asc'
  const query = session?.role === 'operations_lead' && session.branch
    ? `${url}/rest/v1/app_users?${baseSelect}&branch=eq.${encodeURIComponent(session.branch)}&role=in.(operations_lead,manager,crew)`
    : `${url}/rest/v1/app_users?${baseSelect}`
  const res = await fetch(query, { headers, cache: 'no-store' })

  if (!res.ok) return NextResponse.json({ error: 'Failed to load users' }, { status: 500 })
  const users = (await res.json()) as AppUser[]
  return NextResponse.json(users)
}

export async function POST(request: Request) {
  const session = await getSessionUser()
  if (!ownerOnly(session?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json()) as { email?: string; name?: string; role?: UserRole; password?: string }
  if (!body.email || !body.name || !body.role || !body.password) {
    return NextResponse.json({ error: 'email, name, role, password required' }, { status: 400 })
  }

  const validRoles: UserRole[] = ['owner', 'manager', 'sales_rep', 'operations_lead', 'crew', 'partnership_manager', 'partner_admin', 'partner_dispatcher', 'partner_crew']
  if (!validRoles.includes(body.role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(body.password, 12)
  const branch = (body as Record<string, unknown>).branch as string | undefined

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/app_users`, {
    method: 'POST',
    headers: { ...headers, Prefer: 'return=representation' },
    body: JSON.stringify({
      email: body.email.toLowerCase().trim(),
      name: body.name.trim(),
      role: body.role,
      password_hash,
      ...(branch ? { branch } : {}),
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    if (err.includes('unique') || err.includes('duplicate')) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }

  const [created] = (await res.json()) as AppUser[]
  return NextResponse.json({ ok: true, user: created })
}

export async function PATCH(request: Request) {
  const session = await getSessionUser()
  if (!ownerOnly(session?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await request.json()) as { id?: string; name?: string; role?: UserRole; password?: string }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, string> = {}
  if (body.name) updates.name = body.name.trim()
  if (body.role) updates.role = body.role
  if (body.password) updates.password_hash = await bcrypt.hash(body.password, 12)
  const patchBranch = (body as Record<string, unknown>).branch as string | undefined
  if (patchBranch !== undefined) updates.branch = patchBranch

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(
    `${url}/rest/v1/app_users?id=eq.${encodeURIComponent(body.id)}`,
    {
      method: 'PATCH',
      headers: { ...headers, Prefer: 'return=representation' },
      body: JSON.stringify(updates),
    }
  )

  if (!res.ok) return NextResponse.json({ error: 'Failed to update user' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(request: Request) {
  const session = await getSessionUser()
  if (!ownerOnly(session?.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Prevent deleting yourself
  if (session?.userId === id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  const { url, headers } = requireSupabaseEnv()
  const res = await fetch(`${url}/rest/v1/app_users?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers,
  })

  if (!res.ok) return NextResponse.json({ error: 'Failed to delete user' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
