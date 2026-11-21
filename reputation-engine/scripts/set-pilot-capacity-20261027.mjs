import {api,fs} from './gta-email-recovery-runtime.mjs';
const {db}=await import('./reply-runtime-20261015.mjs');
await api('/api/marketing/email-infrastructure',{action:'refresh'});
const [domain]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'});
const [sender]=await db('email_sender_accounts',{provider:'eq.ses',from_email:'eq.john@saturnstarmovers.ca'});
const [health]=await db('crm_email_provider_health',{region:'eq.'+sender.region});
if(domain.purpose!=='outreach'||sender.reply_to_email!=='business@starmovers.ca')throw Error('Unexpected sender/domain identity');
if(!health||Date.now()-Date.parse(health.checked_at)>3600000||Number(health.snapshot.max24HourSend)!==50000)throw Error('Current 50000 SES quota not confirmed');
// Align both application budgets to the provider operational ceiling, reserving
// 1000 messages for existing customer quotes, receipts and alerts as the ledger does.
const cap=49000;
const [updated]=await db('crm_email_domains',{domain:'eq.'+domain.domain,daily_cap:'eq.'+domain.daily_cap},'PATCH',{daily_cap:cap,updated_at:new Date().toISOString()});
if(updated?.daily_cap!==cap)throw Error('Domain budget update not confirmed');
await db('email_sender_accounts',{id:'eq.'+sender.id,daily_cap:'eq.'+sender.daily_cap},'PATCH',{daily_cap:cap,updated_at:new Date().toISOString()});
const [verified]=await db('email_sender_accounts',{id:'eq.'+sender.id});
if(verified.daily_cap!==cap)throw Error('Sender budget update not confirmed');
const report={at:new Date().toISOString(),authorizedCampaignTarget:3000,previousSenderCap:sender.daily_cap,previousDomainCap:domain.daily_cap,senderCap:verified.daily_cap,domainCap:updated.daily_cap,SESQuota:health.snapshot.max24HourSend,operationalReserve:1000,intervalSeconds:updated.minimum_interval_seconds,replyTo:verified.reply_to_email,readiness:domain.health,readinessGuardsUnchanged:true};
fs.writeFileSync('artifacts/partnership-pilot-3000-20261027/capacity-update.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
