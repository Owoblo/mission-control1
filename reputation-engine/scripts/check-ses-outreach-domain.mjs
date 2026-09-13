import { SESv2Client, GetEmailIdentityCommand, GetConfigurationSetEventDestinationsCommand } from '@aws-sdk/client-sesv2'
import dns from 'node:dns/promises'

const domain = process.argv[2] || process.env.AWS_SES_OUTREACH_DOMAIN || 'saturnstarmovers.ca'
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-2'
const configSet = process.env.AWS_SES_CONFIGURATION_SET || 'saturn-partnership-outreach'

const ses = new SESv2Client({ region })

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map(parts => parts.join('')) } catch { return [] }
}
async function mx(name) {
  try { return await dns.resolveMx(name) } catch { return [] }
}
async function cname(name) {
  try { return await dns.resolveCname(name) } catch { return [] }
}

const identity = await ses.send(new GetEmailIdentityCommand({ EmailIdentity: domain })).catch(error => ({ error: error.message }))
const dkimTokens = identity?.DkimAttributes?.Tokens || []
const dkimRecords = []
for (const token of dkimTokens) {
  const host = `${token}._domainkey.${domain}`
  dkimRecords.push({ host, values: await cname(host) })
}
const mailFromDomain = identity?.MailFromAttributes?.MailFromDomain || `bounce.${domain}`
const events = await ses.send(new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: configSet }))
  .then(res => (res.EventDestinations || []).map(d => ({ name: d.Name, enabled: d.Enabled, events: d.MatchingEventTypes, sns: Boolean(d.SnsDestination), eventBridge: Boolean(d.EventBridgeDestination) })))
  .catch(error => [{ error: error.message }])

console.log(JSON.stringify({
  domain,
  region,
  identity: identity.error ? identity : {
    verifiedForSending: identity.VerifiedForSendingStatus,
    dkimStatus: identity.DkimAttributes?.Status,
    mailFromDomain,
    mailFromStatus: identity.MailFromAttributes?.MailFromDomainStatus,
  },
  dns: {
    spf: await txt(domain).then(rows => rows.filter(row => row.toLowerCase().startsWith('v=spf1'))),
    dmarc: await txt(`_dmarc.${domain}`),
    mailFromMx: await mx(mailFromDomain),
    mailFromSpf: await txt(mailFromDomain),
    dkimRecords,
  },
  eventDestinations: events,
}, null, 2))
