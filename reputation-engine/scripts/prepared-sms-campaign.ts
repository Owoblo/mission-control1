import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { preparedManifestRows } from '../lib/server/prepared-sms-manifest'
import { enqueuePreparedSms, type CrmRow } from '../lib/server/prepared-sms'
import { readCompleteRest } from '../lib/server/read-complete-rest'
import { readEnv, requireSupabaseEnv } from '../lib/server/runtime'

async function main() {
  const dir = 'deliverables/grome-send-preparation-20260921'
  const manifest = JSON.parse(fs.readFileSync(dir+'/manifest.json','utf8'))
  const rows = preparedManifestRows(manifest.rows)
  const campaignKey = 'grome-20260921-'+createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0,24)
  const execute = process.argv.includes('--execute')
  const approved = process.argv.includes('--approved')
  // Both controls are required, even before an HTTP request. Default operation is local dry-run.
  if (execute && (!approved || readEnv('PREPARED_SMS_EXECUTION_ENABLED') !== 'true')) throw Error('Execution disabled: approval and execution switch required')
  const freshSnapshot = 'deliverables/sms-pipeline-repair-20260921/read-only-snapshot.json'
  let snapshot = JSON.parse(fs.readFileSync(fs.existsSync(freshSnapshot) ? freshSnapshot : dir+'/crm-snapshot.json','utf8'))
  snapshot.jobs ||= []
  if (process.argv.includes('--refresh')) {
    const db=requireSupabaseEnv()
    const [contacts,touches,jobs] = await Promise.all([
      readCompleteRest<CrmRow>(db.url+'/rest/v1/market_contacts?select=*',db.headers),
      readCompleteRest<CrmRow>(db.url+'/rest/v1/market_touches?select=id,contact_id,direction&direction=eq.outbound',db.headers),
      readCompleteRest<CrmRow>(db.url+'/rest/v1/sequence_jobs?select=*',db.headers),
    ])
    snapshot={checkedAt:new Date().toISOString(),contacts,touches,jobs}
    fs.writeFileSync('deliverables/sms-pipeline-repair-20260921/read-only-snapshot.json',JSON.stringify(snapshot))
  }
  const requestBody={name:'Grome reviewed SMS September 21',campaign_key:campaignKey,prepared_rows:rows,daily_cap:1000,dry_run:!execute,approved}
  let result
  if (execute) {
    const secret=readEnv('WORKER_SHARED_SECRET'),base=readEnv('NEXT_PUBLIC_APP_URL')
    if(!secret||!base)throw Error('Missing campaign API authentication/configuration')
    const r=await fetch(base.replace(/\/$/,'')+'/api/marketing/sms/campaigns',{method:'POST',headers:{'Content-Type':'application/json','x-internal-secret':secret},body:JSON.stringify(requestBody)})
    if(!r.ok)throw Error('Campaign API failed: '+r.status)
    result=await r.json()
  } else result=await enqueuePreparedSms({campaignKey,name:requestBody.name,rows,snapshot,dailyCap:1000},{url:'https://disabled.invalid',headers:{}})
  const reasons:Record<string,number>={}
  for(const r of result.blocked)for(const reason of r.reasons)reasons[reason]=(reasons[reason]||0)+1
  const summary={at:new Date().toISOString(),snapshotAt:snapshot.checkedAt,prepared:rows.length,sendReady:result.send_ready,wouldQueue:result.would_queue,alreadyQueued:result.already_queued,blocked:result.blocked.length,blockedCategories:reasons,providerChecks:'Reservation policy and provider health rechecked by worker; no delivery prediction',externalExecutionEnabled:execute,queuedThisRun:execute?result.scheduled:0,messagesSentThisRun:0}
  fs.writeFileSync('deliverables/sms-pipeline-repair-20260921/dry-run.json',JSON.stringify({summary,result,requestBody},null,2))
  console.log(JSON.stringify(summary,null,2))
}
(process.argv.includes('--artifact') || process.argv.includes('--drafts') ? import('./promote-research-sms') : main()).catch(e=>{console.error(e.message);process.exitCode=1})
