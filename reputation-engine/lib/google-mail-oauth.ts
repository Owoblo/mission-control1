import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const GOOGLE_MAIL_CALLBACK = '/api/marketing/google-mail/callback'
export const GOOGLE_MAIL_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly']
export const GOOGLE_MAILBOXES = ['saturnstarpartners.com', 'saturnstarmoving.com', 'moveswithsaturn.com', 'saturnstarconnect.com'].flatMap(domain => ['john', 'johnny'].map(name => `${name}@${domain}`))
export function mailboxAllowed(email: string) { return GOOGLE_MAILBOXES.includes(email) }
export function digest(value: string) { return createHash('sha256').update(value).digest('hex') }
function encryptionKey(key: string) {
  const bytes = Buffer.from(key, 'base64')
  if (bytes.length !== 32) throw new Error('Invalid Google mail encryption key')
  return bytes
}
export function seal(value: string, key: string, context: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv)
  cipher.setAAD(Buffer.from(context))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}
export function unseal(value: string, key: string, context: string) {
  const [version, iv, tag, data, extra] = value.split('.')
  if (version !== 'v1' || !iv || !tag || !data || extra) throw new Error('Invalid encrypted credential')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(context))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}
export function callbackUrl(origin: string) {
  const url = new URL(origin)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === 'localhost'))) throw new Error('Invalid Google mail origin')
  return new URL(GOOGLE_MAIL_CALLBACK, url).toString()
}
export function authorizationUrl(clientId: string, redirectUri: string, email: string, state: string, verifier: string) {
  if (!mailboxAllowed(email)) throw new Error('Mailbox is outside approved cohort')
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_MAIL_SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', login_hint: email, state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString()
  return url.toString()
}
export function validateGrant(scope: string, actualEmail: string, expectedEmail: string) {
  const scopes = new Set(scope.split(' '))
  if (!mailboxAllowed(expectedEmail) || actualEmail.toLowerCase() !== expectedEmail) throw new Error('Wrong Google mailbox')
  for (const required of GOOGLE_MAIL_SCOPES.filter(s => s.includes('/auth/gmail.'))) if (!scopes.has(required)) throw new Error('Required Gmail permission missing')
}
