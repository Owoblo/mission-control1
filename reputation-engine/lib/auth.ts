import { requireEnv } from '@/lib/server/runtime'

const SESSION_COOKIE = 'mc_session'
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7
const SESSION_REFRESH_WINDOW_MS = 1000 * 60 * 60 * 24

export type UserRole = 'owner' | 'manager' | 'sales_rep' | 'operations_lead' | 'crew'

export interface SessionPayload {
  exp: number
  userId?: string
  role?: UserRole
  name?: string
  branch?: string   // for operations_lead: which branch they manage
}

function toBase64Url(input: ArrayBuffer | string) {
  const bytes =
    typeof input === 'string'
      ? new TextEncoder().encode(input)
      : new Uint8Array(input)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(input: string) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '==='.slice((normalized.length + 3) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return toBase64Url(signature)
}

function getAuthSecret() {
  return requireEnv('AUTH_SECRET')
}

export function getSessionCookieName() {
  return SESSION_COOKIE
}

export function getSessionCookieOptions(options?: { maxAge?: number }) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: options?.maxAge ?? Math.floor(SESSION_TTL_MS / 1000),
  }
}

export function getExpiredSessionCookieOptions() {
  return {
    ...getSessionCookieOptions({ maxAge: 0 }),
    expires: new Date(0),
  }
}

export function shouldRefreshSession(payload: SessionPayload, now = Date.now()) {
  return payload.exp - now <= SESSION_REFRESH_WINDOW_MS
}

export async function createSessionToken(options?: {
  userId?: string
  role?: UserRole
  name?: string
  branch?: string
}) {
  const payload: SessionPayload = {
    exp: Date.now() + SESSION_TTL_MS,
    ...options,
  }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const encodedSignature = await sign(encodedPayload, getAuthSecret())
  return `${encodedPayload}.${encodedSignature}`
}

export async function getSessionPayload(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null
  const [encodedPayload, encodedSignature] = token.split('.')
  if (!encodedPayload || !encodedSignature) return null

  const expectedSignature = await sign(encodedPayload, getAuthSecret())
  if (expectedSignature !== encodedSignature) return null

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64Url(encodedPayload))
    ) as SessionPayload
    if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null
    return payload
  } catch {
    return null
  }
}

export async function verifySessionToken(token?: string | null): Promise<boolean> {
  return (await getSessionPayload(token)) !== null
}
