import {randomUUID} from 'node:crypto'
import {readEnv,requireSupabaseEnv} from './runtime'

// These are conservative rollout gates, not provider promises of delivery.
export function assessGoogleWarmup(row:any,health:any,score:any) {
 const reasons:string[]=[]
 if(row?.status_code!=='active'||row?.ramp_up!=='active')reasons.push('Warm-up is not active')
 if(!Number.isFinite(score?.health_score)||score.health_score<80)reasons.push('Health score missing or below 80')
 if(!Number.isFinite(row?.spam_rate_in_last_14_days)||row.spam_rate_in_last_14_days<0||row.spam_rate_in_last_14_days>5)reasons.push('Warm-up spam placement missing or above 5%')
 if(!Number.isFinite(health?.warmup_duration_days)||health.warmup_duration_days<28)reasons.push('Fewer than 28 active warm-up days')
 if(['spf','dmarc','mx'].some(k=>health?.[k]!=='valid'))reasons.push('DNS checks incomplete or invalid')
 return reasons
}
async function mailivery(path:string,method='GET') {
 const key=readEnv('MAILIVERY_API_KEY');if(!key)throw Error('Mailivery unavailable')
 const r=await fetch('https://app.mailivery.io/api/v1'+path,{method,headers:{Authorization:'Bearer '+key,Accept:'application/json','X-Request-ID':randomUUID()},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
 if(!r.ok)throw Error('Mailivery unavailable');const j=await r.json();return j.data??j
}
/** Provider responses can contain credentials. Persist only explicitly selected metrics. */
export async function refreshGoogleHealth(email:string,placement:{status:string;reports:any[]}={status:'unavailable',reports:[]}) {
 let reasons:string[]=[],snapshot:Record<string,any>={}
 try{
  const list=await mailivery('/campaigns?per_page=100'),rows=Array.isArray(list)?list:list.data
  if(!Array.isArray(rows)||rows.length>=100)throw Error('Incomplete Mailivery inventory')
  const matches=rows.filter((r:any)=>r.email===email);if(matches.length!==1)throw Error('Mailbox inventory mismatch')
  const row=matches[0]
  const [health,score]=await Promise.all([mailivery(`/campaigns/${row.id}/get-health-score`,'PATCH'),mailivery(`/campaigns/${row.id}/get-health-score-points`,'PATCH')])
  reasons=assessGoogleWarmup(row,health,score)
  snapshot={provider:'mailivery',status:row.status_code,dailyLimit:row.email_per_day,spamPercent:row.spam_rate_in_last_14_days,score:score.health_score,activeDays:health.warmup_duration_days,spf:health.spf,dmarc:health.dmarc,mx:health.mx}
 }catch{reasons.push('Mailivery evidence unavailable or incomplete')}
 // Independent placement/authentication acceptance is deliberately not inferred from warm-up scores.
 const domain=email.split('@')[1]
 const domainReports=placement.reports.flatMap(r=>r.domains.filter((d:any)=>d.domain===domain).map((d:any)=>({week:r.week,status:r.status,...d})))
 snapshot.placement={status:placement.status,domainReports}
 if(!domainReports.length)reasons.push('ScaledMail placement report not available for this domain')
 reasons.push('Independent placement and launch acceptance still required')
 const {url,headers}=requireSupabaseEnv()
 const saved=await fetch(url+'/rest/v1/google_mail_health?on_conflict=email',{method:'POST',headers:{...headers,Prefer:'resolution=merge-duplicates'},body:JSON.stringify({email,ready:false,checked_at:new Date().toISOString(),reasons,snapshot}),signal:AbortSignal.timeout(10000)})
 if(!saved.ok)throw Error('Health persistence failed')
 return {email,ready:false,reasons}
}
