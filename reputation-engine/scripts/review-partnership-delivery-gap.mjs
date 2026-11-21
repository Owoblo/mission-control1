// Read-only provider diagnostics. Never retries a customer message.
import fs from 'node:fs/promises';
import {SESv2Client,GetAccountCommand,GetConfigurationSetEventDestinationsCommand,GetEmailIdentityCommand,GetMessageInsightsCommand} from '@aws-sdk/client-sesv2';
import {SNSClient,ListSubscriptionsByTopicCommand} from '@aws-sdk/client-sns';
const root='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15/send-release';
const audit=JSON.parse(await fs.readFile(root+'/delivery-results.json','utf8'));
const pending=audit.results.filter(r=>!r.delivered&&!r.bounced&&!r.complained);
const client=new SESv2Client({region:'us-east-2',maxAttempts:2});
async function inspect(command){try{const r=await client.send(command);delete r.$metadata;return r;}catch(e){return {error:e.name,message:e.message};}}
const account=await inspect(new GetAccountCommand({}));
const destinations=await inspect(new GetConfigurationSetEventDestinationsCommand({ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET}));
const identity=await inspect(new GetEmailIdentityCommand({EmailIdentity:'saturnstarmovers.ca'}));
let subscriptions;try {const sns=new SNSClient({region:'us-east-2'});subscriptions=await sns.send(new ListSubscriptionsByTopicCommand({TopicArn:'arn:aws:sns:us-east-2:322694470585:saturn-partnership-ses-events'}));delete subscriptions.$metadata;}catch(e){subscriptions={error:e.name,message:e.message};}
const messages=[];
for(const row of pending.slice(0,3))messages.push({messageId:row.messageId,accepted_at:row.accepted_at,result:await inspect(new GetMessageInsightsCommand({MessageId:row.messageId}))});
const report={at:new Date().toISOString(),pending:pending.length,account,destinations,identity,subscriptions,messages};
await fs.writeFile(root+'/delivery-gap-diagnostics.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({pending:pending.length,account:{sendingEnabled:account.SendingEnabled,enforcement:account.EnforcementStatus,vdm:account.VdmAttributes},subscriptions:subscriptions.error?subscriptions:subscriptions.Subscriptions?.map(s=>({protocol:s.Protocol,endpoint:s.Endpoint?.split('?')[0],confirmed:s.SubscriptionArn!=='PendingConfirmation'})),identity:{defaultConfigurationSet:identity.ConfigurationSetName},messages},null,2));
