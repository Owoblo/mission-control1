import { SESv2Client, GetAccountCommand, GetEmailIdentityCommand, GetConfigurationSetEventDestinationsCommand } from '@aws-sdk/client-sesv2'
import { resolveTxt } from 'node:dns/promises'
import { openZohoMailbox } from '@/lib/partnership-core/zoho.mjs'
import { emailAddress, emailStorage } from './email-delivery'
import { readEnv } from './runtime'

type Row=Record<string,any>
export async function getEmailInfrastructure() { return emailStorage<Row>('rpc/crm_email_foundation_report',{}) }
export async function refreshEmailInfrastructure() {
  const region=readEnv('AWS_REGION')||readEnv('AWS_DEFAULT_REGION')||'us-east-2'
  const client=new SESv2Client({region,credentials:{accessKeyId:readEnv('AWS_ACCESS_KEY_ID'),secretAccessKey:readEnv('AWS_SECRET_ACCESS_KEY')},maxAttempts:1})
  const account=await client.send(new GetAccountCommand({}),{abortSignal:AbortSignal.timeout(15000)})
  const checkedAt=new Date().toISOString()
  const snapshot={sendingEnabled:account.SendingEnabled===true,production:account.ProductionAccessEnabled===true,enforcement:account.EnforcementStatus || 'unknown',
    max24HourSend:account.SendQuota?.Max24HourSend || 0,sentLast24Hours:account.SendQuota?.SentLast24Hours || 0,maxSendRate:account.SendQuota?.MaxSendRate || 0,
    pricingPlan:account.PricingAttributes?.CurrentPlan || 'unknown',messageHistoryEnabled:account.VdmAttributes?.VdmEnabled==='ENABLED'}
  await emailStorage('crm_email_provider_health?on_conflict=region',{region,snapshot,checked_at:checkedAt},'POST')
  const replyHealth = new Map<string,boolean>()
  const configuration=readEnv('AWS_SES_DELIVERABILITY_CONFIGURATION_SET') || 'saturn-crm-deliverability'
  const events=await client.send(new GetConfigurationSetEventDestinationsCommand({ConfigurationSetName:configuration}),{abortSignal:AbortSignal.timeout(15000)}).catch(()=>null)
  const expectedTopic=readEnv('AWS_SES_SNS_TOPIC_ARN') || 'arn:aws:sns:us-east-2:322694470585:saturn-partnership-ses-events'
  const receiptRouteReady=!!events?.EventDestinations?.some(d=>d.Enabled && d.SnsDestination?.TopicArn===expectedTopic && ['SEND','DELIVERY','BOUNCE','COMPLAINT'].every(e=>d.MatchingEventTypes?.includes(e as any)))
  const domains=await emailStorage<Row[]>('crm_email_domains?select=domain,purpose')
  for(const domain of domains) {
    const replyMarket = domain.domain === 'dexamovers.ca' ? 'ottawa' : 'saturn'
    const replyMailbox = replyMarket === 'ottawa' ? 'hello@dexamovers.ca' : 'business@starmovers.ca'
    if (!replyHealth.has(replyMarket)) {
      let ready=false
      try { const mailbox=await openZohoMailbox(replyMarket); ready=mailbox.mailbox===replyMailbox } catch {}
      replyHealth.set(replyMarket,ready)
    }
    const replyReady=replyHealth.get(replyMarket)===true
    let health:Row={ready:false,replyReady,replyMailbox,receiptRouteReady,configuration}
    try {
      const identity=await client.send(new GetEmailIdentityCommand({EmailIdentity:domain.domain}),{abortSignal:AbortSignal.timeout(15000)})
      const mailFrom=identity.MailFromAttributes?.MailFromDomain
      const [spf,dmarc]=await Promise.all([mailFrom?resolveTxt(mailFrom).catch(()=>[]):Promise.resolve([]),resolveTxt('_dmarc.'+domain.domain).catch(()=>[])])
      health={...health,verified:identity.VerifiedForSendingStatus===true,dkim:identity.DkimAttributes?.Status,mailFrom:identity.MailFromAttributes?.MailFromDomainStatus,
        spf:spf.some(parts=>parts.join('').includes('include:amazonses.com')),dmarc:dmarc.some(parts=>parts.join('').startsWith('v=DMARC1;'))}
      health.ready=snapshot.sendingEnabled && snapshot.production && snapshot.enforcement==='HEALTHY' && health.verified && health.dkim==='SUCCESS' && health.mailFrom==='SUCCESS' && health.spf && health.dmarc && replyReady && receiptRouteReady
    }catch { health={...health,ready:false,error:'Sending identity check unavailable'} }
    await emailStorage(`crm_email_domains?domain=eq.${encodeURIComponent(domain.domain)}`,{health,checked_at:checkedAt,updated_at:checkedAt},'PATCH')
  }
  return getEmailInfrastructure()
}
export async function registerOutreachSender(input:Row) {
  const from=emailAddress(String(input.email||'')),domain=from.split('@')[1]
  const [settings]=await emailStorage<Row[]>(`crm_email_domains?domain=eq.${encodeURIComponent(domain)}&select=domain,purpose`)
  if(settings?.purpose!=='outreach') throw Error('Choose an approved outreach domain')
  const name=String(input.name||'').trim(),owner=String(input.owner||'').trim()
  if(!name||!owner||name.length>100||owner.length>100||/[<>\r\n]/.test(name))throw Error('Enter the real sender name and owner')
  const [exists]=await emailStorage<Row[]>(`email_sender_accounts?provider=eq.ses&from_email=eq.${encodeURIComponent(from)}&select=id&limit=1`)
  if(exists)throw Error('This sender address is already registered')
  if(domain==='dexamovers.ca'&&(from!=='hello@dexamovers.ca'||name!=='Courage Eke'))throw Error('Dexa outreach uses the approved Courage Eke sender')
  await emailStorage('email_sender_accounts',{provider:'ses',domain,from_email:from,from_name:name,reply_to_email:domain==='dexamovers.ca'?'hello@dexamovers.ca':'business@starmovers.ca',region:readEnv('AWS_REGION')||'us-east-2',status:'setup',daily_cap:25,metadata:{owner_name:owner,purpose:'outreach',mailbox_created:false}})
  return getEmailInfrastructure()
}
export async function updateOutreachSender(input:Row) {
  const [sender]=await emailStorage<Row[]>(`email_sender_accounts?id=eq.${encodeURIComponent(String(input.id||''))}&provider=eq.ses&select=*`)
  if(!sender)throw Error('Sender not found')
  if(!['setup','warming','active','paused','retired'].includes(input.status))throw Error('Choose a valid sender state')
  const [domain]=await emailStorage<Row[]>(`crm_email_domains?domain=eq.${encodeURIComponent(sender.domain)}&select=*`)
  if(!domain||domain.purpose!=='outreach')throw Error('Only outreach sender settings can be changed here')
  if(['warming','active'].includes(input.status)) {
    if(!domain.health?.ready||(!Number.isFinite(Date.parse(domain.checked_at))||Date.parse(domain.checked_at)<Date.now()-3600000)||!domain.postal_address||!sender.metadata?.owner_name)throw Error('Verify domain health, reply routing, owner and postal address before enabling outreach')
    if(domain.status==='paused')throw Error('The outreach domain is paused. Resume it before enabling a sender')
    if(domain.status==='setup')await emailStorage(`crm_email_domains?domain=eq.${encodeURIComponent(sender.domain)}`,{status:'warming',updated_at:new Date().toISOString()},'PATCH')
  }
  const cap=Number(input.dailyCap??sender.daily_cap)
  if(!Number.isInteger(cap)||cap<0||cap>domain.daily_cap)throw Error('Sender limit must fit within the shared domain limit')
  await emailStorage(`email_sender_accounts?id=eq.${encodeURIComponent(sender.id)}`,{status:input.status,daily_cap:cap,updated_at:new Date().toISOString()},'PATCH')
  return getEmailInfrastructure()
}
export async function setOutreachPostalAddress(input:Row) {
  const address=String(input.address||'').trim()
  if(address.length<10||address.length>300||/[<>]/.test(address))throw Error('Enter the business mailing address')
  await emailStorage('crm_email_domains?domain=eq.saturnstarmovers.ca&purpose=eq.outreach',{postal_address:address,updated_at:new Date().toISOString()},'PATCH')
  return getEmailInfrastructure()
}

export async function setOutreachDomainState(input:Row) {
 if(!['paused','warming'].includes(input.status))throw Error('Choose pause or resume')
 const [domain]=await emailStorage<Row[]>('crm_email_domains?domain=eq.saturnstarmovers.ca&purpose=eq.outreach&select=*')
 if(!domain)throw Error('Outreach domain not found')
 if(input.status==='warming'&&(!domain.health?.ready||!Number.isFinite(Date.parse(domain.checked_at))||Date.parse(domain.checked_at)<Date.now()-3600000||!domain.postal_address))throw Error('Pass current readiness checks before resuming outreach')
 await emailStorage('crm_email_domains?domain=eq.saturnstarmovers.ca',{status:input.status,pause_reason:input.status==='paused'?'Paused by owner':null,updated_at:new Date().toISOString()},'PATCH')
 return getEmailInfrastructure()
}
