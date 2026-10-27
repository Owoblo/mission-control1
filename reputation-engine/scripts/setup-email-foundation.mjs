// Configure delivery evidence for existing Saturn identities. No messages or mailboxes are created.
import fs from 'node:fs'
import {SESv2Client,GetAccountCommand,GetEmailIdentityCommand,GetConfigurationSetCommand,CreateConfigurationSetCommand,GetConfigurationSetEventDestinationsCommand,CreateConfigurationSetEventDestinationCommand,UpdateConfigurationSetEventDestinationCommand,PutEmailIdentityConfigurationSetAttributesCommand,PutAccountVdmAttributesCommand} from '@aws-sdk/client-sesv2'
import {SNSClient,ListSubscriptionsByTopicCommand} from '@aws-sdk/client-sns'
const clean=x=>String(x||'').replace(/\\r|\\n|\r|\n/g,'').trim()
const region=clean(process.env.AWS_REGION||process.env.AWS_DEFAULT_REGION)||'us-east-2'
const credentials={accessKeyId:clean(process.env.AWS_ACCESS_KEY_ID),secretAccessKey:clean(process.env.AWS_SECRET_ACCESS_KEY)}
if(!credentials.accessKeyId||!credentials.secretAccessKey)throw Error('Load the configured SES credentials before running this tool')
const ses=new SESv2Client({region,credentials,maxAttempts:1}),sns=new SNSClient({region,credentials,maxAttempts:1})
const configuration=clean(process.env.AWS_SES_DELIVERABILITY_CONFIGURATION_SET)||'saturn-crm-deliverability'
const topic=clean(process.env.AWS_SES_SNS_TOPIC_ARN)||'arn:aws:sns:us-east-2:322694470585:saturn-partnership-ses-events'
const endpoint='https://go.quote2move.com/api/marketing/email-events/ses'
const send=(client,command)=>client.send(command,{abortSignal:AbortSignal.timeout(20000)})
const account=await send(ses,new GetAccountCommand({}))
if(!account.SendingEnabled||!account.ProductionAccessEnabled||account.EnforcementStatus!=='HEALTHY')throw Error('SES is not ready for infrastructure setup')
if(!['ESSENTIALS','PRO','ENTERPRISE'].includes(account.PricingAttributes?.CurrentPlan))throw Error('Verify the current plan includes message-history features before enabling VDM')
const subscriptions=await send(sns,new ListSubscriptionsByTopicCommand({TopicArn:topic}))
if(subscriptions.NextToken)throw Error('Subscription pagination needs review')
console.log(JSON.stringify({topic,subscriptions:subscriptions.Subscriptions?.map(s=>({protocol:s.Protocol,endpoint:s.Endpoint?.split('?')[0],confirmed:s.SubscriptionArn!=='PendingConfirmation'}))},null,2))
if(!subscriptions.Subscriptions?.some(s=>s.Protocol==='https'&&s.Endpoint?.split('?')[0]===endpoint&&s.SubscriptionArn&&s.SubscriptionArn!=='PendingConfirmation'))throw Error('The signed CRM event subscription is not confirmed')
const identities=[]
for(const name of ['starmovers.ca','saturnstarmovers.ca','john@saturnstarmovers.ca']){
 const item=await send(ses,new GetEmailIdentityCommand({EmailIdentity:name}));if(!item.VerifiedForSendingStatus)throw Error('Sending identity is not verified: '+name)
 identities.push({name,configuration:item.ConfigurationSetName||null})
}
const before={plan:account.PricingAttributes?.CurrentPlan,vdm:account.VdmAttributes||null,identities}
const plan={region,configuration,topic,endpoint,identities:identities.map(x=>x.name),messageHistory:'enabled',engagementTracking:'disabled',messagesSent:0}
console.log(JSON.stringify({apply:process.argv.includes('--apply'),plan,before},null,2))
if(!process.argv.includes('--apply'))process.exit(0)
let exists=true
try{await send(ses,new GetConfigurationSetCommand({ConfigurationSetName:configuration}))}catch(e){if(e.name!=='NotFoundException')throw e;exists=false}
if(!exists)await send(ses,new CreateConfigurationSetCommand({ConfigurationSetName:configuration}))
const destination={Enabled:true,MatchingEventTypes:['SEND','DELIVERY','DELIVERY_DELAY','BOUNCE','COMPLAINT','REJECT','RENDERING_FAILURE','SUBSCRIPTION'],SnsDestination:{TopicArn:topic}}
const current=await send(ses,new GetConfigurationSetEventDestinationsCommand({ConfigurationSetName:configuration}))
const name='saturn-crm-delivery-sns'
await send(ses,current.EventDestinations?.some(x=>x.Name===name)?new UpdateConfigurationSetEventDestinationCommand({ConfigurationSetName:configuration,EventDestinationName:name,EventDestination:destination}):new CreateConfigurationSetEventDestinationCommand({ConfigurationSetName:configuration,EventDestinationName:name,EventDestination:destination}))
for(const identity of identities)if(identity.configuration!==configuration)await send(ses,new PutEmailIdentityConfigurationSetAttributesCommand({EmailIdentity:identity.name,ConfigurationSetName:configuration}))
await send(ses,new PutAccountVdmAttributesCommand({VdmAttributes:{VdmEnabled:'ENABLED',DashboardAttributes:{EngagementMetrics:'DISABLED'},GuardianAttributes:{OptimizedSharedDelivery:'DISABLED'}}}))
const final=await send(ses,new GetAccountCommand({})),events=await send(ses,new GetConfigurationSetEventDestinationsCommand({ConfigurationSetName:configuration}))
const result={at:new Date().toISOString(),region,plan:final.PricingAttributes?.CurrentPlan,vdm:final.VdmAttributes,eventDestinations:events.EventDestinations,before,messagesSent:0}
const output=process.env.EMAIL_FOUNDATION_AUDIT_FILE||process.argv.find(a=>a.startsWith('--audit-file='))?.slice(13)
if(output)fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600})
console.log(JSON.stringify({configured:true,plan:final.PricingAttributes?.CurrentPlan,vdm:final.VdmAttributes,configuration,messagesSent:0},null,2))
