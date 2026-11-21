import fs from 'node:fs'

function load(file) {
  return Object.fromEntries(fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    .split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
      const at = line.indexOf('=')
      return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]
    }))
}
const configs = [
  { name: 'organization-admin', values: load('.env.zoho-admin.local'), prefix: 'ZOHO_ADMIN' },
  { name: 'business-mailbox', values: load('.env.zoho-reconnect.local'), prefix: 'ZOHO_PARTNERSHIP' },
]
const result = []
for (const { name, values, prefix } of configs) {
  const clientId = values[`${prefix}_CLIENT_ID`]
  const clientSecret = values[`${prefix}_CLIENT_SECRET`]
  const refreshToken = values[`${prefix}_REFRESH_TOKEN`]
  const accounts = values[`${prefix}_ACCOUNTS_URL`] || 'https://accounts.zohocloud.ca'
  const mail = values[`${prefix}_MAIL_URL`] || 'https://mail.zohocloud.ca'
  if (!clientId || !clientSecret || !refreshToken) { result.push({ name, error: 'missing_credentials' }); continue }
  const tokenResponse = await fetch(`${accounts}/oauth/v2/token`, { method: 'POST', body: new URLSearchParams({
    grant_type: 'refresh_token', client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
  }), signal: AbortSignal.timeout(15000) })
  const token = await tokenResponse.json()
  if (!tokenResponse.ok || !token.access_token) { result.push({ name, oauthStatus: tokenResponse.status }); continue }
  const zoid = values.ZOHO_ADMIN_ZOID || '110002509062'
  const response = await fetch(`${mail}/api/organization/${zoid}/domains/saturnstarmovers.ca`, {
    headers: { Authorization: `Zoho-oauthtoken ${token.access_token}` }, signal: AbortSignal.timeout(15000),
  })
  const payload = await response.json().catch(() => ({}))
  result.push({ name, domainStatus: response.status, code: payload.status?.code || payload.errorCode || null,
    message: String(payload.status?.description || payload.message || '').slice(0, 120),
    domainFound: Boolean(payload.data), domainDataKeys: payload.data ? Object.keys(payload.data).filter(key => /dkim/i.test(key)) : [] })
}
console.log(JSON.stringify(result, null, 2))
