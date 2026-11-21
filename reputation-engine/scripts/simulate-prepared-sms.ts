// Read-only production inputs, isolated in-memory PostgreSQL writes. Never calls a live RPC or Twilio Messages POST.
import fs from 'node:fs'
import { preparedSmsDatabase } from '../tests/helpers/prepared-sms-db.mjs'
import { requireSupabaseEnv } from '../lib/server/runtime'
import { preparedManifestRows } from '../lib/server/prepared-sms-manifest'
import { enqueuePreparedSms } from '../lib/server/prepared-sms'
const dir='deliverables/sms-pipeline-repair-20260921'
async function main(){
 const context=JSON.parse(fs.readFileSync(dir+'/read-only-snapshot.json','utf8'))
 const previous=JSON.parse(fs.readFileSync(dir+'/dry-run.json','utf8'))
 const rows=preparedManifestRows(JSON.parse(fs.readFileSync(dir+'/original-manifest.json','utf8')).rows)
 const dry=await enqueuePreparedSms({campaignKey:previous.requestBody.campaign_key,name:'Local simulation',rows,snapshot:context,dailyCap:100},{url:'https://disabled.invalid',headers:{}})
 const remote=requireSupabaseEnv();const sources:Record<string,unknown[]>={}
 for(const [table,key] of [['partner_companies','id'],['partnership_account_policy','account_id'],['partnership_action_reservations','action_key'],['crm_tasks','id'],['partner_referrals','id']]){
  const all:unknown[]=[]
  for(let offset=0;;offset+=1000){const u=new URL(remote.url+'/rest/v1/'+table);u.search=new URLSearchParams({select:'*',order:key+'.asc',limit:'1000',offset:String(offset)}).toString();const r=await fetch(u,{headers:remote.headers});if(!r.ok)throw Error('Policy snapshot read failed: '+table+' '+r.status);const page=await r.json();all.push(...page);if(page.length<1000)break;if(all.length>100000)throw Error('Snapshot limit')}
  sources[table]=all
 }
 const db=await preparedSmsDatabase()
 try{
  const seed=async(table:string,records:unknown[])=>{for(let i=0;i<records.length;i+=500)await db.query(`insert into ${table} select * from jsonb_populate_recordset(null::${table},$1::jsonb)`,[JSON.stringify(records.slice(i,i+500))])}
  await seed('partner_companies',sources.partner_companies)
  await db.exec('alter table market_contacts disable trigger market_contacts_link_partner_company')
  await seed('market_contacts',context.contacts)
  await db.exec('alter table market_contacts enable trigger market_contacts_link_partner_company')
  await seed('market_touches',context.touches)
  for(const table of ['partnership_account_policy','partnership_action_reservations','crm_tasks','partner_referrals'])await seed(table,sources[table])
  const queued=await db.query("select enqueue_prepared_sms($1,'Local simulation',$2::jsonb,100) as result",[previous.requestBody.campaign_key,JSON.stringify(dry.jobs)])
  const jobs=(await db.query('select * from sequence_jobs order by scheduled_at,id')).rows
  const results=[]
  for(const j of jobs){
   // This is a local SQL policy projection, not live provider-health evidence. All eligible geographies validated by planner.
   const result=(await db.query("select reserve_partnership_action($1,'sms','cold_introduction',$2,jsonb_build_object('observedAt',now(),'marketActive',true,'serviceAvailable',true,'channelEligible',true,'senderHealthy',true)) as decision",[j.contact_id,'sequence:'+j.id])).rows[0].decision
   results.push({phone:j.sms_payload.to,jobId:j.id,...result})
  }
  const categories:Record<string,number>={};for(const r of dry.blocked)for(const reason of r.reasons)categories[reason]=(categories[reason]||0)+1
  const policyHolds:Record<string,number>={};for(const r of results)for(const reason of r.reasons)policyHolds[reason]=(policyHolds[reason]||0)+1
  const summary={at:new Date().toISOString(),crmSnapshotAt:context.checkedAt,prepared:rows.length,sendReady:dry.send_ready,queueInsertedLocally:jobs.length,queueBlocked:dry.blocked.length,queueBlockCategories:categories,localPolicyAllowed:results.filter(r=>r.allowed).length,localPolicyHeld:results.filter(r=>!r.allowed).length,policyHoldCategories:policyHolds,providerHealth:'Not assumed live: policy projection conditional on healthy provider at execution',liveJobsCreated:0,twilioRequestsSent:0,executionEnabled:false}
  fs.writeFileSync(dir+'/simulation.json',JSON.stringify({summary,queueReceipt:queued.rows[0].result,blocked:dry.blocked,policy:results,jobs:dry.jobs},null,2));console.log(JSON.stringify(summary,null,2))
 }finally{await db.close()}
}
main().catch(e=>{console.error(e.message);process.exitCode=1})
