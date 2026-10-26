import { getRequestSessionUser } from '@/lib/server/request-session'
import { canHandleLeadCommunications } from '@/lib/server/sales-permissions'
import { getSalesLead, listFollowUpLogsForLead } from '@/lib/server/sales-repository'
import { recordLeadAttention } from '@/lib/server/lead-attention'
import { requireSupabaseEnv } from '@/lib/server/runtime'

async function read(table: string, query: Record<string,string>) {
  const {url,headers}=requireSupabaseEnv()
  const response=await fetch(`${url}/rest/v1/${table}?${new URLSearchParams(query)}`,{headers,cache:'no-store'})
  if(!response.ok)throw Error('Follow-up evidence is temporarily unavailable')
  return response.json() as Promise<Array<Record<string,any>>>
}
export async function POST(request:Request,props:{params:Promise<{id:string}>}) {
  const session=await getRequestSessionUser(request)
  if(!session)return Response.json({error:'Unauthorized'},{status:401})
  const {id}=await props.params,lead=await getSalesLead(id)
  if(!lead||!canHandleLeadCommunications(session,lead))return Response.json({error:'Not found'},{status:404})
  try{await recordLeadAttention({leadId:id,action:'lead_detail_displayed',activityAt:lead.lastInboundAt||lead.createdAt},session);return Response.json({ok:true})}
  catch{return Response.json({error:'Display evidence could not be saved'},{status:503})}
}
export async function GET(request:Request,props:{params:Promise<{id:string}>}) {
  const session=await getRequestSessionUser(request)
  if(!session)return Response.json({error:'Unauthorized'},{status:401})
  if(session.role!=='owner')return Response.json({error:'Owner access required'},{status:403})
  try{
    const {id}=await props.params,lead=await getSalesLead(id)
    if(!lead)return Response.json({error:'Not found'},{status:404})
    const [intake,logs]=await Promise.all([read('inbound_leads',lead.inboundId?{id:`eq.${lead.inboundId}`,select:'id,created_at,raw_data'}:{'raw_data->>linkedLeadId':`eq.${id}`,select:'id,created_at,raw_data'}),listFollowUpLogsForLead(id)])
    const keys=[...intake.map(i=>`inbound:${i.id}`),...logs.filter(l=>l.notes?.startsWith('[SYSTEM ALERT]')).map(l=>`alert:${l.id}`),...(lead.phone?[`sms:${lead.phone}`]:[])]
    const events=await read('analytics_events',{select:'id,event_type,rep_id,ts,properties',or:`(lead_id.eq.${id}${keys.length?`,properties->>dedupeKey.in.(${keys.join(',')})`:''}${intake.map(i=>`,properties->>inboundId.eq.${i.id}`).join('')})`,order:'ts.asc',limit:'1000'})
    const alertKeys=intake.flatMap(i=>[`website-intake:${i.raw_data?.inquiry_id||i.id}`])
    const alerts=alertKeys.length?await read('crm_alert_outbox',{event_key:`in.(${alertKeys.join(',')})`,select:'event_key,payload,state,created_at,updated_at,provider_message_id,last_error'}):[]
    const providerIds=alerts.map(a=>a.provider_message_id).filter(Boolean)
    const deliveries=providerIds.length?await read('email_provider_events',{provider_message_id:`in.(${providerIds.join(',')})`,select:'provider_message_id,event_type,recipient_email,occurred_at',order:'occurred_at.asc',limit:'500'}):[]
    const receipts=events.filter(e=>['notification_displayed','notification_disposition','lead_attention'].includes(e.event_type)).map(e=>({id:e.id,at:e.ts,actorId:e.rep_id,actor:e.properties?.userName||e.rep_id,action:e.properties?.action,channel:e.properties?.channel,surface:e.properties?.surface,evidenceSource:e.properties?.evidenceSource||'authenticated_server_action',notificationPermission:e.properties?.notificationPermission,audioState:e.properties?.audioState}))
    const calls=(lead.callLogs||[]).filter(c=>c.repId||c.repName).map(c=>({at:c.date,actor:c.repName||c.repId,channel:'call',outcome:c.callOutcome||null,recordingAvailable:!!(c.recordingSid||c.recordingUrl),duration:c.duration}))
    const messages=events.filter(e=>e.rep_id&&['sms_sent','email_sent'].includes(e.event_type)&&e.properties?.automation_actor!=='automation').map(e=>({at:e.ts,actor:e.properties?.actor_name||e.rep_id,channel:e.event_type==='sms_sent'?'sms':'email',outcome:'submitted'}))
    return Response.json({leadId:id,createdAt:intake[0]?.created_at||lead.createdAt,assignedTo:lead.assignedRepName||lead.assignedRep||null,alerts:alerts.map(a=>({recipient:a.payload?.to,state:a.state,queuedAt:a.created_at,error:a.last_error,events:deliveries.filter(d=>d.provider_message_id===a.provider_message_id)})),receipts,humanContact:[...calls,...messages].sort((a,b)=>a.at.localeCompare(b.at)),limits:['Browser display records do not prove someone read the content.','Shared mailbox clicks cannot identify a particular person.','Earlier displays and activity outside the CRM cannot be reconstructed.','Display logging requires an updated CRM session.',...(events.length===1000?['History reached the 1,000-event limit; earlier/later events may require a separate audit.']:[])]},{headers:{'Cache-Control':'private, no-store'}})
  }catch{return Response.json({error:'Follow-up evidence is temporarily unavailable'},{status:503})}
}
