// Additive setup: SES identity + three DKIM CNAMEs only. Never modifies MX/SPF or sends.
import './gta-email-recovery-runtime.mjs';
import fs from 'node:fs';
import os from 'node:os';
import {createRequire} from 'node:module';
import {SESv2Client,GetEmailIdentityCommand,CreateEmailIdentityCommand} from '@aws-sdk/client-sesv2';
process.loadEnvFile('.env.ses.local');
const {STSClient,GetCallerIdentityCommand}=createRequire('/private/tmp/ssm-mail-archive-tools/package.json')('@aws-sdk/client-sts');
const domain='dexamovers.ca',region='us-east-2',team='team_EAg0Uem06yxKWgslp95UsC6Z';
const apply=process.argv.includes('--apply'),prepare=process.argv.includes('--prepare-dns');
const token=JSON.parse(fs.readFileSync(os.homedir()+'/Library/Application Support/com.vercel.cli/auth.json','utf8')).token;
if(!token)throw Error('Vercel session unavailable');
async function vercel(path,method='GET',body){
 const r=await fetch('https://api.vercel.com'+path+(path.includes('?')?'&':'?')+'teamId='+team,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw Error('Vercel '+r.status+': '+(data.error?.code||'request_failed'));return data;
}
if(!prepare){const zone=await vercel('/v5/domains/'+domain);if(zone.domain?.name!==domain)throw Error('Unexpected domain scope');}
const records=[];let until;
if(!prepare)do{const page=await vercel('/v4/domains/'+domain+'/records?limit=100'+(until?'&until='+until:''));records.push(...(page.records||[]));until=page.pagination?.next;}while(until);
const caller=await new STSClient({region,maxAttempts:1}).send(new GetCallerIdentityCommand({}));
if(caller.Account!=='322694470585')throw Error('Wrong AWS account');
const ses=new SESv2Client({region,maxAttempts:1});
let identity;
try{identity=await ses.send(new GetEmailIdentityCommand({EmailIdentity:domain}));}catch(e){if(e.name!=='NotFoundException')throw e;}
const path='artifacts/partnership-pilot-3000-20261027/dexa-ses-identity-setup.json';
const report={at:new Date().toISOString(),mode:apply?'apply':prepare?'prepare_dns':'plan',domain,region,identityExisted:!!identity,dnsAdded:[],dnsExisting:[],messagesSent:0,rootMailRoutingChanged:false};
const save=()=>fs.writeFileSync(path,JSON.stringify(report,null,2));save();
if(!identity&&(apply||prepare)){await ses.send(new CreateEmailIdentityCommand({EmailIdentity:domain,ConfigurationSetName:'saturn-crm-deliverability',DkimSigningAttributes:{NextSigningKeyLength:'RSA_2048_BIT'}}));identity=await ses.send(new GetEmailIdentityCommand({EmailIdentity:domain}));}
const desired=(identity?.DkimAttributes?.Tokens||[]).map(t=>({name:t+'._domainkey',type:'CNAME',value:t+'.dkim.amazonses.com',ttl:300}));
report.dnsRequired=desired;save();
for(const record of desired){
 const sameName=records.filter(r=>[record.name,record.name+'.'+domain].includes(r.name));
 const equivalent=sameName.find(r=>r.type===record.type&&r.value?.replace(/\.$/,'')===record.value);
 if(equivalent){report.dnsExisting.push(record.name);continue;}
 if(sameName.length)throw Error('Conflicting DKIM DNS record; no overwrite');
 if(apply){await vercel('/v2/domains/'+domain+'/records','POST',record);report.dnsAdded.push(record.name);save();}
}
if(identity){const after=await ses.send(new GetEmailIdentityCommand({EmailIdentity:domain}));report.verificationStatus=after.VerificationStatus;report.dkimStatus=after.DkimAttributes?.Status;report.verifiedForSending=after.VerifiedForSendingStatus;}
report.state=apply?'dns_published_awaiting_ses_verification':prepare?'identity_created_dns_access_required':'plan';save();console.log(JSON.stringify(report,null,2));
