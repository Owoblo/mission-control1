import { getRequestSessionUser } from '@/lib/server/request-session'

export async function GET(request: Request) {
  const user = await getRequestSessionUser(request)
  if (!user?.userId || !['owner', 'manager', 'sales_rep', 'partnership_manager'].includes(user.role || '')) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return Response.json({ ok: true, user })
}
