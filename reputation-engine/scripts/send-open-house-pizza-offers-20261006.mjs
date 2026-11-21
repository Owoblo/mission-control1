import fs from 'node:fs/promises'
import { createHmac } from 'node:crypto'
const dir='artifacts/open-house-review-20261006'
const review=JSON.parse(await fs.readFile(`${dir}/review.json`,'utf8'))
const candidates=review.agents.filter(a=>a.category==='positive')
const headers={apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json'}
async function db(table,query,method='GET',body){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(query)}`,{method,headers:{...headers,Prefer:'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error(`CRM ${table} ${r.status}`);return r.status===204?[]:r.json()}
const intros={
 'jennifer richardson':"Hey Jennifer! I saw the open houses on Thackeray Way and Bean Street tomorrow, Oct 7. Will you be hosting either one?",
 'wendy pauls':"Hey Wendy! Will you be hosting the open house at 469 Westvale Drive this Saturday, Oct 10?",
 'amy heinmiller':"Hey Amy! Will you be hosting the open house at 117 Thackeray Way on Monday, Oct 12?",
 'osman omar':"Hey Osman! Will you be hosting the open house at 6-120 Centre Street this Thursday, Oct 8?",
 'stacey crechiola':"Hey Stacey! Will you be hosting the open house at 120 Huron Avenue this Sunday, Oct 11?",
 'charlotte anne ferguson':"Hey Charlotte! Will you be hosting the open house at 146 Benson Street this Saturday, Oct 10?",
 'charlene longlade':"Hey Charlene! I saw the open houses on College Avenue and Metcalfe Street this Saturday, Oct 10. Will you be hosting either one?",
 'sheri beckett':"Hey Sheri! I saw the open houses on Ferncrest Road and Peers Place this Saturday, Oct 10. Will you be hosting either one?",
 'nadia khalaf':"Hey Nadia! Will you be hosting the open house at 61 Hilton Court this Saturday, Oct 10?",
 'scott herman':"Hey Scott! Will you be hosting the open house at 81 Devon Road this Thursday, Oct 8?",
 'mary covemaeker':"Hey Mary! Will you be hosting the open house at 29395 Zone 4 Road this Saturday, Oct 10?",
}
const plan=[]
for(const a of candidates){
 const id=a.contact_ids[0]
 const [contacts,touches]=await Promise.all([db('market_contacts',{id:`eq.${id}`,select:'*'}),db('market_touches',{contact_id:`eq.${id}`,select:'id,channel,direction,notes,metadata,created_at',order:'created_at.desc',limit:'1000'})])
 const c=contacts[0]
 if(!c||c.do_not_contact||c.cross_channel_suppressed_at||['dnc','closed_lost'].includes(c.stage)||['opted_out','rejected'].includes(c.decision))throw Error(`Suppressed: ${a.name}`)
 const sms=touches.filter(t=>t.channel==='sms')
 if(sms.some(t=>t.direction==='inbound'&&(t.metadata?.optedOut||/^(?:Inbound SMS:\s*)?(?:stop|unsubscribe|cancel|quit|end)\b/i.test(t.notes||''))))throw Error(`Opt-out history: ${a.name}`)
 const latest=sms.find(t=>t.direction==='inbound')
 const newer=sms.filter(t=>t.created_at>review.summary.snapshot_at)
 if(newer.length)throw Error(`New thread activity requires review: ${a.name}`)
 const sender=sms.map(t=>t.direction==='inbound'?t.metadata?.to:t.metadata?.from).find(Boolean)
 if(!sender||!intros[a.key])throw Error('Missing sender or draft')
 const body=intros[a.key]+" I'd love to send over some pizza and drinks for you and everyone there, our treat! If that works, what delivery time and roughly how many people should I plan for?"
 plan.push({id,name:a.name,to:c.phone,from:sender,body,last_inbound:latest?.notes,listings:a.listings})
}
if(plan.length!==11||new Set(plan.map(p=>p.to)).size!==11)throw Error('Recipient validation failed')
await fs.writeFile(`${dir}/pizza-offer-plan.json`,JSON.stringify(plan,null,2))
console.log(JSON.stringify(plan.map(({name,from,body,last_inbound})=>({name,from,body,last_inbound})),null,2))
if(!process.argv.includes('--send'))process.exit(0)
if(!process.env.AUTH_SECRET)throw Error('Missing CRM session configuration')
for(const p of plan){
 const file=`${dir}/pizza-offer-${p.id}.json`
 await fs.writeFile(file,JSON.stringify({...p,state:'reserved_no_blind_retry',at:new Date().toISOString()},null,2),{flag:'wx'})
 const payload=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+5*60*1000})).toString('base64url')
 const token=payload+'.'+createHmac('sha256',process.env.AUTH_SECRET).update(payload).digest('base64url')
 const response=await fetch(`https://go.quote2move.com/api/marketing/contacts/${p.id}/send-reply`,{method:'POST',headers:{Cookie:'mc_session='+token,'Content-Type':'application/json'},body:JSON.stringify({body:p.body,from_number:p.from}),signal:AbortSignal.timeout(45000)})
 const result=await response.json()
 await fs.writeFile(file,JSON.stringify({...p,state:response.ok?'accepted':'failed_or_unknown',at:new Date().toISOString(),http_status:response.status,result},null,2))
 console.log(JSON.stringify({name:p.name,status:response.status,sid:result.sid,error:result.error}))
 if(!response.ok||!result.sid)throw Error('Send not confirmed; inspect before retry')
 const logged=await db('market_touches',{contact_id:`eq.${p.id}`,notes:`eq.${p.body}`,select:'id,metadata',limit:'10'})
 if(!logged.some(t=>t.metadata?.twilioSid===result.sid))throw Error('Provider accepted but CRM record not verified')
 const taskId=`open-house-pizza-20261006-${p.id}`
 const existing=await db('crm_tasks',{id:`eq.${taskId}`,select:'id'})
 if(!existing.length)await db('crm_tasks',{},'POST',{id:taskId,title:`Open-house pizza offer — ${p.name}`,description:`Owner authorized the offer on October 6, 2026. SMS accepted: ${result.sid}.\n\n${p.body}\n\nAwait reply confirming host, address, delivery time and headcount; collect food preferences/allergies before arranging an order. No food has been ordered.\n\nSource listing(s):\n${p.listings.map(l=>`${l.day} | ${l.time} | ${l.address}`).join('\n')}`,status:'open',priority:'normal',category:'partnerships',related_type:'partner',related_id:p.id,related_label:p.name,source:'manual',source_key:taskId,created_by_name:'John via Codex',due_at:'2026-10-07T13:00:00Z'})
}
