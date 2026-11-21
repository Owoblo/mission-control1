import fs from 'node:fs';
import {SESv2Client,GetEmailIdentityCommand,GetAccountCommand} from '@aws-sdk/client-sesv2';
process.loadEnvFile('.env.ses.local');
const region=process.env.AWS_REGION||'us-east-2',client=new SESv2Client({region,maxAttempts:1});
const report={at:new Date().toISOString(),region,readOnly:true,emailsSent:0,identities:[]};
for(const identity of ['dexamovers.ca','hello@dexamovers.ca']){
 try{const x=await client.send(new GetEmailIdentityCommand({EmailIdentity:identity}));report.identities.push({identity,verified:x.VerifiedForSendingStatus,dkim:x.DkimAttributes?.Status,mailFrom:x.MailFromAttributes?.MailFromDomainStatus,mailFromDomain:x.MailFromAttributes?.MailFromDomain,identityType:x.IdentityType});}
 catch(e){report.identities.push({identity,error:e.name});}
}
const account=await client.send(new GetAccountCommand({}));report.account={production:account.ProductionAccessEnabled,sendingEnabled:account.SendingEnabled,enforcement:account.EnforcementStatus,quota:account.SendQuota};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/dexa-ses-identity-readiness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
