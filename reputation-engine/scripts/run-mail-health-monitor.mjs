import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readScaledMailHealth} from './scaledmail-health.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const dir=path.join(root,'artifacts/mail-health-monitor');fs.mkdirSync(dir,{recursive:true});
const at=new Date().toISOString();
const execution=spawnSync(process.execPath,['scripts/audit-mailivery-infrastructure.mjs'],{cwd:root,encoding:'utf8',timeout:240000,maxBuffer:4*1024*1024});
const alerts=[];let audit;
if(execution.status!==0){alerts.push({severity:'critical',issue:'Audit failed; current mailbox health is unknown',detail:execution.error?.message??'API or process failure'});}
else {
 audit=JSON.parse(fs.readFileSync(path.join(root,'artifacts/google-mail-release-20261109/infrastructure-health.json'),'utf8'));
 for(const m of audit.mailboxes){
  if(m.status!=='active')alerts.push({severity:'critical',email:m.email,issue:`Mailbox status: ${m.status}`});
  if(m.health.error||m.score.error||m.schedule.error)alerts.push({severity:'warning',email:m.email,issue:'A provider health check failed'});
  for(const k of ['spf','dmarc','mx'])if(m.health[k]&&m.health[k]!=='valid')alerts.push({severity:'critical',email:m.email,issue:`${k.toUpperCase()}: ${m.health[k]}`});
  if(Number.isFinite(m.score.health_score)&&m.score.health_score<80)alerts.push({severity:'warning',email:m.email,issue:`Mailivery health score ${m.score.health_score}/100`});
  if(Number(m.spamRateLast14Days)>5)alerts.push({severity:'warning',email:m.email,issue:`Warm-up spam placement ${m.spamRateLast14Days}% (not complaint rate)`});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto'}).format(new Date());
  const missing=m.metrics?.[today]?.['Warm Up']?.['Landed In']?.['*FAILED_TO_READ*'];
  if(missing>0)alerts.push({severity:'info',email:m.email,issue:`${missing} outbound warm-up placements unconfirmed today`});
 }
 const monitored=Array.isArray(audit.blacklists)?audit.blacklists:[];
 for(const d of new Set(audit.mailboxes.map(m=>m.email.split('@')[1])))if(!monitored.some(m=>m.domain_ip===d))alerts.push({severity:'warning',domain:d,issue:'No Mailivery blacklist monitor'});
 for(const m of monitored){
  const c=m.classification;
  if(!c||c.status==='unknown')alerts.push({severity:'warning',domain:m.domain_ip,issue:'Blacklist details unavailable, stale or inconsistent; do not infer clean status'});
  else if(c.status==='listed')alerts.push({severity:'critical',domain:m.domain_ip,issue:`Provider-reported list detections: ${c.otherListings.join(', ')}`});
  if(c?.ageListings?.length)alerts.push({severity:'warning',domain:m.domain_ip,issue:`New-domain age listings: ${c.ageListings.join(', ')}; not evidence of abuse`});
 }
 if(audit.limits.email_per_day?.available<0)alerts.push({severity:'critical',issue:'Daily sending allocation exceeds plan'});
}
let scaledmail;
try {
 scaledmail=await readScaledMailHealth();
 if(!scaledmail.reports.length)alerts.push({severity:'warning',issue:'ScaledMail has no completed reporting results'});
 const covered=new Set();
 for(const r of [...scaledmail.reports].sort((a,b)=>String(b.week).localeCompare(String(a.week))))for(const d of r.domains){
  if(covered.has(d.domain))continue;covered.add(d.domain);
  if(d.blacklisted.length)alerts.push({severity:'critical',domain:d.domain,issue:`ScaledMail blacklist result: ${d.blacklisted.join(', ')}`});
  if(Number.isFinite(d.inboxScore)&&d.inboxScore<80)alerts.push({severity:'warning',domain:d.domain,issue:`ScaledMail inbox placement ${d.inboxScore}% for week ${r.week}`});
  if(!Number.isFinite(Date.parse(r.week))||Date.now()-Date.parse(r.week)>14*86400000)alerts.push({severity:'warning',domain:d.domain,issue:'ScaledMail report date is missing or older than 14 days'});
 }
 for(const domain of ['saturnstarpartners.com','saturnstarmoving.com','saturnstarconnect.com','moveswithsaturn.com'])if(!covered.has(domain))alerts.push({severity:'warning',domain,issue:'No completed ScaledMail report for this domain'});
}catch{scaledmail={error:'ScaledMail reporting check failed'};alerts.push({severity:'warning',issue:scaledmail.error});}
const report={checkedAt:at,source:'Mailivery and ScaledMail APIs',execution:'Local hourly audit; requires this Mac awake and user logged in',notifications:'Saved locally; no email or Slack delivery configured',alerts,audit,scaledmail};
fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(dir,at.replaceAll(':','-')+'.json'),JSON.stringify(report,null,2));
const snapshots=fs.readdirSync(dir).filter(n=>/^\d{4}-.*\.json$/.test(n)).sort();for(const n of snapshots.slice(0,Math.max(0,snapshots.length-720)))fs.unlinkSync(path.join(dir,n));
const lines=['# Mail infrastructure health',`Checked: ${at}`,'','Source: Mailivery. Runs hourly on this Mac while awake. No email/Slack notification delivery configured.','','| Mailbox | Status | DNS | Health score | Warm-up spam placement |','|---|---|---|---|---|'];
for(const m of audit?.mailboxes??[])lines.push(`| ${m.email} | ${m.status} | ${m.health.dns_grade??'Unknown'} | ${m.score.health_score??'Warming up / unavailable'} | ${Number(m.spamRateLast14Days)<0?'No data':m.spamRateLast14Days+'%'} |`);
lines.push('','## ScaledMail reporting','',scaledmail.error??`${scaledmail.total} completed reports returned. ${scaledmail.note}`,'','## Issues','',...alerts.map(a=>`- **${a.severity}** ${a.email??a.domain??''}: ${a.issue}`));fs.writeFileSync(path.join(dir,'latest.md'),lines.join('\n')+'\n');
console.log(JSON.stringify({checkedAt:at,mailboxes:audit?.mailboxes.length??0,alerts:alerts.length,status:execution.status===0?'completed':'failed'}));
if(execution.status!==0)process.exitCode=1;
