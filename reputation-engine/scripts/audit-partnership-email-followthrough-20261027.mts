import fs from 'node:fs'
import path from 'node:path'
import { db } from './gta-email-recovery-runtime.mjs'
import { auditEmailContact, humanEmailTouch } from '../lib/partnership-email-followthrough-audit'

const args=process.argv.slice(2)
function value(key:string,fallback:string){const i=args.indexOf(key);return i<0?fallback:args[i+1]}
const limit=Number(value('--limit','250')), after=value('--after',''), pageSize=250
if(!Number.isInteger(limit)||limit<1||limit>2000)throw Error('--limit must be 1..2000')
if(after&&!/^[a-f0-9-]{36}$/i.test(after))throw Error('Invalid contact cursor')
const startedAt=new Date().toISOString()
const output=path.resolve(value('--output','artifacts/partnership-pilot-3000-20261027/email-followthrough-audit.json'))
const artifactRoot=path.resolve('artifacts')+path.sep
if(!output.startsWith(artifactRoot))throw Error('Output must be in artifacts/')
type Row=Record<string,any>
async function pages(table:string,query:Record<string,string>,maxRows=20000){
 const rows:Row[]=[];let offset=0
 while(rows.length<maxRows){const batch=await db(table,{...query,limit:String(pageSize),offset:String(offset)}) as Row[];rows.push(...batch);offset+=batch.length;if(batch.length<pageSize)return{rows,complete:true,nextOffset:null}}
 return{rows,complete:false,nextOffset:offset}
}
// Stable keyset scope: existing contacts with an inbound timestamp, not the whole market.
const contacts:Row[]=[];let cursor=after,exhausted=false
while(contacts.length<limit){
 const n=Math.min(pageSize,limit-contacts.length),q:Record<string,string>={select:'id,company,city,email,last_inbound_at,do_not_contact,email_unsubscribed_at,cross_channel_suppressed_at',email:'not.is.null',last_inbound_at:'not.is.null',order:'id.asc',limit:String(n)}
 if(cursor)q.id='gt.'+cursor
 const batch=await db('market_contacts',q) as Row[];contacts.push(...batch);if(batch.length)cursor=batch.at(-1)!.id;if(batch.length<n){exhausted=true;break}
}
if(!exhausted){const more=await db('market_contacts',{select:'id',email:'not.is.null',last_inbound_at:'not.is.null',id:'gt.'+cursor,order:'id.asc',limit:'1'});exhausted=more.length===0}
const touches:Row[]=[];const touchPages:Array<Record<string,unknown>>=[]
for(let i=0;i<contacts.length;i+=40){const ids=contacts.slice(i,i+40).map(c=>c.id);const result=await pages('market_touches',{select:'id,contact_id,channel,direction,notes,created_at,outcome_code,metadata',contact_id:'in.('+ids.join(',')+')',channel:'eq.email',created_at:'lte.'+startedAt,order:'created_at.asc,id.asc'});touches.push(...result.rows);touchPages.push({contactIds:ids,complete:result.complete,nextOffset:result.nextOffset,rows:result.rows.length})}
const taskScan=await pages('crm_tasks',{select:'id,title,status,due_at,created_at,related_id,source_key,description',category:'eq.partnerships',created_at:'lte.'+startedAt,order:'created_at.asc,id.asc'},10000)
function taskMatches(t:Row,c:Row,thread:Row[]){if(t.related_id===c.id)return true;try{const d=JSON.parse(t.description||'{}');if(d.contactId===c.id||d.contact_id===c.id)return true}catch{}
 return thread.some(x=>t.source_key===`partnership-reply-review:${x.id}`||t.id===`partnership-reply-review:${x.id}`)
}
const rows=contacts.map(c=>{const thread=touches.filter(t=>t.contact_id===c.id);return auditEmailContact(c,thread,taskScan.rows.filter(t=>taskMatches(t,c,thread)))}).filter(Boolean)
const report={generatedAt:new Date().toISOString(),readOnly:true,scope:{startedAt,contactsSelected:contacts.length,contactLimit:limit,after:after||null,nextContactCursor:exhausted?null:cursor,contactSubsetExhausted:exhausted,filter:'market_contacts.email not null and last_inbound_at not null; contacts ordered by id',touchPagination:touchPages,taskPagination:{rows:taskScan.rows.length,complete:taskScan.complete,nextOffset:taskScan.nextOffset},limitations:['CRM market_touches only; unsynced mailbox messages and standalone crm_emails records are not covered.','Contacts with no last_inbound_at are outside this scope.','Read-only queries are not a database snapshot; concurrent writes can affect pagination.','Explicit fulfilment receipts are surfaced for review, not independently certified.']},counts:{contactsWithHumanEmail:rows.length,humanInboundTouches:touches.filter(humanEmailTouch).length,excludedNonhumanOrNonInboundTouches:touches.filter(t=>!humanEmailTouch(t)).length,unansweredHumanReplyCandidates:rows.filter(r=>r!.unansweredHumanReplyCandidate).length,answeredWithStaleOpenReviewCandidates:rows.filter(r=>r!.answeredWithPotentiallyStaleOpenReviewTasks.length).length,pendingFulfilmentReviews:rows.filter(r=>r!.pendingFulfilmentReview).length,explicitFulfilmentReceipts:rows.filter(r=>r!.explicitFulfilmentReceipt).length,suppressed:rows.filter(r=>r!.suppressed).length},records:rows}
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output+'.tmp',JSON.stringify(report,null,2));fs.renameSync(output+'.tmp',output)
console.log(JSON.stringify({output,counts:report.counts,scope:{contacts:contacts.length,contactSubsetExhausted:exhausted,nextContactCursor:report.scope.nextContactCursor,touchesComplete:touchPages.every(p=>p.complete),tasksComplete:taskScan.complete}}))
