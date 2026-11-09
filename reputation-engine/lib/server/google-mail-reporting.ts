import {readEnv} from './runtime'
/** Weekly seed results are separate from warm-up metrics and real recipient delivery. */
export async function readGooglePlacementReports() {
 const key=readEnv('SCALEDMAIL_API_KEY'),org=readEnv('SCALEDMAIL_ORGANIZATION_ID')
 if(!key||!org)return {status:'unavailable',reports:[] as any[]}
 try{
  const r=await fetch('https://server.scaledmail.com/api/v1/reporting?'+new URLSearchParams({organization_id:org}),{headers:{Authorization:'Bearer '+key,Accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
  if(!r.ok)throw Error('Reporting unavailable');const data=await r.json()
  if(!Array.isArray(data.reports))throw Error('Invalid reporting response')
  const reports=data.reports.slice(0,100).map((report:any)=>({week:report.weekof,status:report.status,domains:(report.domains||[]).map((d:any)=>({domain:d.domain_name,inboxScore:typeof d.stats?.overall_score==='number'?d.stats.overall_score:null,reputation:d.stats?.domain_reputation??null,blacklisted:Array.isArray(d.stats?.blacklisted)?d.stats.blacklisted:[]}))}))
  return {status:reports.length?'available':'awaiting_first_report',reports}
 }catch{return {status:'unavailable',reports:[] as any[]}}
}
