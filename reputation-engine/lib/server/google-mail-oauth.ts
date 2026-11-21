import { randomBytes } from 'node:crypto'
import { requireEnv, requireSupabaseEnv } from './runtime'
import { authorizationUrl, callbackUrl, digest, mailboxAllowed, seal, unseal, validateGrant } from '../google-mail-oauth'

export function googleMailConfig() {
  return { clientId: requireEnv('GOOGLE_MAIL_CLIENT_ID'), secret: requireEnv('GOOGLE_MAIL_CLIENT_SECRET'), key: requireEnv('GOOGLE_MAIL_TOKEN_KEY'), redirectUri: callbackUrl(requireEnv('GOOGLE_MAIL_ORIGIN')) }
}
async function db(path: string, init: RequestInit = {}) {
  const { url, headers } = requireSupabaseEnv()
  const response = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...init.headers }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('Google mailbox storage unavailable')
  const text = await response.text()
  return text ? JSON.parse(text) : null
}
export async function startGoogleMail(email: string, userId: string, binding: string) {
  if (!mailboxAllowed(email)) throw new Error('Mailbox is outside approved cohort')
  const config = googleMailConfig()
  const state = randomBytes(32).toString('base64url'), verifier = randomBytes(48).toString('base64url')
  await db('google_mail_oauth_attempts', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ state_hash: digest(state), owner_id: userId, binding_hash: digest(binding), email, verifier_encrypted: seal(verifier, config.key, digest(state)), expires_at: new Date(Date.now() + 600000).toISOString() }) })
  return authorizationUrl(config.clientId, config.redirectUri, email, state, verifier)
}
export async function finishGoogleMail(code: string, state: string, userId: string, binding: string) {
  const config = googleMailConfig()
  // Atomic DELETE claims the attempt once. Matching owner, browser and expiry are required.
  const rows = await db(`google_mail_oauth_attempts?state_hash=eq.${digest(state)}&owner_id=eq.${encodeURIComponent(userId)}&binding_hash=eq.${digest(binding)}&expires_at=gt.${encodeURIComponent(new Date().toISOString())}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } })
  if (rows?.length !== 1) throw new Error('Expired or invalid authorization attempt')
  const attempt = rows[0]
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body: new URLSearchParams({ client_id: config.clientId, client_secret: config.secret, redirect_uri: config.redirectUri, grant_type: 'authorization_code', code, code_verifier: unseal(attempt.verifier_encrypted, config.key, digest(state)) }) })
  if (!response.ok) throw new Error('Google authorization exchange failed')
  const token = await response.json()
  if (typeof token.access_token !== 'string' || typeof token.refresh_token !== 'string' || !token.refresh_token) throw new Error('Offline access was not granted; reconnect with consent')
  const profileResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${token.access_token}` }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!profileResponse.ok) throw new Error('Google mailbox profile unavailable')
  const profile = await profileResponse.json()
  validateGrant(String(token.scope || ''), String(profile.emailAddress || ''), attempt.email)
  await db('google_mail_connections?on_conflict=email', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ email: attempt.email, refresh_token_encrypted: seal(token.refresh_token, config.key, attempt.email), scopes: token.scope.split(' '), connected_by: userId, connected_at: new Date().toISOString(), status: 'connected', campaign_enabled: false }) })
  return attempt.email as string
}
export async function listGoogleMail() {
  return db('google_mail_connections?select=email,status,connected_at,campaign_enabled&order=email')
}

/** Server-only refresh for future Gmail transport. Never return this token from an API route. */
export async function refreshGoogleMailAccess(email: string) {
  if (!mailboxAllowed(email)) throw new Error('Mailbox is outside approved cohort')
  const config = googleMailConfig()
  const rows = await db(`google_mail_connections?email=eq.${encodeURIComponent(email)}&select=refresh_token_encrypted,status`)
  if (rows?.length !== 1 || rows[0].status !== 'connected') throw new Error('Mailbox requires connection')
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), body: new URLSearchParams({ client_id: config.clientId, client_secret: config.secret, grant_type: 'refresh_token', refresh_token: unseal(rows[0].refresh_token_encrypted, config.key, email) }) })
  const token = await response.json()
  if (!response.ok || typeof token.access_token !== 'string') {
    if (token.error === 'invalid_grant') await db(`google_mail_connections?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'reconnect_required' }) })
    throw new Error('Google access refresh failed')
  }
  if (token.refresh_token) await db(`google_mail_connections?email=eq.${encodeURIComponent(email)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ refresh_token_encrypted: seal(token.refresh_token, config.key, email) }) })
  return token.access_token as string
}
