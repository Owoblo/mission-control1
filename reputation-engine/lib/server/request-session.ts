import { getSessionPayload, type SessionPayload } from '@/lib/auth'
import { getSessionUser } from '@/lib/server/session'

/**
 * Authenticates both browser requests (secure session cookie) and first-party
 * native clients (the same signed session carried as a bearer token).
 */
export async function getRequestSessionUser(request: Request): Promise<SessionPayload | null> {
  const authorization = request.headers.get('authorization')?.trim() || ''
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (match?.[1]) return getSessionPayload(match[1].trim())
  return getSessionUser()
}
