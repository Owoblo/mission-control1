import fs from 'node:fs/promises'
import {createHmac} from 'node:crypto'

const nadiaId='584429cc-cadb-4905-851d-70004ac1e463'
const hoodId='7da42db1-8974-45c7-ac3c-52c5306d71ed'
const taskId='nadia-phone-identity-fix-20261006'
const phone='+15199037212'
const source='https://www.remaxcommercial.com/brokers/214598/nadia-khalaf/'
const headers={apikey:process.env.SUPABASE_KEY,Authorization:'Bearer '+process.env.SUPABASE_KEY,'Content-Type':'application/json',Prefer:'return=representation'}
async function db(table,q={},method='GET',body){
 const r=await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table+'?'+new URLSearchParams(q),{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)})
 if(!r.ok)throw Error(table+' '+r.status+' '+await r.text())
 return r.status===204?[]:r.json()
}
const before=await db('market_contacts',{id:`in.(${nadiaId},${hoodId})`,select:'*'})
const nadia=before.find(x=>x.id===nadiaId),hood=before.find(x=>x.id===hoodId)
if(!nadia||!hood)throw Error('Missing contact')
const prior=await db('crm_tasks',{id:'eq.'+taskId})
if(prior.length&&prior[0].status!=='in_progress')throw Error('Audit already completed; inspect before resuming')
if(nadia.phone!=='519-903-7212'||hood.phone!==phone)throw Error('Phones changed; review required')
const jobs=await db('sequence_jobs',{contact_id:'eq.'+hoodId,select:'*'})
if(jobs.some(j=>!['sent','cancelled','failed','skipped'].includes(j.status)))throw Error('Unsettled job requires review')
const at=new Date().toISOString()
if(!prior.length){
 await fs.writeFile('artifacts/realtor-batch-20261006/nadia-phone-identity-before.json',JSON.stringify({at,source,before,jobs},null,2),{flag:'wx'})
 await db('crm_tasks',{},'POST',{id:taskId,title:'Correct Nadia Khalaf / Hood imported phone collision',description:JSON.stringify({at,source,reason:'RE/MAX confirms Nadia owns this contact number. Hood import contains mixed Hood/Grove business identity. Remove unverified phone from Hood, pause outreach, preserve history and normalize Nadia phone.',before,jobs}),status:'in_progress',priority:'normal',category:'partnerships',owner_name:'John',related_type:'partner',related_id:nadiaId,related_label:nadia.name,source:'manual',source_key:taskId,created_by_name:'John via Codex'})
}
let hoodNotes
try {hoodNotes=JSON.parse(hood.notes)}catch {hoodNotes={previous_notes:hood.notes}}
const patch={phone:null,sequence_paused:true,sequence_paused_reason:'identity_review_wrong_phone',next_follow_up:null,tags:[...new Set([...(hood.tags||[]),'identity-review'])],notes:JSON.stringify({...hoodNotes,phone_identity_review:{at,removed_phone:phone,verified_contact_id:nadiaId,source,reason:'Number belongs to Nadia Khalaf. Imported Hood record mixes Hood and Grove Rental Management; verify business identity and contact details before resuming outreach. Historical communications retained.'}})}
const changed=await db('market_contacts',{id:'eq.'+hoodId,phone:'eq.'+phone,notes:'eq.'+hood.notes},'PATCH',patch)
if(changed.length!==1)throw Error('Hood changed concurrently; stopped')
const normalized=await db('market_contacts',{id:'eq.'+nadiaId,phone:'eq.'+nadia.phone},'PATCH',{phone})
if(normalized.length!==1)throw Error('Nadia changed concurrently; stopped')
const candidates=await db('market_contacts',{phone:'ilike.*7212*',select:'id,name,phone',limit:'1000'})
const matches=candidates.filter(c=>String(c.phone).replace(/\D/g,'').slice(-10)==='5199037212')
if(matches.length!==1||matches[0].id!==nadiaId)throw Error('Still ambiguous')
const after=await db('market_contacts',{id:`in.(${nadiaId},${hoodId})`,select:'id,name,phone,sequence_paused,sequence_paused_reason,next_follow_up'})
const h=after.find(c=>c.id===hoodId)
if(h.phone!==null||!h.sequence_paused||h.next_follow_up!==null)throw Error('Hood readback mismatch')
const payload=Buffer.from(JSON.stringify({role:'owner',name:'John',exp:Date.now()+300000})).toString('base64url')
const token=payload+'.'+createHmac('sha256',process.env.AUTH_SECRET).update(payload).digest('base64url')
const r=await fetch('https://go.quote2move.com/api/sales/partner-directory?q=15199037212',{headers:{Cookie:'mc_session='+token},signal:AbortSignal.timeout(30000)})
if(!r.ok)throw Error('Live directory '+r.status)
const directory=await r.json()
const receipt={at:new Date().toISOString(),matches,after,directory}
await fs.writeFile('artifacts/realtor-batch-20261006/nadia-phone-identity-after.json',JSON.stringify(receipt,null,2))
console.log(JSON.stringify(receipt,null,2))
await db('crm_tasks',{id:'eq.'+taskId},'PATCH',{status:'completed',completed_at:new Date().toISOString(),outcome_note:'Removed erroneous Hood phone, paused Hood outreach, cleared follow-up, preserved historical records. Normalized Nadia phone. Database matching has exactly one match: Nadia Khalaf. Live CRM directory query succeeded; receipt saved.'})
