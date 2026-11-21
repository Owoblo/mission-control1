import fs from 'node:fs/promises'
const output='artifacts/open-house-review-20261006'
const headers={apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`}
export async function read(table,query={}) {
 const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(query)}`,{headers,signal:AbortSignal.timeout(45000)})
 if(!r.ok)throw Error(`${table}: ${r.status} ${await r.text()}`)
 return r.json()
}
const columns='id,name,company,phone,email,city,stage,decision,do_not_contact,cross_channel_suppressed_at,sequence_paused,sequence_paused_reason,last_touch_at,last_inbound_at,email_last_sent_at,email_last_replied_at,relationship_temperature,partnership_outcome,partnership_started_at,referred_lead_count,tracking_code,category,industry'
const contacts=[]
for(let offset=0;;offset+=4000){
 const pages=await Promise.all([0,1000,2000,3000].map(i=>read('market_contacts',{select:columns,order:'id.asc',limit:'1000',offset:String(offset+i)})))
 contacts.push(...pages.flat());console.log('Contacts read',contacts.length)
 if(pages.some(p=>p.length<1000))break
}
if(new Set(contacts.map(c=>c.id)).size!==contacts.length)throw Error('Duplicate pagination IDs')
await fs.writeFile(`${output}/crm-contact-index.json`,JSON.stringify(contacts))
console.log('Complete contact index',contacts.length)
