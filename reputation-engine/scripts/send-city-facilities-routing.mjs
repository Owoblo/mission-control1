import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {SESv2Client,SendEmailCommand} from '@aws-sdk/client-sesv2';
import {reserveAction} from '../lib/partnership-core/reserve.mjs';
const account='f3a72b7a-2c0c-4f78-a6e8-7732bcf024de';
const origin='c2d76243-7b90-4fcb-af84-89909ff84f65';
const email='parkrec@citywindsor.ca';
const routeSource='https://www.citywindsor.ca/city-hall/city-departments/office-of-the-commissioner-of-community-and-corporate-services';
const path='partnership-system/state/city-facilities-routing-send.json';
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json'};
async function db(table,q={},method='GET',body,prefer='return=representation'){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers:{...headers,Prefer:prefer},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error(table+' '+r.status+' '+await r.text());return r.status===204?[]:r.json();}
function uuid(key){const h=createHash('sha256').update(key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}
if(!process.env.AWS_SES_CONFIGURATION_SET)throw Error('Missing SES event tracking');
try{await fs.access(path);throw Error('Existing attempt: inspect before retry');}catch(e){if(e.code!=='ENOENT')throw e;}
const evidence=await db('market_touches',{contact_id:'eq.'+origin,direction:'eq.inbound',outcome_code:'eq.referred_contact',order:'created_at.desc',limit:1});
const source=evidence[0];if(!source?.metadata?.human_reply||!/Facility Department/i.test(source.notes))throw Error('Missing genuine Facilities routing reply');
const newer=await db('market_touches',{contact_id:'eq.'+origin,direction:'eq.inbound',created_at:'gt.'+source.created_at,'metadata->>human_reply':'eq.true',select:'id'});if(newer.length)throw Error('New human reply requires review');
const official=await fetch(routeSource);const officialText=await official.text();if(!official.ok||!officialText.toLowerCase().includes(email))throw Error('Official route no longer present');
let [contact]=await db('market_contacts',{email:'eq.'+email,select:'id,partner_company_id,email'});
if(contact&&contact.partner_company_id!==account)throw Error('Existing contact belongs to another account');
if(!contact){[contact]=await db('market_contacts',{},'POST',{id:uuid('city-facilities-routing:'+email),name:'City of Windsor — Community Services routing',company:'City of Windsor',city:'Windsor',email,partner_company_id:account,stage:'target',owner_name:'John',preferred_channel:'email',sequence_paused:true,sequence_paused_reason:'Reviewed Facilities routing referral',commission_rule_required:false,notes:JSON.stringify({source:routeSource,referral_touch_id:source.id,route_type:'department_routing_not_named_decision_maker',verified_at:new Date().toISOString()})});}
const now=new Date();
await db('partnership_reviewed_handoffs',{},'POST',{contact_id:contact.id,account_id:account,source_touch_id:source.id,channel:'email',target_route:email,route_source_url:routeSource,review_note:'Purchasing directed us to Facilities without a named contact. Official Community Services address is a routing fallback. Ask for Facilities contact only.',reviewed_by:'Owner-authorized partnership operations',reviewed_at:now.toISOString(),expires_at:new Date(+now+86400000).toISOString()},'resolution=ignore-duplicates,return=representation');
const subject='Facilities contact — following Purchasing’s direction';
const body=`Hello Community Services team,

Your Purchasing team suggested I contact Facilities about moving support, but did not have a contact name. The City's website lists this address for Community Services, so I’m hoping you can help route this.

I’m John with Saturn Star Movers in Windsor. We help with office and furniture moves, including smaller transfers between sites.

Who in Facilities handles this type of outside moving support, or could you forward this to the appropriate person?

Thank you,
John Owolabi
Saturn Star Movers
business@starmovers.ca | (226) 773-2993
starmovers.ca
3608 Seminole Street, Unit 3, Windsor, ON N8Y 1Y4

If you prefer no further emails from me, just reply and let me know.`;
const key='reviewed-city-facilities-routing-20260916';
await reserveAction({url:process.env.SUPABASE_URL,headers,contactId:contact.id,channel:'email',kind:'referred_introduction',key,content:subject+'\n'+body,sender:'john@saturnstarmovers.ca'});
const touchId=uuid(key);
await db('market_touches',{},'POST',{id:touchId,contact_id:contact.id,channel:'email',direction:'outbound',notes:body,created_by:'John — authorized referral follow-through',metadata:{subject,source_touch_id:source.id,delivery_state:'reserved_not_confirmed',policy_action_key:key}});
await fs.writeFile(path,JSON.stringify({state:'reserved_no_retry',contactId:contact.id,touchId,subject,body},null,2),{flag:'wx'});
const ses=new SESv2Client({region:'us-east-2',maxAttempts:1});
const result=await ses.send(new SendEmailCommand({FromEmailAddress:'John | Saturn Star Movers <john@saturnstarmovers.ca>',ReplyToAddresses:['business@starmovers.ca'],Destination:{ToAddresses:[email]},ConfigurationSetName:process.env.AWS_SES_CONFIGURATION_SET,EmailTags:[{Name:'contact_id',Value:contact.id},{Name:'campaign',Value:'reviewed-referral-routing'}],Content:{Simple:{Subject:{Data:subject,Charset:'UTF-8'},Body:{Text:{Data:body,Charset:'UTF-8'}}}}}));
if(!result.MessageId)throw Error('Ambiguous provider response; inspect reservation');
const receipt={state:'provider_accepted',contactId:contact.id,touchId,messageId:result.MessageId,to:email,subject,body,at:new Date().toISOString()};await fs.writeFile(path,JSON.stringify(receipt,null,2));
await db('market_touches',{id:'eq.'+touchId},'PATCH',{metadata:{subject,source_touch_id:source.id,delivery_state:'accepted',provider_message_id:result.MessageId,policy_action_key:key},next_step:'Await Facilities routing reply; no parallel cold outreach to this account.'});
await db('market_contacts',{id:'eq.'+contact.id},'PATCH',{last_touch_at:receipt.at,email_last_sent_at:receipt.at,email_provider:'ses',email_provider_message_id:result.MessageId,next_follow_up:'2026-09-18'});
console.log(JSON.stringify({accepted:true,to:email,messageId:result.MessageId,contactId:contact.id}));
