import fs from 'node:fs'

const grantPath = process.argv[2]
if (!grantPath) throw new Error('Pass path to a short-lived Zoho grant-code file')
const input = fs.readFileSync(grantPath, 'utf8').trim()
const exported = input.startsWith('{') ? JSON.parse(input) : null
const grant = exported?.code || input
if (!/^1000\.[A-Za-z0-9.]+$/.test(grant)) throw new Error('Invalid Zoho grant-code format')
const client = exported || JSON.parse(fs.readFileSync(process.argv[3] || '/Users/owoblo/Downloads/self_client (1).json', 'utf8'))
if (exported && !exported.scope?.includes('ZohoMail.organization.domains.ALL')) throw new Error('Grant export lacks Zoho domain scope')
if (exported && Number(exported.expiry_time) < Date.now()) throw new Error('Zoho grant export is expired')
if (!client.client_id || !client.client_secret) throw new Error('Grant export lacks matching client credentials')
const accountsOrigin = process.env.ZOHO_DOMAIN_ACCOUNTS_ORIGIN || 'https://accounts.zohocloud.ca'
if (!['https://accounts.zohocloud.ca', 'https://accounts.zoho.com'].includes(accountsOrigin)) throw new Error('Unexpected Zoho accounts origin')
const response = await fetch(`${accountsOrigin}/oauth/v2/token`, {
  method: 'POST', body: new URLSearchParams({ grant_type: 'authorization_code', code: grant,
    client_id: client.client_id, client_secret: client.client_secret }), signal: AbortSignal.timeout(15000),
})
const data = await response.json()
if (!response.ok || !data.refresh_token) throw new Error(`Zoho domain grant exchange failed: HTTP ${response.status}, ${data.error || 'missing refresh token'}`)
const target = new URL('../.env.zoho-domain.local', import.meta.url)
fs.writeFileSync(target, [
  `ZOHO_DOMAIN_CLIENT_ID=${client.client_id}`,
  `ZOHO_DOMAIN_CLIENT_SECRET=${client.client_secret}`,
  `ZOHO_DOMAIN_REFRESH_TOKEN=${data.refresh_token}`,
  `ZOHO_DOMAIN_ZOID=110002509062`,
  `ZOHO_DOMAIN_ACCOUNTS_URL=https://accounts.zohocloud.ca`,
  `ZOHO_DOMAIN_MAIL_URL=https://mail.zohocloud.ca`,
  '',
].join('\n'), { mode: 0o600 })
fs.chmodSync(target, 0o600)
console.log(JSON.stringify({ exchanged: true, savedLocally: '.env.zoho-domain.local', scope: data.scope || null }))
