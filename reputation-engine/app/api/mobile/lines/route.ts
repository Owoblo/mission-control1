import { getRequestSessionUser } from '@/lib/server/request-session'
import { listMobilePhoneLines } from '@/lib/server/mobile-phone-access'

export async function GET(request: Request) {
  const session = await getRequestSessionUser(request)
  if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  return Response.json({ lines: listMobilePhoneLines(session) })
}
