import { randomUUID } from 'node:crypto';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const contactId='14e09b36-63cd-4024-8bc3-6834598aaaf0';
const email='klivingston@mortgagealliance.com';
const clean=v=>String(v||'').trim();
const supabase=clean(process.env.SUPABASE_URL), key=clean(process.env.SUPABASE_KEY);
const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(table,query,method='GET',body){const r=await fetch(`${supabase}/rest/v1/${table}?${new URLSearchParams(query)}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();if(!r.ok)throw Error(`${table} ${r.status} ${t.slice(0,300)}`);return t?JSON.parse(t):[]}
const [contact]=await db('market_contacts',{id:`eq.${contactId}`,select:'id,email,name,city,do_not_contact,email_status,email_unsubscribed_at,cross_channel_suppressed_at'});
if(!contact||contact.email!==email)throw Error('Recipient contact/email mismatch');
if(contact.do_not_contact||contact.email_unsubscribed_at||contact.cross_channel_suppressed_at||['bounced','complained','unsubscribed'].includes(contact.email_status))throw Error('Recipient suppressed');
const prior=await db('market_touches',{contact_id:`eq.${contactId}`,channel:'eq.email',direction:'eq.outbound',select:'id,notes,metadata,created_at',order:'created_at.desc',limit:'5'});
if(prior.some(x=>x.notes?.includes('Saturn Star Movers contact details for Cambridge clients'))){console.log(JSON.stringify({alreadySent:true,prior:prior[0]}));process.exit(0)}
const subject='Saturn Star Movers contact details for Cambridge clients';
const body=`Hi Krystal,\n\nThanks for sharing your email. I’m sending over our Saturn Star Movers contact details for Cambridge and surrounding areas so you can keep them handy for clients who need moving help after a purchase, closing, or relocation.\n\nWebsite: https://starmovers.ca\nEmail: info@starmovers.ca\nThis SMS number also works for clients.\n\nIf a client ever needs a quote, they can reach us directly and mention that you referred them.\n\nJohn\nSaturn Star Movers`;
const sender='John | Saturn Star Movers <john@saturnstarmovers.ca>';
const ses=new SESv2Client({region:clean(process.env.AWS_REGION)||clean(process.env.AWS_DEFAULT_REGION)||'us-east-2',maxAttempts:1});
const result=await ses.send(new SendEmailCommand({FromEmailAddress:sender,ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[email]},ConfigurationSetName:clean(process.env.AWS_SES_CONFIGURATION_SET)||undefined,EmailTags:[{Name:'contact_id',Value:contactId}],Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'}}}}}));
const messageId=result.MessageId;
if(!messageId)throw Error('SES did not return MessageId');
const touchId=randomUUID(); const at=new Date().toISOString();
await db('market_touches',{},'POST',{id:touchId,contact_id:contactId,channel:'email',direction:'outbound',notes:`Subject: ${subject}\n\n${body}`,created_by:'John',created_at:at,metadata:{source:'manual_partnership_email_direct_ses',from:sender,to:email,subject,reply_to:'business@starmovers.ca',delivery_state:'accepted',provider:'ses',provider_message_id:messageId}});
await db('market_contacts',{id:`eq.${contactId}`},'PATCH',{last_touch_at:at,email_last_sent_at:at,sequence_paused:true,sequence_paused_reason:'manual_email_conversation'});
console.log(JSON.stringify({accepted:true,provider:'ses',messageId,contactId,email,at}));
