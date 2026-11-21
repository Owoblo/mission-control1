import {fs} from './gta-email-recovery-runtime.mjs';
import {parseEnv} from 'node:util';
const localEnv=parseEnv(fs.readFileSync('.env.local','utf8'));
process.env.TELNYX_API_KEY=localEnv.TELNYX_API_KEY;
const {db}=await import('./reply-runtime-20261007.mjs');
const {candidates,body,from,campaign}=await import('./london-sarnia-subcontractors-20261015-data.mjs');
const dir='artifacts/'+campaign+'/';fs.mkdirSync(dir,{recursive:true});
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10);
fs.writeFileSync(dir+'manifest.json',JSON.stringify({campaign,from,body,candidates},null,2));
const allPhones=[...new Set(candidates.flatMap(c=>[c.phone,...c.aliases]).filter(Boolean))];
const contacts=[],messages=[];
for(let i=0;i<allPhones.length;i+=10){const batch=allPhones.slice(i,i+10);const result=await Promise.allSettled([
 db('market_contacts',{or:'('+batch.map(p=>'phone.ilike.*'+p.slice(-4)+'*').join(',')+')',limit:'1000'}),
 db('sms_messages',{or:'('+batch.flatMap(p=>['from_number.ilike.*'+p.slice(-4)+'*','to_number.ilike.*'+p.slice(-4)+'*']).join(',')+')',order:'created_at.desc',limit:'1000'})]);
 for(const r of result)if(r.status==='rejected')throw r.reason;
 if(result.some(r=>r.value.length===1000))throw Error('Audit pagination needed');
 contacts.push(...result[0].value);messages.push(...result[1].value);
}
const contracts=await db('subcontractors',{select:'*',limit:'1000'});if(contracts.length===1000)throw Error('Contractor pagination needed');
const unique=a=>[...new Map(a.map(x=>[x.id,x])).values()];
const review=[];
for(const c of candidates){const phones=[c.phone,...c.aliases].filter(Boolean).map(norm);const peers=unique(contacts.filter(x=>phones.includes(norm(x.phone))));const sms=unique(messages.filter(x=>phones.includes(norm(x.from_number))||phones.includes(norm(x.to_number))));const subs=contracts.filter(x=>phones.includes(norm(x.phone)));const holds=[c.hold].filter(Boolean);
 if(peers.some(x=>x.do_not_contact||x.cross_channel_suppressed_at||['dnc','closed_lost'].includes(x.stage)||['opted_out','rejected'].includes(x.decision))||subs.some(x=>x.status==='blocked')||sms.some(x=>x.direction==='inbound'&&/\b(stop|unsubscribe|wrong number|do not contact|don't contact)\b/i.test(x.body||'')))holds.push('suppression_or_optout');
 if(peers.some(x=>x.id!==c.approved_existing_contact_id))holds.push('existing_partnership_identity_review');
 if(sms.length)holds.push('existing_sms_history_review');
 if(subs.length)holds.push('existing_subcontractor_review');
 const nameKey=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');if(contracts.some(x=>nameKey(x.company_name)===nameKey(c.name)))holds.push('existing_contractor_name_review');
 review.push({...c,holds,peers,sms,subcontractors:subs});
}
fs.writeFileSync(dir+'audit.json',JSON.stringify({at:new Date().toISOString(),review},null,2));
const h={Authorization:'Bearer '+process.env.TELNYX_API_KEY.trim()};
const balance=await fetch('https://api.telnyx.com/v2/balance',{headers:h,signal:AbortSignal.timeout(15000)});if(!balance.ok)throw Error('Balance HTTP '+balance.status);const money=(await balance.json()).data;console.log(JSON.stringify({balance:money.balance,currency:money.currency}));
const lookupFile=dir+'lookups.json';const lookups=fs.existsSync(lookupFile)?JSON.parse(fs.readFileSync(lookupFile)):{};
for(const c of review.filter(x=>!x.holds.length)){
 if(lookups[c.phone])continue;
 const r=await fetch('https://api.telnyx.com/v2/number_lookup/'+encodeURIComponent(c.phone)+'?type=carrier',{headers:h,signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Lookup HTTP '+r.status);
 lookups[c.phone]={at:new Date().toISOString(),data:(await r.json()).data};fs.writeFileSync(lookupFile,JSON.stringify(lookups,null,2));
}
for(const c of review){const d=lookups[c.phone]?.data;if(!c.holds.length&&!(d?.valid_number&&d.country_code==='CA'&&['mobile','fixed line or mobile'].includes(d.carrier?.type)&&!d.carrier.error_code))c.holds.push('invalid_or_unsupported_number');c.carrier_type=d?.carrier?.type||null;c.sms_delivery_verified=false;}
fs.writeFileSync(dir+'reviewed.json',JSON.stringify({at:new Date().toISOString(),from,body,review},null,2));
console.log(JSON.stringify({total:review.length,ready:review.filter(c=>!c.holds.length).length,held:review.filter(c=>c.holds.length).map(c=>({row:c.row,name:c.name,holds:c.holds,peers:c.peers.map(x=>({id:x.id,name:x.name,stage:x.stage})),sms:c.sms.map(x=>({at:x.created_at,direction:x.direction,body:x.body})),subs:c.subcontractors.map(x=>({id:x.id,name:x.company_name,status:x.status})),carrier:lookups[c.phone]?.data?.carrier}))},null,2));
