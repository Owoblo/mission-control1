import { cookies } from 'next/headers'
import { getSessionCookieName, getSessionPayload, type SessionPayload } from '@/lib/auth'

export async function hasInternalSession() {
  const token = cookies().get(getSessionCookieName())?.value
  const payload = await getSessionPayload(token)
  return payload !== null
}

export async function getSessionUser(): Promise<SessionPayload | null> {
  const token = cookies().get(getSessionCookieName())?.value
  return getSessionPayload(token)
}
