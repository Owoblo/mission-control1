// Read-only delivery configuration and CRM event audit. Never sends.
import fs from 'node:fs/promises';
import {SESv2Client,GetAccountCommand,GetConfigurationSetEventDestinationsCommand,GetEmailIdentityCommand} from '@aws-sdk/client-sesv2';
const dir='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/priority-enrichment';
const client=new SESv2Client({region:'us-east-2',maxAttempts:2});
const account=await client.send(new GetAccountCommand({}));
const destinations=await client.send(new GetConfigurationSetEventDestinationsCommand({ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET}));
const identity=await client.send(new GetEmailIdentityCommand({EmailIdentity:'saturnstarmovers.ca'}));
const receipts=(await fs.readFile('deliverables/commercial-relationships-2026-09-15/send-receipts.jsonl','utf8')).trim().split('\n').map(JSON.parse);
async function get(table,q){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(q)}`,{headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`}});if(!r.ok)throw Error(table+' '+r.status);return r.json()}
const events=await get('email_provider_events',{select:'event_type,provider_message_id,recipient_email,occurred_at',provider_message_id:'in.('+receipts.map(x=>x.messageId).join(',')+')'});
const report={checked_at:new Date().toISOString(),ses:{sending:account.SendingEnabled,production:account.ProductionAccessEnabled,enforcement:account.EnforcementStatus,quota:account.SendQuota},identity:{verifiedForSending:identity.VerifiedForSendingStatus,dkimStatus:identity.DkimAttributes?.Status},eventDestinations:destinations.EventDestinations?.map(x=>({name:x.Name,enabled:x.Enabled,eventTypes:x.MatchingEventTypes,sns:!!x.SnsDestination,eventBridge:!!x.EventBridgeDestination})),previousBatchEvents:events,mailboxVerifierConfiguredInLoadedEnvironment:!!process.env.ZEROBOUNCE_API_KEY,messagesSent:0};
await fs.writeFile(`${dir}/sending-readiness.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
