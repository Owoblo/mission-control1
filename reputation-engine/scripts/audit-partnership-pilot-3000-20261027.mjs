// Read-only preflight. No send/import/deploy APIs are called.
import {fs,db} from './gta-email-recovery-runtime.mjs';
import {Resolver} from 'node:dns/promises';
import {SESv2Client,GetEmailIdentityCommand} from '@aws-sdk/client-sesv2';
const dir='artifacts/partnership-pilot-3000-20261027';
const candidates=JSON.parse(fs.readFileSync(dir+'/candidates.json'));
const emails=new Set(candidates.map(r=>r.email.toLowerCase()));
const matches=[];let complete=false;
for(let offset=0;offset<100000;offset+=1000){
 const rows=await db('market_contacts',{select:'id,email,city,stage,do_not_contact,cross_channel_suppressed_at,email_unsubscribed_at,email_status,last_inbound_at,email_last_sent_at,email_last_replied_at',order:'id',limit:'1000',offset:String(offset)});
 for(const r of rows)if(emails.has(String(r.email||'').toLowerCase()))matches.push(r);
 if(rows.length<1000){complete=true;break;}
}
fs.writeFileSync(dir+'/crm-email-matches.json',JSON.stringify({at:new Date().toISOString(),complete,scope:'Exact email matches only; company/phone/shared context and mailbox history still pending',matches},null,2));
console.log(JSON.stringify({crmScanComplete:complete,matchingContactRows:matches.length}));
const domains=[...new Set(candidates.map(r=>r.email.split('@').at(-1)))];let index=0;const dnsResults=[];
await Promise.all(Array.from({length:12},async()=>{
 const resolver=new Resolver({timeout:3000,tries:1});
 while(index<domains.length){const domain=domains[index++];let result;
 try{const records=await resolver.resolveMx(domain);result={domain,status:records.some(r=>r.exchange&&r.exchange!=='.')?'mx_present':'no_usable_mx',records};}
 catch(e){result={domain,status:'dns_unresolved',code:e.code};}
 dnsResults.push({...result,checked_at:new Date().toISOString()});
 if(dnsResults.length%250===0){fs.writeFileSync(dir+'/dns-checks.json',JSON.stringify(dnsResults));console.log(JSON.stringify({dnsChecked:dnsResults.length,total:domains.length}));}
 }
}));
fs.writeFileSync(dir+'/dns-checks.json',JSON.stringify(dnsResults,null,2));
process.loadEnvFile('.env.ses.local');
const ses=new SESv2Client({region:process.env.AWS_REGION||'us-east-2',maxAttempts:1});
const identities=[];
for(const identity of ['saturnstarmovers.ca','john@saturnstarmovers.ca']){
 try{const r=await ses.send(new GetEmailIdentityCommand({EmailIdentity:identity}));identities.push({identity,verifiedForSending:r.VerifiedForSendingStatus,verificationStatus:r.VerificationStatus,verificationInfo:r.VerificationInfo,dkim:r.DkimAttributes?.Status,config:r.ConfigurationSetName});}
 catch(e){identities.push({identity,error:e.name});}
}
fs.writeFileSync(dir+'/identity-review.json',JSON.stringify(identities,null,2));
const summary={at:new Date().toISOString(),selected:candidates.length,crmScanComplete:complete,crmMatchingRows:matches.length,dnsDomains:domains.length,mxPresent:dnsResults.filter(r=>r.status==='mx_present').length,dnsReview:dnsResults.filter(r=>r.status!=='mx_present').length,campaignReady:0,sent:0,remaining:['Official business/contact binding and role relevance','Mailbox validation, publication restrictions and outreach eligibility','Company/phone-level CRM suppression and existing-conversation review','Recipient-specific sender/phone and copy review','Reply roundtrip and deployed opt-out handling','Provider unsubscribe requirement resolution'],note:'MX presence does not verify a mailbox or establish permission. Existing CRM matches require contextual review, not automatic exclusion or approval.'};
fs.writeFileSync(dir+'/preflight-summary.json',JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
