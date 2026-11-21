import './gta-email-recovery-runtime.mjs'
import fs from 'node:fs/promises'
import { db } from './reply-runtime-20261015.mjs'
const dir='artifacts/followup-audit-20261020'
const audit=JSON.parse(await fs.readFile(dir+'/communication-review-60days-evidence.json','utf8'))
const old=JSON.parse(await fs.readFile(dir+'/leads.json','utf8'))
const norm=s=>String(s||'').replace(/\D/g,'').slice(-10)
const since=audit.snapshot_at
async function all(table,query){const rows=[];for(let offset=0;;offset+=1000){const b=await db(table,{...query,limit:1000,offset});rows.push(...b);if(b.length<1000)return rows}}
const [sms,calls,touches]=await Promise.all([all('sms_messages',{created_at:'gt.'+since}),all('call_recordings',{created_at:'gt.'+since}),all('market_touches',{created_at:'gt.'+since,select:'id,contact_id,created_at,direction'})])
const reasonByName={
 'Guy Raymond':'house_sale','Susan Taylor':'house_sale','Terry':'house_sale','Ann':'price_concern','Melissa Robinson':'inventory_pending','Sandy':'date_pending','Shannon Murray':'quote_decision','TERRY SZWEC':'quote_decision','Fiona':'quote_decision','Dashmeet':'callback_scheduled','JOHN CAMPEA':'future_move','Naveen Bhatty':'inventory_pending','REZA PEYVANDI':'outcome_unknown','Jeff Lang':'callback_scheduled',
 'Dayna Langlois':'date_pending','Guhan Subburaj':'date_pending','Nazir':'quote_decision','Anthony':'inventory_pending','DIAMOND OMARI':'inventory_pending','Stephanie Baumgartner':'inventory_pending','CARMEN CHAN':'quote_decision',
 'Catherine':'house_sale','Jim Mcdonald':'house_sale','Jamie Katz':'future_move','Mavis Neuman':'customer_will_contact','Chris Van Kasteren':'customer_will_contact','SHARLA Lemelin':'customer_will_contact','Bob Sherman':'date_pending'
}
const customerLed=new Set(['Jim Mcdonald','Mavis Neuman','Chris Van Kasteren','SHARLA Lemelin','CARMEN CHAN','Guhan Subburaj','Jamie Katz'])
const dates={'Jeff Lang':'2026-10-21','Dayna Langlois':'2026-10-23','Guhan Subburaj':'2026-10-23','Nazir':'2026-10-21','Anthony':'2026-10-21','DIAMOND OMARI':'2026-10-21','Stephanie Baumgartner':'2026-10-21','CARMEN CHAN':'2026-10-26','Catherine':'2026-10-27','Jim Mcdonald':'2026-11-02','Jamie Katz':'2026-12-21','Mavis Neuman':'2026-11-09','Chris Van Kasteren':'2026-11-02','SHARLA Lemelin':'2026-10-26','Fred Skogland — Maria referral':'2026-11-16','JASON COHEN':'2026-10-23',"TARA D'OLIVEIRA":'2026-10-23'}
const results=[]
for(const entry of audit.entries){
 const [live]=await db('crm_leads',{id:'eq.'+entry.lead_id,deleted:'eq.false'})
 if(!live){results.push({name:entry.name,state:'missing'});continue}
 if(live.data.followUpPlan?.reviewedBy==='John via Codex — 60-day communication review'){results.push({name:entry.name,state:'already_applied'});continue}
 const previous=old.find(l=>l.id===live.id)
 const ids=new Set([live.data.partnerContactId,live.data.partnerReferralContactId,live.data.relationshipContactId].filter(Boolean))
 const changed=live.updated_at!==previous?.updated_at||sms.some(m=>m.lead_id===live.id||norm(m.direction==='inbound'?m.from_number:m.to_number)===norm(live.data.phone))||calls.some(c=>c.lead_id===live.id||norm(c.phone_number)===norm(live.data.phone))||touches.some(t=>ids.has(t.contact_id))
 if(changed){results.push({name:entry.name,state:'changed_since_audit_review_required'});continue}
 let reason=reasonByName[entry.name]||(entry.group.startsWith('Referral')?'referral_pending':entry.group.startsWith('Older')?'outcome_unknown':'needs_review')
 let policy=customerLed.has(entry.name)?'customer_led':entry.group.startsWith('Unqualified')||entry.group.startsWith('Older')||['Bob Sherman','Fred Skogland — Maria referral'].includes(entry.name)?'internal_only':reason==='callback_scheduled'?'scheduled':'proactive'
 const lastRep=[...(live.data.callLogs||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date))).find(c=>['Thelma Ufot','Ommy Eshiet'].includes(c.repName))?.repName
 const ownerName=['Fred Skogland — Maria referral','Bob Sherman'].includes(entry.name)||entry.group.startsWith('Unqualified')?'John':live.data.assignedRepName||lastRep||'Thelma Ufot'
 const plan={reason,policy,ownerName,nextAction:entry.next_action,reviewOn:dates[entry.name]||'2026-10-20',evidence:`${entry.evidence_date}: ${entry.reason}`,reviewedAt:new Date().toISOString(),reviewedBy:'John via Codex — 60-day communication review'}
 await fs.writeFile(dir+'/plan-before-'+live.id+'.json',JSON.stringify(live),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e})
 const data={...live.data,followUpPlan:plan,followUpPlanHistory:[...(live.data.followUpPlanHistory||[]),live.data.followUpPlan].filter(Boolean).slice(-50)}
 const result=await db('crm_leads',{id:'eq.'+live.id,deleted:'eq.false',updated_at:'eq.'+live.updated_at},'PATCH',{data,updated_at:plan.reviewedAt})
 if(!result.length){results.push({name:entry.name,state:'concurrent_change_skipped'});continue}
 results.push({name:entry.name,id:live.id,state:'applied',plan})
 await fs.writeFile(dir+'/applied-plans.json',JSON.stringify(results,null,2))
}
await fs.writeFile(dir+'/applied-plans.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results.map(r=>({name:r.name,state:r.state}))))
