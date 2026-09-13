#!/usr/bin/env node
const token = process.env.CLOUDFLARE_API_TOKEN
const zoneName = process.env.AWS_SES_OUTREACH_DOMAIN || 'saturnstarmovers.ca'
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2'
const mailFromSubdomain = process.env.AWS_SES_MAIL_FROM_DOMAIN || `bounce.${zoneName}`

if (!token) throw new Error('Missing CLOUDFLARE_API_TOKEN')

async function cf(path, init = {}) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.success === false) {
    throw new Error(`Cloudflare ${res.status}: ${JSON.stringify(data)}`)
  }
  return data
}

async function getZoneId() {
  const data = await cf(`/zones?name=${encodeURIComponent(zoneName)}`)
  const zone = data.result?.[0]
  if (!zone?.id) throw new Error(`Cloudflare zone not found for ${zoneName}`)
  return zone.id
}

function relativeName(name) {
  if (!name) return zoneName
  if (name.endsWith(`.${zoneName}`)) return name
  return `${name}.${zoneName}`
}

function recordsFromSesTokens(tokens) {
  const records = tokens.map(token => ({
    type: 'CNAME',
    name: relativeName(`${token}._domainkey`),
    content: `${token}.dkim.amazonses.com`,
    ttl: 3600,
    proxied: false,
    comment: 'SES Easy DKIM for Saturn partnership outreach',
  }))
  records.push({
    type: 'MX',
    name: relativeName(mailFromSubdomain),
    content: `feedback-smtp.${region}.amazonses.com`,
    priority: 10,
    ttl: 3600,
    comment: 'SES custom MAIL FROM for Saturn partnership outreach',
  })
  records.push({
    type: 'TXT',
    name: relativeName(mailFromSubdomain),
    content: 'v=spf1 include:amazonses.com ~all',
    ttl: 3600,
    comment: 'SES MAIL FROM SPF for Saturn partnership outreach',
  })
  return records
}

async function existingRecord(zoneId, record) {
  const data = await cf(`/zones/${zoneId}/dns_records?type=${record.type}&name=${encodeURIComponent(record.name)}`)
  return data.result?.find(item => item.content === record.content || (record.type === 'MX' && item.content === record.content && item.priority === record.priority)) || null
}

async function upsertRecord(zoneId, record) {
  const existing = await existingRecord(zoneId, record)
  if (existing) return { action: 'skipped', id: existing.id, record }
  const data = await cf(`/zones/${zoneId}/dns_records`, {
    method: 'POST',
    body: JSON.stringify(record),
  })
  return { action: 'added', id: data.result?.id, record }
}

async function main() {
  const tokensArgIndex = process.argv.indexOf('--tokens')
  const tokens = tokensArgIndex >= 0 ? process.argv[tokensArgIndex + 1]?.split(',').filter(Boolean) : []
  if (tokens.length !== 3) throw new Error('Pass SES DKIM tokens with --tokens token1,token2,token3')
  const zoneId = await getZoneId()
  const results = []
  for (const record of recordsFromSesTokens(tokens)) {
    results.push(await upsertRecord(zoneId, record))
  }
  console.log(JSON.stringify({ zoneName, zoneId, results }, null, 2))
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
