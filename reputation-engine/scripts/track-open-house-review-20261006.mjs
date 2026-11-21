import fs from 'node:fs/promises'
import crypto from 'node:crypto'
const dir='artifacts/open-house-review-20261006'
const read=async name=>JSON.parse(await fs.readFile(`${dir}/${name}.json`,'utf8'))
const [agents,evidence,rows]=await Promise.all(['agent-matches','crm-evidence','source-rows'].map(read))
const developed=new Set(['wendy pauls','nadia khalaf','charlotte anne ferguson','sheri beckett','amy heinmiller','scott herman','mary covemaeker'])
const labels={positive:'Positive reply',sent_no_reply:'Sent — no reply recorded',not_sent:'Matched — no outreach recorded',neutral:'Replied — neutral',identity_review:'Identity review — history unconfirmed'}
const report=agents.map(a=>{
 const touches=evidence.touches.filter(t=>a.matched_ids.includes(t.contact_id))
 const contacts=evidence.contacts.filter(c=>a.matched_ids.includes(c.id))
 const inbound=touches.filter(t=>t.direction==='inbound')
 const outbound=touches.filter(t=>t.direction==='outbound')
 const category=!a.matched_ids.length?'identity_review':inbound.length?(a.key==='joan hewitt jancsar'?'neutral':'positive'):outbound.length||contacts.some(c=>c.email_last_sent_at)?'sent_no_reply':'not_sent'
 const listings=rows.filter(r=>a.rows.includes(r.row_id))
 return {name:a.name,key:a.key,category,status:labels[category],relationship_developed:developed.has(a.key),regions:a.regions,source_phones:a.phones,contact_ids:a.matched_ids,match_type:a.match_type,verification_url:a.verification_url||null,inbound_count:inbound.length,outbound_count:outbound.length,last_outbound:outbound.at(-1)?.created_at||null,last_reply:inbound.at(-1)?.created_at||null,reply_evidence:inbound.map(t=>({at:t.created_at,text:t.notes})),listings,crm_links:a.matched_ids.map(id=>`https://go.quote2move.com/marketing/partners?tab=phone&contact=${id}`)}
})
const counts=Object.fromEntries(Object.keys(labels).map(k=>[k,report.filter(r=>r.category===k).length]))
const summary={snapshot_at:evidence.at,source_rows:rows.length,unique_entities:report.length,human_agents:report.length-1,brokerage_entities:1,counts,developed_relationships:report.filter(r=>r.relationship_developed).length,definition:'Developed means repeat engagement on a later date, materials exchange, or a specific office-meeting invitation plus explicit referral interest. It does not establish a completed meeting or a producing partnership.',referrals_recorded:evidence.referrals.length,completed_appointments_recorded:evidence.appointments.filter(a=>a.status==='completed').length,unresolved_breakdown:Object.fromEntries(['unmatched','phone_only','exact_name','name_variant'].map(k=>[k,report.filter(r=>r.category==='identity_review'&&r.match_type===k).length]))}
if(report.length!==177||Object.values(counts).reduce((a,b)=>a+b,0)!==177)throw Error('Invalid total')
await fs.writeFile(`${dir}/review.json`,JSON.stringify({summary,agents:report},null,2))
const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"'
const fields=['name','status','relationship_developed','regions','source_phones','match_type','inbound_count','outbound_count','last_reply','crm_links']
await fs.writeFile(`${dir}/agent-status.csv`,[fields,...report.map(r=>fields.map(k=>Array.isArray(r[k])?r[k].join(' | '):r[k]))].map(r=>r.map(csvCell).join(',')).join('\n'))
console.log(JSON.stringify(summary,null,2))
if(!process.argv.includes('--apply'))process.exit(0)
const headers={apikey:process.env.SUPABASE_KEY,Authorization:`Bearer ${process.env.SUPABASE_KEY}`,'Content-Type':'application/json'}
async function db(table,query={},method='GET',body){const response=await fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${new URLSearchParams(query)}`,{method,headers:{...headers,Prefer:method==='POST'?'resolution=ignore-duplicates,return=representation':'return=representation'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});if(!response.ok)throw Error(`${table} ${response.status} ${(await response.text()).slice(0,500)}`);return response.json()}
const uuid=s=>{const h=crypto.createHash('sha256').update('open-houses-oct6-13-2026:'+s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
const groups=[{key:'all',label:'All verified contacts',members:report.filter(r=>r.contact_ids.length)},{key:'developed',label:'Developed relationships',members:report.filter(r=>r.relationship_developed)},...Object.entries(labels).filter(([key])=>key!=='identity_review').map(([key,label])=>({key,label,members:report.filter(r=>r.category===key)}))]
const writes=[]
for(const group of groups){
 const id=uuid('list:'+group.key)
 const members=[...new Set(group.members.flatMap(r=>r.contact_ids))]
 await db('market_lists',{on_conflict:'id'},'POST',{id,name:`Open houses Oct 6–13, 2026 — ${group.label}`,description:`Owner-requested audit of both supplied DOCX lists. Snapshot ${evidence.at}. ${group.members.length} verified agents. Full 177-entity audit and 80 unresolved identities are tracked in Tasks: Open-house CRM audit — Oct 6–13, 2026. Status reflects recorded history, not guaranteed delivery. No outreach was initiated.`,color:group.key==='positive'?'green':'slate',created_by:'Codex — owner-requested audit'})
 if(members.length)await db('market_list_contacts',{on_conflict:'list_id,contact_id'},'POST',members.map(contact_id=>({list_id:id,contact_id,added_by:'Codex — owner-requested audit'})))
 const stored=await db('market_list_contacts',{list_id:`eq.${id}`,select:'contact_id',limit:'1000'})
 if(stored.length!==members.length||members.some(id=>!stored.some(s=>s.contact_id===id)))throw Error('List verification failed')
 writes.push({id,name:group.label,verified_members:stored.length})
}
function detail(r){return `${r.name} | ${r.status}${r.relationship_developed?' | Developed relationship':''}\nMatch: ${r.match_type}; source phones: ${r.source_phones.join(', ')||'pending'}\n${r.crm_links.join('\n')}\n${r.reply_evidence.map(e=>e.at.slice(0,10)+': '+e.text).join('\n')}\n${r.listings.map(l=>`${l.document} | ${l.region} | ${l.day} | ${l.time} | ${l.address} | ${l.row_id}`).join('\n')}`}
const auditId='open-house-crm-audit-20261006'
const description=`CRM comparison of ottawa-region-open-houses-oct-6-13-2026 (1).docx and all-regions-open-houses-oct-6-13-2026.docx.\n${JSON.stringify(summary,null,2)}\n\nPositive is determined by actual replies, not AI outcome labels. Joan's no-office reply is neutral. Priyanka's shared office number is associated with Pamela's STOP messages: do not attribute Pamela's history or contact that number. Unresolved identities are not asserted to have never been contacted. Shared-office numbers are not verified personal mobiles. Cheryl's number is a shared team contact, based on existing CRM notes. No new contacts, messages, enrollments, or stage changes were made. Listed open houses are source-document claims, not independently verified live schedules.\n\n${report.map(detail).join('\n\n---\n\n')}`
const tasks=[{id:auditId,title:'Open-house CRM audit — Oct 6–13, 2026',description,status:'completed',completed_at:new Date().toISOString(),outcome_note:`177 entities reviewed; ${JSON.stringify(counts)}; 7 developed relationships within 11 positives. Verified contacts saved in six custom lists.`,source_key:auditId},{id:auditId+'-identity-review',title:'Verify 80 open-house identities — Oct 6–13, 2026',description:'Owner-requested cohort tracking. These source entries have no confidently matched CRM identity. Verify direct contact identity before importing or sending. Do not count shared-office-number histories as individual outreach. Priyanka Vaidya source number has STOP history under Pamela Dancey.\n\n'+report.filter(r=>r.category==='identity_review').map(detail).join('\n\n---\n\n'),status:'open',source_key:auditId+'-identity-review'}]
for(const task of tasks){await db('crm_tasks',{on_conflict:'id'},'POST',{...task,category:'partnerships',priority:'normal',source:'manual',created_by_name:'Codex — owner-requested audit'});const [stored]=await db('crm_tasks',{id:`eq.${task.id}`,select:'id,title,status,description'});if(stored?.description!==task.description)throw Error('Task verification failed');writes.push({task_id:stored.id,status:stored.status,title:stored.title})}
await fs.writeFile(`${dir}/crm-tracking-receipt.json`,JSON.stringify({at:new Date().toISOString(),writes},null,2))
console.log(JSON.stringify({verified_writes:writes},null,2))
