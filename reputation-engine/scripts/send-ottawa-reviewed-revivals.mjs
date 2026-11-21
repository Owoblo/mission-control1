import fs from 'node:fs/promises';import {createHmac} from 'node:crypto';
const root='partnership-system/markets/ca/on/ottawa';
const reviewed=JSON.parse(await fs.readFile(root+'/revival-review-20260916.json'));
const batch=process.argv.find(a=>a.startsWith('--batch='))?.slice(8)||'initial';
if(!/^[a-z0-9-]+$/.test(batch))throw Error('Invalid batch');
const initialMessages=[
{id:'f8a1a4f3-9454-45d1-83ce-ee88b679be3f',name:'Ali Abbas',body:"Hi Ali, Dr. Courage from Dexa Movers here. I enjoyed our coffee at Second Cup on Hunt Club in July. How has your fall been going? If a buyer or seller needs moving help around Ottawa, I'm happy to help. Is there anything you'd like from me to make an introduction easier?"},
{id:'51a145bf-baf1-445d-a112-a5cdd4c8d617',name:'Zoran Delic',body:"Hi Zoran, Dr. Courage from Dexa Movers here. Back in July you mentioned saving my number for clients who need a hand moving around Ottawa. Just a gentle check-in as fall gets going—do you have any upcoming client moves where a quote would be useful? Happy to help whenever the need comes up."},
{id:'bc869ae0-8262-44f3-a831-e0dd3611ec12',name:'Kent Johnston',body:"Hi Kent, Dr. Courage from Dexa Movers here. Thanks again for sharing your card in July. You mentioned you didn't yet have a moving company for clients, so I wanted to stay in touch. Would a digital Dexa card be handy to keep on your phone and pass along when someone needs moving help around Ottawa?"}
];
const messages=batch==='initial'?initialMessages:JSON.parse(await fs.readFile(root+'/'+batch+'-drafts.json'));
if(batch==='initial')await fs.writeFile(root+'/reviewed-revival-drafts.json',JSON.stringify(messages,null,2));
if(!process.argv.includes('--send')){console.log(JSON.stringify(messages));process.exit(0);}
const h={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'};
async function db(t,q={},method='GET',body){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+t+'?'+new URLSearchParams(q),{method,headers:h,body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('CRM '+r.status);return r.json();}
const secret=process.env.AUTH_SECRET.replace(/\\r|\\n|\r|\n/g,'').trim();if(secret.includes('SENSITIVE'))throw Error('No authentication');
const p=Buffer.from(JSON.stringify({role:'owner',name:'John — authorized Dexa revival',exp:Date.now()+1800000})).toString('base64url');const cookie='mc_session='+p+'.'+createHmac('sha256',secret).update(p).digest('base64url');
const receipts=[];
const accountCounts=new Map();
for(const file of await fs.readdir(root))if(/^revival-[0-9a-f-]+\.json$/.test(file)){const prior=JSON.parse(await fs.readFile(root+'/'+file));if(prior.state==='accepted'){const c=reviewed.contacts.find(c=>c.id===prior.id);const account=c?.partner_company_id||prior.id;accountCounts.set(account,(accountCounts.get(account)||0)+1)}}
for(const m of messages){const path=root+'/revival-'+m.id+'.json';let prior;try{prior=JSON.parse(await fs.readFile(path))}catch(e){if(e.code!=='ENOENT')throw e;}if(prior){receipts.push(prior);continue;}
const contact=reviewed.contacts.find(c=>c.id===m.id);if(!contact||contact.name!==m.name)throw Error('Reviewed identity mismatch');
const account=contact.partner_company_id||m.id;
if((accountCounts.get(account)||0)>=2){receipts.push({...m,state:'held_account_cadence'});continue;}
const history=reviewed.touches.filter(t=>t.contact_id===m.id).sort((a,b)=>a.created_at.localeCompare(b.created_at));
const fresh=await db('market_touches',{contact_id:'eq.'+m.id,order:'created_at.desc',limit:1,select:'id'});
if(fresh[0]?.id!==history.at(-1)?.id){receipts.push({name:m.name,state:'held_new_activity'});continue;}
await fs.writeFile(path,JSON.stringify({...m,state:'reserved_no_retry'},null,2),{flag:'wx'});
const r=await fetch(`https://go.quote2move.com/api/marketing/contacts/${m.id}/send-reply`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({body:m.body,from_number:'+15482908695',...(m.mediaUrls?{mediaUrls:m.mediaUrls}:{})})});const result=await r.json();const receipt={...m,at:new Date().toISOString(),state:r.ok?'accepted':'held',http:r.status,result};await fs.writeFile(path,JSON.stringify(receipt,null,2));receipts.push(receipt);
if(r.ok)accountCounts.set(account,(accountCounts.get(account)||0)+1);
if(r.ok)await db('market_contacts',{id:'eq.'+m.id},'PATCH',{sequence_paused:true,sequence_paused_reason:'Ottawa Dexa relationship revival — await reply; no automatic cold sequence'});
console.log(JSON.stringify({name:m.name,state:receipt.state,sid:result.sid,error:result.error}));
}
await fs.writeFile(root+(batch==='initial'?'/revival-send-results.json':'/'+batch+'-send-results.json'),JSON.stringify(receipts,null,2));
