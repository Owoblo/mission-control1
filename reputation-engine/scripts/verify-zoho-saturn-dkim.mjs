import fs from 'node:fs'
import { Resolver } from 'node:dns/promises'

const credentialFile = fs.existsSync(new URL('../.env.zoho-domain.local', import.meta.url))
  ? new URL('../.env.zoho-domain.local', import.meta.url)
  : new URL('../.env.zoho-admin.local', import.meta.url)
const values = Object.fromEntries(fs.readFileSync(credentialFile, 'utf8')
  .split('\n').filter(line => /^[A-Z_]+=/.test(line)).map(line => {
    const at = line.indexOf('=')
    return [line.slice(0, at), line.slice(at + 1).trim().replace(/^['"]|['"]$/g, '')]
  }))
const prefix = values.ZOHO_DOMAIN_CLIENT_ID ? 'ZOHO_DOMAIN' : 'ZOHO_ADMIN'
const clientId = values[`${prefix}_CLIENT_ID`]
const clientSecret = values[`${prefix}_CLIENT_SECRET`]
const refreshToken = values[`${prefix}_REFRESH_TOKEN`]
const zoid = values[`${prefix}_ZOID`]
if (!clientId || !clientSecret || !refreshToken || !zoid) throw new Error('Missing Zoho admin configuration')
const accounts = values[`${prefix}_ACCOUNTS_URL`] || 'https://accounts.zohocloud.ca'
const mail = values[`${prefix}_MAIL_URL`] || 'https://mail.zohocloud.ca'
const domain = 'saturnstarmovers.ca'
const path = `/api/organization/${encodeURIComponent(zoid)}/domains/${domain}`
const tokenResponse = await fetch(`${accounts}/oauth/v2/token`, {
  method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: clientId,
    client_secret: clientSecret, refresh_token: refreshToken }), signal: AbortSignal.timeout(15000),
})
const tokenData = await tokenResponse.json()
if (!tokenResponse.ok || !tokenData.access_token) throw new Error(`Zoho OAuth failed: HTTP ${tokenResponse.status}`)
async function call(method, body) {
  const response = await fetch(`${mail}${path}`, { method,
    headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  })
  const data = await response.json()
  if (!response.ok || (data.status?.code && data.status.code >= 400))
    throw new Error(`Zoho domain ${method} failed: HTTP ${response.status}, code ${data.status?.code || 'unknown'}`)
  return data
}
const details = await call('GET')
const record = details.data || details
const configs = Array.isArray(record.dkimDetailList) ? record.dkimDetailList
  : Array.isArray(record.dkimDetails) ? record.dkimDetails
    : Array.isArray(record.dkim) ? record.dkim : []
const selector = configs.find(value => String(value.selector || value.dkimSelector || '').toLowerCase() === 'zmail')
const resolver = new Resolver()
resolver.setServers(['1.1.1.1'])
const publicTxt = (await resolver.resolveTxt(`zmail._domainkey.${domain}`)).map(parts => parts.join(''))
const expected = String(selector?.value || selector?.publicKey || selector?.dkimPublicKey || '').trim()
const dnsMatches = expected ? publicTxt.some(value => value === expected) : null
const compact = value => value.replace(/\s+/g, '').toLowerCase()
const dnsMatchesCompact = expected ? publicTxt.some(value => compact(value) === compact(expected)) : null
const firstDifference = expected && publicTxt[0] ? Array.from({ length: Math.min(expected.length, publicTxt[0].length) }).findIndex((_, index) => expected[index] !== publicTxt[0][index]) : null
const summary = { domain, status: details.status?.code || null, domainVerified: record.verificationStatus ?? record.isVerified ?? record.verified ?? null,
  dkimEnabled: record.dkimstatus ?? record.dkimEnabled ?? record.isDkimEnabled ?? null,
  selector: selector ? { id: selector.dkimId ?? selector.id ?? null, verified: selector.isVerified ?? null,
    isDefault: selector.isDefault ?? selector.default ?? null } : null,
  dnsTxtPresent: publicTxt.length > 0, dnsMatchesZohoKey: dnsMatches,
  dnsMatchesAfterWhitespaceNormalization: dnsMatchesCompact,
  expectedLength: expected.length, dnsLengths: publicTxt.map(value => value.length),
  firstDifference,
  differenceAt: firstDifference >= 0 ? { zoho: expected.slice(Math.max(0, firstDifference - 8), firstDifference + 9), dns: publicTxt[0].slice(Math.max(0, firstDifference - 8), firstDifference + 9) } : null,
  keys: Object.keys(record).filter(key => /dkim/i.test(key)),
  applyRequested: process.argv.includes('--apply') }
if (process.argv.includes('--fix-dns')) {
  if (!expected || publicTxt.length !== 1 || expected.length !== publicTxt[0].length ||
      [...expected].filter((char, index) => char !== publicTxt[0][index]).length !== 1)
    throw new Error('Expected a single one-character DKIM TXT mismatch; no DNS mutation')
  process.loadEnvFile('.env.cloudflare.local')
  const cfToken = process.env.CLOUDFLARE_API_TOKEN
  if (!cfToken) throw new Error('Missing Cloudflare DNS token')
  async function cf(path, init = {}) {
    const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
      ...init, headers: { Authorization: `Bearer ${cfToken}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
    })
    const data = await response.json()
    if (!response.ok || !data.success) throw new Error(`Cloudflare HTTP ${response.status}, error ${data.errors?.[0]?.code || 'unknown'}`)
    return data.result
  }
  const zones = await cf(`/zones?name=${encodeURIComponent(domain)}`)
  if (zones.length !== 1) throw new Error('Expected exactly one Cloudflare zone')
  const zoneId = zones[0].id
  const records = await cf(`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(`zmail._domainkey.${domain}`)}&per_page=100`)
  if (records.length !== 1 || records[0].content.replace(/^"|"$/g, '') !== publicTxt[0])
    throw new Error('Cloudflare DKIM record differs from the observed public DNS; no mutation')
  await cf(`/zones/${zoneId}/dns_records/${records[0].id}`, { method: 'PATCH', body: JSON.stringify({ content: expected }) })
  console.log(JSON.stringify({ correctedCloudflareDkimTxt: true, changedCharacters: 1, domain }, null, 2))
  process.exit(0)
}
if (!process.argv.includes('--apply')) { console.log(JSON.stringify(summary, null, 2)); process.exit(0) }
if (!selector?.dkimId && !selector?.id) throw new Error('Zoho zmail DKIM ID missing; no mutation')
if (dnsMatches !== true) throw new Error('Zoho DKIM key cannot be proven equal to public DNS; no mutation')
if (!selector.isVerified) await call('PUT', { mode: 'verifyDkimKey', dkimId: String(selector.dkimId || selector.id) })
const verified = await call('GET')
const post = verified.data || verified
const postConfigs = Array.isArray(post.dkimDetailList) ? post.dkimDetailList
  : Array.isArray(post.dkimDetails) ? post.dkimDetails : Array.isArray(post.dkim) ? post.dkim : []
const postSelector = postConfigs.find(value => String(value.selector || value.dkimSelector || '').toLowerCase() === 'zmail')
if (postSelector?.isVerified !== true)
  throw new Error('Zoho did not report verified DKIM selector; enable step withheld')
if (postSelector?.isDefault !== true) await call('PUT', { mode: 'makeDkimDefault', dkimId: String(postSelector.dkimId || postSelector.id) })
const defaultDetails = await call('GET')
const defaultRecord = defaultDetails.data || defaultDetails
const defaultSelector = (defaultRecord.dkimDetailList || []).find(value => String(value.selector).toLowerCase() === 'zmail')
if (defaultSelector?.isDefault !== true) throw new Error('Zoho did not report zmail as default; enable step withheld')
if (defaultRecord.dkimstatus !== true) await call('PUT', { mode: 'enableDKIM' })
const final = await call('GET')
const finalRecord = final.data || final
console.log(JSON.stringify({ ...summary, verified: postSelector.isVerified, enabled: finalRecord.dkimstatus === true }, null, 2))
