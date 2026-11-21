import fs from 'node:fs/promises'
const out='artifacts/open-house-review-20261006'
const agents=JSON.parse(await fs.readFile(`${out}/agent-matches.json`,'utf8'))
const ids=[...new Set(agents.flatMap(a=>a.candidates.map(c=>c.id)))]
const headers={apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`}
async function readAll(table,query){let result=[];for(let offset=0;;offset+=1000){const r=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams({...query,limit:'1000',offset:String(offset)})}`,{headers,signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`${table} ${r.status} ${await r.text()}`);const rows=await r.json();result.push(...rows);if(rows.length<1000)return result}}
const result={at:new Date().toISOString(),contacts:[],touches:[],referrals:[],tasks:[],appointments:[],sms:[]}
for(let start=0;start<ids.length;start+=40){const filter='in.('+ids.slice(start,start+40).join(',')+')';const data=await Promise.all([
 readAll('market_contacts',{select:'*',id:filter,order:'id.asc'}),
 readAll('market_touches',{select:'*',contact_id:filter,order:'created_at.asc,id.asc'}),
 readAll('partner_referrals',{select:'*',contact_id:filter,order:'id.asc'}),
 readAll('crm_tasks',{select:'*',related_id:filter,order:'id.asc'}),
 readAll('market_appointments',{select:'*',contact_id:filter,order:'id.asc'})]);
 for(const [i,key] of ['contacts','touches','referrals','tasks','appointments'].entries())result[key].push(...data[i]);
 console.log('Evidence contacts',result.contacts.length,'touches',result.touches.length)
}
const normalize=p=>{const n=(p||'').replace(/\D/g,'');return n.length>=10?'+1'+n.slice(-10):null}
const phones=[...new Set([...agents.flatMap(a=>a.phones),...result.contacts.map(c=>normalize(c.phone))].filter(Boolean))]
for(let i=0;i<phones.length;i+=60){const phoneFilter='('+phones.slice(i,i+60).join(',')+')';result.sms.push(...await readAll('sms_messages',{select:'*',or:`(from_number.in.${phoneFilter},to_number.in.${phoneFilter})`,order:'created_at.asc,id.asc'}))}
result.sms=[...new Map(result.sms.map(s=>[s.id,s])).values()]
await fs.writeFile(`${out}/crm-evidence.json`,JSON.stringify(result,null,2))
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([k,v])=>[k,Array.isArray(v)?v.length:v]))))
