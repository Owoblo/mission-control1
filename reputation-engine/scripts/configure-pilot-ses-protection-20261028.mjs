import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {SESv2Client,GetAccountCommand,GetConfigurationSetCommand,PutConfigurationSetSuppressionOptionsCommand,PutConfigurationSetVdmOptionsCommand} from '@aws-sdk/client-sesv2';
process.loadEnvFile('.env.ses.local');
const {STSClient,GetCallerIdentityCommand}=createRequire('/private/tmp/ssm-mail-archive-tools/package.json')('@aws-sdk/client-sts');
const region='us-east-2',name='saturn-crm-deliverability';
const client=new SESv2Client({region,maxAttempts:1});
const identity=await new STSClient({region,maxAttempts:1}).send(new GetCallerIdentityCommand({}));
if(identity.Account!=='322694470585')throw Error('Unexpected account');
const account=await client.send(new GetAccountCommand({}));
if(account.EnforcementStatus!=='HEALTHY'||account.VdmAttributes?.VdmEnabled!=='ENABLED')throw Error('Account health or VDM prerequisite absent');
const before=await client.send(new GetConfigurationSetCommand({ConfigurationSetName:name}));
delete before.$metadata;
const suppression={ConfigurationSetName:name,SuppressedReasons:['BOUNCE','COMPLAINT'],...(before.SuppressionOptions?.SuppressionScope?{SuppressionScope:before.SuppressionOptions.SuppressionScope}:{}),ValidationOptions:{ConditionThreshold:{ConditionThresholdEnabled:'ENABLED',OverallConfidenceThreshold:{ConfidenceVerdictThreshold:'HIGH'}}}};
const engagement=before.VdmOptions?.DashboardOptions?.EngagementMetrics||account.VdmAttributes?.DashboardAttributes?.EngagementMetrics||'DISABLED';
const vdm={ConfigurationSetName:name,VdmOptions:{DashboardOptions:{EngagementMetrics:engagement},GuardianOptions:{OptimizedSharedDelivery:'ENABLED'}}};
const path='artifacts/partnership-pilot-3000-20261027/ses-protection-change-20261028.json';
const report={at:new Date().toISOString(),mode:process.argv.includes('--apply')?'apply':'plan',before,planned:{suppression,vdm},state:'planned',messagesSent:0};
const save=()=>fs.writeFileSync(path,JSON.stringify(report,null,2));save();
if(report.mode==='apply'){
 try{
  await client.send(new PutConfigurationSetSuppressionOptionsCommand(suppression));report.state='validation_configured';save();
  await client.send(new PutConfigurationSetVdmOptionsCommand(vdm));report.state='vdm_configured';save();
  const after=await client.send(new GetConfigurationSetCommand({ConfigurationSetName:name}));delete after.$metadata;report.after=after;
  if(after.SuppressionOptions?.ValidationOptions?.ConditionThreshold?.OverallConfidenceThreshold?.ConfidenceVerdictThreshold!=='HIGH'||after.VdmOptions?.GuardianOptions?.OptimizedSharedDelivery!=='ENABLED'||after.VdmOptions?.DashboardOptions?.EngagementMetrics!==engagement||after.ArchivingOptions?.ArchiveArn!==before.ArchivingOptions?.ArchiveArn)throw Error('Post-change verification failed');
  report.state='verified';save();
 }catch(e){report.error={name:e.name,message:e.message};save();throw e;}
}
console.log(JSON.stringify(report,null,2));
