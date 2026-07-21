import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import type { UserRole } from '@/lib/auth'
import { canAccessSalesWorkspace } from '@/lib/server/sales-permissions'

interface SalesUser {
  id: string
  name: string
  role: UserRole
  branch?: string | null
}

const SALES_VISIBLE_ROLES: UserRole[] = ['owner', 'manager', 'sales_rep']

export async function GET() {
  const session = await getSessionUser()
  if (!canAccessSalesWorkspace(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { url, headers } = requireSupabaseEnv()
  const visibleRoles = SALES_VISIBLE_ROLES.join(',')
  const response = await fetch(
    `${url}/rest/v1/app_users?select=id,name,role,branch&role=in.(${visibleRoles})&order=name.asc`,
    { headers, cache: 'no-store' }
  )

  if (!response.ok) {
    return NextResponse.json({ error: 'Failed to load sales users' }, { status: 500 })
  }

  const users = (await response.json()) as SalesUser[]
  return NextResponse.json(
    users.filter(user => user.id && user.name && (!session?.branch || user.branch === session.branch)).map(user => ({
      id: user.id,
      name: user.name,
      role: user.role,
    }))
  )
}
