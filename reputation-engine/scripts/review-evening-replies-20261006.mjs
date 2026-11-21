import fs from 'node:fs/promises'
const h={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY}
async function db(t,q){let out=[];for(let o=0;;o+=1000){const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+t+'?'+new URLSearchParams({...q,limit:'1000',offset:String(o)}),{headers:h});if(!r.ok)throw Error(t+' '+r.status);const a=await r.json();out.push(...a);if(a.length<1000)return out}}
const jobs=await db('sequence_jobs',{'sms_payload->>campaign_key':'eq.gta-20261006-intro-v1',select:'*'})
const inbound=await db('market_touches',{direction:'eq.inbound',created_at:'gte.2026-10-06T04:00:00Z',order:'created_at.asc,id.asc',select:'*'})
const ids=[...new Set(inbound.map(t=>t.contact_id))]
const contacts=await db('market_contacts',{id:'in.('+ids.join(',')+')',select:'*'})
const all=await db('market_touches',{contact_id:'in.('+ids.join(',')+')',order:'created_at.asc,id.asc',select:'*'})
const tasks=await db('crm_tasks',{related_id:'in.('+ids.join(',')+')',select:'*'})
const threads=contacts.map(c=>({contact:c,batch:jobs.some(j=>j.contact_id===c.id),touches:all.filter(t=>t.contact_id===c.id),tasks:tasks.filter(t=>t.related_id===c.id)}))
await fs.writeFile('artifacts/realtor-batch-20261006/evening-review.json',JSON.stringify({at:new Date().toISOString(),threads},null,2))
for(const t of threads){console.log(JSON.stringify({id:t.contact.id,name:t.contact.name,city:t.contact.city,email:t.contact.email,batch:t.batch,tasks:t.tasks.filter(t=>['open','in_progress'].includes(t.status)).map(t=>({id:t.id,title:t.title,description:t.description})),history:t.touches.map(x=>({id:x.id,d:x.direction,channel:x.channel,at:x.created_at,text:x.notes,review:x.metadata?.partnership_review})).filter(x=>!t.batch||x.d!=='outbound'||!x.text?.startsWith('Hey '))}))}
