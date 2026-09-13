#!/usr/bin/env node
import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  CreateConfigurationSetCommand,
  PutEmailIdentityMailFromAttributesCommand,
  CreateConfigurationSetEventDestinationCommand,
} from '@aws-sdk/client-sesv2'
import { CreateTopicCommand, SubscribeCommand, SNSClient } from '@aws-sdk/client-sns'

const domain = process.env.AWS_SES_OUTREACH_DOMAIN || 'saturnstarmovers.com'
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2'
const configurationSetName = process.env.AWS_SES_CONFIGURATION_SET || 'saturn-partnership-outreach'
const mailFromSubdomain = process.env.AWS_SES_MAIL_FROM_DOMAIN || `bounce.${domain}`
const vercelToken = process.env.VERCEL_TOKEN
const vercelTeamId = process.env.VERCEL_TEAM_ID || 'team_EAg0Uem06yxKWgslp95UsC6Z'
const eventWebhookUrl = process.env.AWS_SES_EVENT_WEBHOOK_URL || 'https://go.quote2move.com/api/marketing/email-events/ses'
const setupEvents = process.argv.includes('--setup-events')
const applyDns = process.argv.includes('--apply-dns')

function requireEnv(name) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

requireEnv('AWS_ACCESS_KEY_ID')
requireEnv('AWS_SECRET_ACCESS_KEY')

const ses = new SESv2Client({ region })
const sns = new SNSClient({ region })

async function getOrCreateIdentity() {
  try {
    return await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
  } catch (error) {
    const name = error?.name || ''
    if (!/NotFound/i.test(name)) throw error
    await ses.send(new CreateEmailIdentityCommand({ EmailIdentity: domain }))
    return await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain }))
  }
}

async function ensureConfigurationSet() {
  try {
    await ses.send(new CreateConfigurationSetCommand({ ConfigurationSetName: configurationSetName }))
    return 'created'
  } catch (error) {
    const name = error?.name || ''
    if (/AlreadyExists/i.test(name)) return 'already_exists'
    throw error
  }
}

async function configureMailFrom() {
  await ses.send(new PutEmailIdentityMailFromAttributesCommand({
    EmailIdentity: domain,
    MailFromDomain: mailFromSubdomain,
    BehaviorOnMxFailure: 'USE_DEFAULT_VALUE',
  }))
}

async function setupEventDestination() {
  const topic = await sns.send(new CreateTopicCommand({ Name: 'saturn-partnership-ses-events' }))
  const topicArn = topic.TopicArn
  if (!topicArn) throw new Error('SNS topic ARN missing')

  await sns.send(new SubscribeCommand({
    TopicArn: topicArn,
    Protocol: 'https',
    Endpoint: eventWebhookUrl,
    ReturnSubscriptionArn: true,
  })).catch(error => {
    const name = error?.name || ''
    if (!/SubscriptionLimitExceeded|InvalidParameter/.test(name)) throw error
  })

  await ses.send(new CreateConfigurationSetEventDestinationCommand({
    ConfigurationSetName: configurationSetName,
    EventDestinationName: 'saturn-crm-sns-events',
    EventDestination: {
      Enabled: true,
      MatchingEventTypes: ['SEND', 'REJECT', 'BOUNCE', 'COMPLAINT', 'DELIVERY', 'OPEN', 'CLICK', 'DELIVERY_DELAY', 'SUBSCRIPTION'],
      SnsDestination: { TopicArn: topicArn },
    },
  })).catch(error => {
    const name = error?.name || ''
    if (/AlreadyExists/i.test(name)) return
    throw error
  })

  return { topicArn, eventWebhookUrl }
}

function withTeam(path) {
  if (!vercelTeamId) return path
  return `${path}${path.includes('?') ? '&' : '?'}teamId=${encodeURIComponent(vercelTeamId)}`
}

async function vercel(path, init = {}) {
  if (!vercelToken) throw new Error('Missing VERCEL_TOKEN')
  const res = await fetch(`https://api.vercel.com${withTeam(path)}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${vercelToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const body = await res.text()
  let data
  try { data = JSON.parse(body) } catch { data = body }
  if (!res.ok) throw new Error(`Vercel ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`)
  return data
}

function dnsRecords(identity) {
  const tokens = identity?.DkimAttributes?.Tokens || []
  const records = tokens.map(token => ({
    type: 'CNAME',
    name: `${token}._domainkey`,
    value: `${token}.dkim.amazonses.com`,
    ttl: 3600,
    purpose: 'SES Easy DKIM',
  }))

  records.push({
    type: 'MX',
    name: mailFromSubdomain.replace(`.${domain}`, ''),
    value: `10 feedback-smtp.${region}.amazonses.com`,
    ttl: 3600,
    purpose: 'SES custom MAIL FROM',
  })
  records.push({
    type: 'TXT',
    name: mailFromSubdomain.replace(`.${domain}`, ''),
    value: 'v=spf1 include:amazonses.com ~all',
    ttl: 3600,
    purpose: 'MAIL FROM SPF',
  })
  if (process.env.AWS_SES_ADD_DMARC === 'true') {
    records.push({
      type: 'TXT',
      name: '_dmarc',
      value: `v=DMARC1; p=none; rua=mailto:dmarc@${domain}; adkim=s; aspf=s`,
      ttl: 3600,
      purpose: 'DMARC monitor mode',
    })
  }

  return records
}

async function existingVercelRecords() {
  if (!vercelToken) return []
  const data = await vercel(`/v4/domains/${encodeURIComponent(domain)}/records`)
  return Array.isArray(data.records) ? data.records : []
}

function equivalentExists(existing, record) {
  const clean = value => String(value || '').replace(/\.$/, '').trim().toLowerCase()
  const wantedName = record.name ? `${record.name}.${domain}` : domain
  return existing.some(item =>
    clean(item.type) === clean(record.type) &&
    (clean(item.name) === clean(record.name) || clean(item.name) === clean(wantedName)) &&
    clean(item.value) === clean(record.value)
  )
}

async function addVercelRecord(record) {
  const payload = {
    type: record.type,
    name: record.name,
    value: record.value,
    ttl: record.ttl,
  }
  if (record.type === 'MX') {
    const match = String(record.value).match(/^(\d+)\s+(.+)$/)
    if (match) {
      payload.mxPriority = Number(match[1])
      payload.value = match[2]
    }
  }
  return vercel(`/v4/domains/${encodeURIComponent(domain)}/records`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

async function main() {
  const configSetStatus = await ensureConfigurationSet()
  const identity = await getOrCreateIdentity()
  await configureMailFrom()
  const refreshed = await getOrCreateIdentity()
  const records = dnsRecords(refreshed)

  const report = {
    domain,
    region,
    configurationSetName,
    configurationSetStatus: configSetStatus,
    identityStatus: refreshed.VerificationStatus,
    dkimStatus: refreshed.DkimAttributes?.Status,
    mailFromSubdomain,
    dnsProvider: vercelToken ? 'vercel' : 'manual',
    vercelTeamId,
    applyDns,
    setupEvents,
    eventWebhookUrl,
    records,
    added: [],
    skipped: [],
  }

  if (setupEvents) {
    report.events = await setupEventDestination()
  }

  if (applyDns) {
    const existing = await existingVercelRecords()
    for (const record of records) {
      if (equivalentExists(existing, record)) {
        report.skipped.push({ ...record, reason: 'already_exists' })
        continue
      }
      await addVercelRecord(record)
      report.added.push(record)
    }
  }

  console.log(JSON.stringify(report, null, 2))
}

main().catch(error => {
  console.error(error?.message || error)
  process.exit(1)
})
