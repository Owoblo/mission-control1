import { getSessionUser } from '@/lib/server/session'
import { getWorkerSharedSecret } from '@/lib/server/runtime'

const ALLOWED_AUTOMATION_ROLES = new Set(['owner', 'manager'])

export async function isAutomationRequestAuthorized(request: Request) {
  const workerSecret = request.headers.get('x-internal-secret')
  if (workerSecret && getWorkerSharedSecret() && workerSecret === getWorkerSharedSecret()) {
    return true
  }

  const session = await getSessionUser()
  return !!session?.role && ALLOWED_AUTOMATION_ROLES.has(session.role)
}
