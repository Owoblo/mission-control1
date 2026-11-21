/** Default is read-only planning; --enroll stores step2 plans; --send executes due plans only. */
import './gta-email-recovery-runtime.mjs'
import {db,base,headers} from './reply-runtime-20261015.mjs'
import fs from 'node:fs'
import {createHash} from 'node:crypto'
import {DAY3_FOLLOWUP_POLICY,planDay3Followup,executeDay3Followup,type FollowupContext} from '../lib/partnership-email-followup'
const dir='artifacts/partnership-pilot-3000-20261027/'
const apply=process.argv.includes('--enroll'),send=process.argv.includes('--send')
const limitIndex=process.argv.indexOf('--limit'),limit=limitIndex<0?1000:Number(process.argv[limitIndex+1])
if(!Number.isInteger(limit)||limit<1||limit>10000)throw Error('Limit must be 1..10000')
type Row=Record<string,any>
const names=['first-reviewed-admission.json',...fs.readdirSync(dir).filter(n=>/^additional-reviewed-.*\.json$/.test(n))]
const ids=[...new Set(names.flatMap(n=>(JSON.parse(fs.readFileSync(dir+n,'utf8')).records||[]).map((r:Row)=>r.jobId).filter(Boolean)))] as string[]
async function paged(table:string,q:Record<string,string>):Promise<Row[]>{
 const out:Row[]=[]
 for(let offset=0;offset<10000;offset+=500){const rows=await db(table,{...q,order:'id.asc',limit:'500',offset:String(offset)});out.push(...rows);if(rows.length<500)return out}
 throw Error('Context pagination incomplete: '+table)
}
async function context(parentId:string,mailboxSync?:FollowupContext['mailboxSync']):Promise<FollowupContext>{
 const [parent]=await db('sequence_jobs',{id:'eq.'+parentId})
 if(!parent)throw Error('Parent missing')
 const [dispatch]=await db('prepared_email_dispatches',{job_id:'eq.'+parentId})
 const [contact]=await db('market_contacts',{id:'eq.'+parent.contact_id})
 if(!contact)throw Error('Contact missing')
 const [events,touches,jobs]=await Promise.all([
  dispatch?.message_id?paged('email_provider_events',{provider_message_id:'eq.'+dispatch.message_id}):Promise.resolve([]),
  paged('market_touches',{contact_id:'eq.'+contact.id}),paged('sequence_jobs',{contact_id:'eq.'+contact.id}),
 ])
 return {parent,dispatch:dispatch||{},contact,events,touches,jobs,complete:true,checkedAt:new Date().toISOString(),mailboxSync}
}
const report:Row={startedAt:new Date().toISOString(),policy:DAY3_FOLLOWUP_POLICY,mode:send?'dispatch':apply?'enrollment':'read_only_plan',records:[],sent:0,limitations:['Followups do not count toward 3,000 unique delivered recipients.','Same subject and real MIME headers request threading; recipient mail clients control presentation.','Planning is not send authorization: fresh mailbox, CRM, canonical reservation and sender checks are required at dispatch.']}
function save(){fs.writeFileSync(dir+'day3-followup-plan.json.tmp',JSON.stringify({...report,updatedAt:new Date().toISOString()},null,2));fs.renameSync(dir+'day3-followup-plan.json.tmp',dir+'day3-followup-plan.json')}
if(!send){
 for(const id of ids.slice(0,limit)){
  const c=await context(id),plan=planDay3Followup(c)
  const row:Row={parentJobId:id,contactId:c.contact.id,company:c.contact.company,...plan}
  if(apply&&plan.payload){
   const [existing]=await db('pilot_email_followups',{parent_job_id:'eq.'+id})
   if(existing){if(existing.payload.contentHash!==plan.payload.contentHash)throw Error('Immutable followup plan changed: '+id);row.enrollment='already_enrolled';row.executionState=existing.state}
   else {await db('pilot_email_followups',{},'POST',{parent_job_id:id,contact_id:c.contact.id,action_key:plan.payload.actionKey,payload:plan.payload,due_at:plan.dueAt,state:'scheduled'});row.enrollment='enrolled'}
  }
  report.records.push(row);save()
 }
}else{
 process.loadEnvFile('.env.ses.local')
 const {syncPartnershipZohoReplies}=await import('../lib/server/partnership-zoho-sync')
 // Use the deployed release's canonical transport: it owns global pacing,
 // final-copy verification, provider suppression and durable send receipts.
 const release='/private/tmp/ssm-prepared-email-release-20261027/reputation-engine/'
 const {sendOutreachEmail}=await import(release+'lib/server/email-provider.ts')
 const {reserveAction}=await import(release+'lib/partnership-core/reserve.mjs')
 const {refreshEmailInfrastructure}=await import(release+'lib/server/email-infrastructure.ts')
 async function transport(p:Row){
  let [domain]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'})
  if(!domain?.health?.ready||Date.now()-Date.parse(domain.checked_at)>300000){await refreshEmailInfrastructure();[domain]=await db('crm_email_domains',{domain:'eq.saturnstarmovers.ca'})}
  if(!domain?.health?.ready||!['warming','active'].includes(domain.status))throw Error('Sender health not ready')
  const delay=Date.parse(domain.next_send_at||'')-Date.now();if(delay>0)await new Promise(r=>setTimeout(r,Math.min(delay+30,60000)))
  return sendOutreachEmail(p)
 }
 let mailboxSync:FollowupContext['mailboxSync']
 async function freshSync(){
  if(mailboxSync&&Date.now()-Date.parse(mailboxSync.checkedAt)<240000)return
  const result=await syncPartnershipZohoReplies('saturn')
  if(!result.ok||!result.completed||result.partial||result.unresolved)throw Error('Complete unambiguous mailbox synchronization required before followups')
  mailboxSync={complete:true,checkedAt:new Date().toISOString()}
 }
 const due=await db('pilot_email_followups',{state:'eq.scheduled',due_at:'lte.'+new Date().toISOString(),order:'due_at.asc,parent_job_id.asc',limit:String(limit)})
 for(const row of due){
  // Do not import another campaign or recursively follow up a followup.
  if(!ids.includes(row.parent_job_id))throw Error('Followup outside reviewed pilot')
  const p=row.payload
  if(p.market!=='saturn'){report.records.push({parentJobId:row.parent_job_id,state:'held',reason:'Ottawa exact-name adapter not enabled'});continue}
  await freshSync()
  const result=await executeDay3Followup(p,{
   loadContext:()=>context(row.parent_job_id,mailboxSync),
   claim:()=>db('rpc/claim_pilot_day3_followup',{},'POST',{p_parent_job_id:row.parent_job_id,p_content_hash:p.contentHash,p_review:{complete:true,mailbox_complete:mailboxSync!.complete,checked_at:new Date().toISOString(),mailbox_checked_at:mailboxSync!.checkedAt,content_hash:p.contentHash}}),
   reserve:()=>reserveAction({url:base,headers,contactId:p.contactId,channel:'email',kind:'cold_introduction',key:p.actionKey,content:p.text,sender:p.sender,emailProvider:'ses'}),
   send:transport,
   saveOutcome:async(state,details)=>{
    const updated=await db('pilot_email_followups',{parent_job_id:'eq.'+row.parent_job_id,state:'eq.dispatching'},'PATCH',{state,error:details.error||null,...(state==='accepted'?{provider:details.provider,message_id:details.messageId,accepted_at:details.acceptedAt}:{})})
    if(updated.length!==1)throw Error('Followup receipt save failed; reconcile without resend')
    if(state==='accepted'){
     const h=createHash('sha256').update(p.actionKey).digest('hex'),id=`${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`
     await db('market_touches',{},'POST',{id,contact_id:p.contactId,channel:'email',direction:'outbound',notes:p.text,created_at:details.acceptedAt,created_by:'Day-three email sequence',metadata:{subject:p.subject,provider:details.provider,provider_message_id:details.messageId,delivery_state:'accepted',sequence_step:2,parent_job_id:p.parentJobId,in_reply_to:p.internetMessageId,content_hash:p.contentHash}})
     await db('market_contacts',{id:'eq.'+p.contactId},'PATCH',{email_last_sent_at:details.acceptedAt,last_touch_at:details.acceptedAt,email_provider:details.provider,email_provider_message_id:details.messageId})
    }
   },
  })
  report.records.push({parentJobId:row.parent_job_id,...result});if(result.state==='accepted')report.sent++;save()
 }
}
report.counts={selected:report.records.length,scheduled:report.records.filter((r:Row)=>r.status==='scheduled').length,due:report.records.filter((r:Row)=>r.status==='due').length,held:report.records.filter((r:Row)=>r.status==='held'||r.state==='held').length,sent:report.sent}
save();console.log(JSON.stringify({mode:report.mode,counts:report.counts,output:dir+'day3-followup-plan.json'}))
