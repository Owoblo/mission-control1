// Defaults to read-only plan. --apply creates one archive and associates one configuration set.
// Never edits IAM, sends mail, alters other configuration-set options, or deletes archives.
import './gta-email-recovery-runtime.mjs';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {SESv2Client,GetConfigurationSetCommand,PutConfigurationSetArchivingOptionsCommand} from '@aws-sdk/client-sesv2';
process.loadEnvFile('.env.ses.local');
const req=createRequire('/private/tmp/ssm-mail-archive-tools/package.json');
const {MailManagerClient,ListArchivesCommand,GetArchiveCommand,CreateArchiveCommand}=req('@aws-sdk/client-mailmanager');
const {STSClient,GetCallerIdentityCommand}=req('@aws-sdk/client-sts');
const region='us-east-2',configurationSet='saturn-crm-deliverability',archiveName='ssm-partnership-sent-headers-3m';
const dir='artifacts/partnership-pilot-3000-20261027/';
const apply=process.argv.includes('--apply');
const ses=new SESv2Client({region,maxAttempts:1}),mail=new MailManagerClient({region,maxAttempts:1});
const caller=await new STSClient({region,maxAttempts:1}).send(new GetCallerIdentityCommand({}));
if(caller.Account!=='322694470585')throw Error('Unexpected AWS account');
const before=await ses.send(new GetConfigurationSetCommand({ConfigurationSetName:configurationSet}));
const archives=[];let next;
do{const page=await mail.send(new ListArchivesCommand({PageSize:50,...(next?{NextToken:next}:{})}));archives.push(...page.Archives);next=page.NextToken;}while(next);
const named=archives.filter(a=>a.ArchiveName===archiveName);
if(named.length>1)throw Error('Ambiguous archive name');
let archive=named.length?await mail.send(new GetArchiveCommand({ArchiveId:named[0].ArchiveId})):null;
if(archive&&(archive.Retention?.RetentionPeriod!=='THREE_MONTHS'||archive.ArchiveState!=='ACTIVE'))throw Error('Existing named archive has unexpected retention or state');
const existing=before.ArchivingOptions?.ArchiveArn;
if(existing&&existing!==archive?.ArchiveArn)throw Error('Configuration set already points at another archive; no overwrite');
const report={at:new Date().toISOString(),mode:apply?'apply':'plan',region,configurationSet,archiveName,retention:'THREE_MONTHS',account:caller.Account,priorArchiveArn:existing||null,archiveId:archive?.ArchiveId||null,archiveArn:archive?.ArchiveArn||null,actions:[...(archive?[]:['CreateArchive (AWS-owned encryption default; THREE_MONTHS)']),...(existing?[]:['PutConfigurationSetArchivingOptions (saturn-crm-deliverability only)'])],iamChanges:false,messagesSent:0};
if(!apply){fs.writeFileSync(dir+'sent-archive-plan.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));process.exit(0);}
// Journal each mutation boundary, and use a stable create token for interruption recovery.
const save=()=>fs.writeFileSync(dir+'sent-archive-setup.json',JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));
save();
try {
if(!archive){
 const created=await mail.send(new CreateArchiveCommand({ArchiveName:archiveName,ClientToken:'ssm-partnership-sent-headers-3m-20261028',Retention:{RetentionPeriod:'THREE_MONTHS'},Tags:[{Key:'purpose',Value:'partnership-thread-evidence'}]}));
 report.archiveId=created.ArchiveId;save();
 archive=await mail.send(new GetArchiveCommand({ArchiveId:created.ArchiveId}));
}
if(archive.ArchiveState!=='ACTIVE'||archive.Retention?.RetentionPeriod!=='THREE_MONTHS')throw Error('Archive is not ready with expected retention');
if(!archive.ArchiveArn?.startsWith('arn:aws:ses:us-east-2:322694470585:mailmanager-archive/'))throw Error('Unexpected archive ARN');
report.archiveId=archive.ArchiveId;report.archiveArn=archive.ArchiveArn;save();
if(!existing)await ses.send(new PutConfigurationSetArchivingOptionsCommand({ConfigurationSetName:configurationSet,ArchiveArn:archive.ArchiveArn}));
const after=await ses.send(new GetConfigurationSetCommand({ConfigurationSetName:configurationSet}));
if(after.ArchivingOptions?.ArchiveArn!==archive.ArchiveArn)throw Error('Archive association not verified');
report.state='configured_future_messages_only';save();console.log(JSON.stringify(report,null,2));
} catch(error) {
 report.state=/iam:CreateServiceLinkedRole/.test(error.message)?'blocked_service_linked_role':'setup_failed_requires_review';
 report.error={name:error.name,message:error.message};
 if(report.state==='blocked_service_linked_role')report.adminResolution={command:'aws iam create-service-linked-role --aws-service-name ses.amazonaws.com',serviceLinkedRole:'AWSServiceRoleForAmazonSES',scope:'An AWS administrator creates the service-linked role once; do not grant the application user general IAM administration.',resume:'Re-run this exact --apply script after the administrator confirms the role exists.'};
 save();throw error;
}
