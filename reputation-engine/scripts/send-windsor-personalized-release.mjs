import {reserveAction} from '../lib/partnership-core/reserve.mjs';
if(!process.env.AWS_SES_CONFIGURATION_SET?.trim())throw Error('Missing SES event configuration set; sending without delivery tracking is blocked');
// Owner explicitly requested sending; restricted to the ten researched initial recipients.
// Durable CRM reservation prevents automatic retries after an ambiguous provider response.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SESv2Client,GetAccountCommand,ListSuppressedDestinationsCommand,SendEmailCommand} from '@aws-sdk/client-sesv2';
const root='partnership-system/markets/ca/on/windsor-essex/runs/2026-09-15';
const dir=`${root}/send-release`;
const release=JSON.parse(await fs.readFile(`${root}/priority-enrichment/personalized-release.json`));
const configs=JSON.parse(await fs.readFile(`${root}/priority-enrichment/accounts-config.json`));
const execute=process.argv.includes('--send');
const senderAddress='3608 Seminole Street, Unit 3\nWindsor, ON N8Y 1Y4, Canada';
const client=new SESv2Client({region:'us-east-2',maxAttempts:1});
const uid=s=>{const h=createHash('sha256').update('windsor-personalized-send-v1:'+s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`};
async function db(t,q={},method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${new URLSearchParams(q)}`,{method,headers:{apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(t+' '+r.status+' '+await r.text());return r.status===204?[]:r.json()}
const health=await client.send(new GetAccountCommand({}));if(!health.SendingEnabled||!health.ProductionAccessEnabled||health.EnforcementStatus!=='HEALTHY')throw Error('Sender not healthy');
await new Promise(r=>setTimeout(r,1200));
const suppressed=new Set();let suppressionToken;
do{const page=await client.send(new ListSuppressedDestinationsCommand({PageSize:1000,NextToken:suppressionToken}));for(const row of page.SuppressedDestinationSummaries||[])suppressed.add(row.EmailAddress.toLowerCase());suppressionToken=page.NextToken;if(suppressionToken)await new Promise(r=>setTimeout(r,1200));}while(suppressionToken);
const tokenResponse=await fetch(process.env.ZOHO_PARTNERSHIP_ACCOUNTS_URL+'/oauth/v2/token',{method:'POST',body:new URLSearchParams({grant_type:'refresh_token',client_id:process.env.ZOHO_PARTNERSHIP_CLIENT_ID,client_secret:process.env.ZOHO_PARTNERSHIP_CLIENT_SECRET,refresh_token:process.env.ZOHO_PARTNERSHIP_REFRESH_TOKEN})});const token=await tokenResponse.json();if(!token.access_token)throw Error('Mailbox auth failed');
const records=[];
for(const d of release.initial){
 const id=uid(d.id);const existing=await db('market_touches',{select:'id,metadata',id:'eq.'+id});
 if(existing.length){records.push({to:d.to,status:existing[0].metadata?.delivery_state||'reserved',id});continue;}
 const v=d.validation;if(!v||Date.now()-Date.parse(v.checked_at)>86400000||v.overall==='LOW'||v.mailbox==='LOW'||v.status==='hold_risk')throw Error('Validation not acceptable '+d.to);
 const contacts=await db('market_contacts',{select:'id,email,stage,decision,do_not_contact,email_status,email_unsubscribed_at,cross_channel_suppressed_at,last_touch_at,last_inbound_at',partner_company_id:'eq.'+d.company_id});
 if(!contacts.some(c=>c.id===d.contact_id&&c.email?.toLowerCase()===d.to.toLowerCase()))throw Error('Contact changed '+d.to);
 if(contacts.some(c=>c.do_not_contact||c.email_unsubscribed_at||c.cross_channel_suppressed_at||['bounced','complained','unsubscribed'].includes(c.email_status)||['opted_out','rejected'].includes(c.decision)||['dnc','closed_lost'].includes(c.stage))){records.push({to:d.to,status:'held_suppression'});continue;}
 if(contacts.some(c=>c.last_inbound_at||c.last_touch_at)){records.push({to:d.to,status:'held_existing_activity'});continue;}
 if(suppressed.has(d.to.toLowerCase())){records.push({to:d.to,status:'held_ses_suppression'});continue;}
 let found=0;
 const domains=new Set([...configs.find(a=>a.key===d.account_key).domains,d.to.split('@')[1]]);
 for(const domain of domains)for(const field of ['sender','to','cc']){
  const q=new URLSearchParams({searchKey:field+':'+domain,start:'1',limit:'200',includeto:'true',receivedTime:String(Date.now())});
  const r=await fetch(`${process.env.ZOHO_PARTNERSHIP_MAIL_URL}/api/accounts/${process.env.ZOHO_PARTNERSHIP_ACCOUNT_ID}/messages/search?${q}`,{headers:{Authorization:'Zoho-oauthtoken '+token.access_token},signal:AbortSignal.timeout(30000)});const data=await r.json();if(!r.ok||data.status?.code!==200||!Array.isArray(data.data))throw Error('Mailbox freshness failed '+d.to);found+=data.data.length;
 }
 if(found){records.push({to:d.to,status:'held_mail_history_review',matchingSearchRows:found});continue;}
 const body=d.body.replace('https://starmovers.ca\n\n','https://starmovers.ca\n'+senderAddress+'\n\n');
 if(!body.includes(senderAddress)||!body.includes('prefer no further emails'))throw Error('Missing footer');
 const entry={...d,body,mailing_address:senderAddress,mailing_address_source:'Owner supplied street; current starmovers.ca/contact confirms Unit 3 and N8Y 1Y4',status:'preflight_passed',id,checked_at:new Date().toISOString(),sending_basis:{type:'reviewed_official_publication_or_supplier_invitation',source:d.context_source,role_relevance:d.role,reviewed_at:new Date().toISOString(),no_solicitation_notice_found:false}};
 records.push(entry);await fs.writeFile(`${dir}/personalized-send-preflight.json`,JSON.stringify(records,null,2));
 if(!execute)continue;
 await reserveAction({url:process.env.SUPABASE_URL,headers:{apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY},contactId:d.contact_id,channel:'email',key:'personalized:'+id,content:body,sender:'john@saturnstarmovers.ca'});
 const metadata={source:'owner_authorized_windsor_personalized_v1',delivery_state:'reserved_not_confirmed',company_id:d.company_id,to:d.to,subject:d.subject,variant:d.variant,provider:'ses',sending_basis:entry.sending_basis,reply_to:'business@starmovers.ca'};
 await db('market_touches',{},'POST',{id,contact_id:d.contact_id,channel:'email',direction:'outbound',notes:body,created_by:'John — authorized Windsor partnership outreach',metadata});
 const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 const html='<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#17212b;max-width:620px">'+body.split('\n\n').map(p=>'<p>'+esc(p).replaceAll('\n','<br>')+'</p>').join('')+'<div style="border-top:2px solid #c99700;padding-top:8px;color:#071421">Saturn Star Movers</div></div>';
 const response=await client.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[d.to]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:d.contact_id},{Name:'campaign',Value:'windsor-personalized-v1'},{Name:'variant',Value:d.variant}],Content:{Simple:{Subject:{Data:d.subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'},Html:{Data:html,Charset:'UTF-8'}}}}}));
 if(!response.MessageId)throw Error('Ambiguous provider response; inspect reservation');
 const acceptedAt=new Date().toISOString();const receipt={id,contact_id:d.contact_id,company_id:d.company_id,to:d.to,variant:d.variant,messageId:response.MessageId,status:'accepted',accepted_at:acceptedAt};
 await fs.appendFile(`${dir}/personalized-send-receipts.jsonl`,JSON.stringify(receipt)+'\n');
 await db('market_touches',{id:'eq.'+id},'PATCH',{metadata:{...metadata,delivery_state:'accepted',provider_message_id:response.MessageId},next_step:'Review response and provider events; account-coordinated follow-up only.',next_follow_up_on:'2026-09-22'});
 await db('market_contacts',{id:'eq.'+d.contact_id},'PATCH',{last_touch_at:acceptedAt,email_last_sent_at:acceptedAt,email_provider:'ses',email_provider_message_id:response.MessageId,next_follow_up:'2026-09-22'});
 const [task]=await db('crm_tasks',{source_key:'eq.windsor-priority-20260915:'+d.account_key});
 if(task)await db('crm_tasks',{id:'eq.'+task.id},'PATCH',{title:`${d.account_name}: review partnership reply`,due_at:'2026-09-22T14:00:00Z',description:task.description+'\n\nSENT — provider accepted\n'+JSON.stringify({receipt,body}),updated_at:acceptedAt});
 console.log(JSON.stringify(receipt));
}
await fs.writeFile(`${dir}/personalized-send-preflight.json`,JSON.stringify(records,null,2));console.log(JSON.stringify({execute,processed:records.length,held:records.filter(r=>r.status.startsWith('held')).map(r=>({to:r.to,status:r.status}))}));
