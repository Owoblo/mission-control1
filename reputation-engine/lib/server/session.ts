import { cookies } from 'next/headers'
import { getSessionCookieName, verifySessionToken } from '@/lib/auth'

export async function hasInternalSession() {
  const token = cookies().get(getSessionCookieName())?.value
  return verifySessionToken(token)
}
