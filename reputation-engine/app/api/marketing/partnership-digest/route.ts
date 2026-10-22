import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/server/cron-auth'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { getSessionUser } from '@/lib/server/session'
import { dailyBriefWindow, renderDailyBrief, type BriefRow } from '@/lib/partnership-daily-brief'
import { isOttawa } from '@/lib/partnership-core/ottawa.mjs'
import { openZohoMailbox } from '@/lib/partnership-core/zoho.mjs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
export async function GET(request: Request) {
  const preview = new URL(request.url).searchParams.get('preview') === '1'
  const cron = isAuthorizedCronRequest(request)
  if (!cron && (!preview || (await getSessionUser())?.role !== 'owner')) return NextResponse.json({error:'Unauthorized'},{status:401})
  const window = dailyBriefWindow()
  if (!preview && !window.due) return NextResponse.json({ok:true,skipped:'outside_8am_Toronto'})
  const {url,headers} = requireSupabaseEnv()
  async function all(table:string, query:Record<string,string>) {
    const rows:BriefRow[]=[]
    for(let offset=0;offset<50000;offset+=1000){
      const r=await fetch(`${url}/rest/v1/${table}?${new URLSearchParams({...query,order:query.order||'id.asc',limit:'1000',offset:String(offset)})}`,{headers,cache:'no-store'})
      if(!r.ok)throw Error(`Brief ${table} read failed (${r.status})`)
      const page=await r.json();rows.push(...page);if(page.length<1000)return rows
    }
    throw Error('Brief pagination limit reached; refusing incomplete summary')
  }
  try {
    const key=`ottawa:${window.day}`
    if(!preview){const prior=await all('partnership_daily_briefs',{id:'eq.'+key,select:'id,state'});if(prior.length)return NextResponse.json({ok:prior[0].state==='accepted',skipped:'existing_reservation',state:prior[0].state},{status:prior[0].state==='accepted'?200:409})}
    const contacts=(await all('market_contacts',{select:'id,name,company,city'})).filter(c=>isOttawa(c.city))
    const scoped={touches:[] as BriefRow[],tasks:[] as BriefRow[],appointments:[] as BriefRow[],jobs:[] as BriefRow[]}
    for(let i=0;i<contacts.length;i+=100){
      const ids='in.('+contacts.slice(i,i+100).map(c=>c.id).join(',')+')'
      const [touches,tasks,appointments,jobs]=await Promise.all([
        all('market_touches',{contact_id:ids,created_at:'gte.'+window.from,and:`(created_at.lt.${window.until})`,select:'id,contact_id,direction,channel,notes,metadata,outcome_code,created_at'}),
        all('crm_tasks',{related_id:ids,status:'in.(open,in_progress)',select:'id,related_id,title,description,status,due_at',order:'due_at.asc.nullslast,id.asc'}),
        all('market_appointments',{contact_id:ids,scheduled_at:'gte.'+window.until,status:'not.in.(cancelled,completed,no_show)',select:'*',order:'scheduled_at.asc,id.asc'}),
        all('sequence_jobs',{contact_id:ids,status:'eq.pending',select:'id,contact_id,channel,scheduled_at,status',order:'scheduled_at.asc,id.asc'})
      ])
      scoped.touches.push(...touches);scoped.tasks.push(...tasks);scoped.appointments.push(...appointments);scoped.jobs.push(...jobs)
    }
    const brief=renderDailyBrief({...window,contacts,...scoped})
    if(preview)return NextResponse.json({...brief,window,recipient:'hello@dexamovers.ca'},{headers:{'Cache-Control':'no-store'}})
    // Check mailbox health before taking an at-most-once send reservation.
    const mailbox=await openZohoMailbox('ottawa')
    const claim=await fetch(`${url}/rest/v1/partnership_daily_briefs?on_conflict=id`,{method:'POST',headers:{...headers,Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:key,market:'ottawa',report_date:window.day,recipient:'hello@dexamovers.ca',state:'reserved',subject:brief.subject,body:brief.text,counts:brief.counts})})
    if(!claim.ok)throw Error('Daily brief reservation failed')
    if(!(await claim.json()).length)return NextResponse.json({ok:true,skipped:'concurrent_reservation'})
    const result=await mailbox.request(`/accounts/${encodeURIComponent(mailbox.accountId)}/messages`,{fromAddress:mailbox.mailbox,toAddress:'hello@dexamovers.ca',subject:brief.subject,content:brief.text,mailFormat:'plaintext',encoding:'UTF-8',askReceipt:'no'})
    if(!result?.messageId)throw Error('Uncertain brief send; inspect reservation before retry')
    const saved=await fetch(`${url}/rest/v1/partnership_daily_briefs?id=eq.${encodeURIComponent(key)}`,{method:'PATCH',headers,body:JSON.stringify({state:'accepted',provider_message_id:String(result.messageId),accepted_at:new Date().toISOString()})})
    if(!saved.ok)throw Error('Brief accepted but receipt persistence failed; do not resend')
    return NextResponse.json({ok:true,state:'accepted',counts:brief.counts})
  }catch(error){console.error('Partnership daily brief:',error);return NextResponse.json({error:error instanceof Error?error.message:'Daily brief failed'},{status:500})}
}
