import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { getSessionUser } from '@/lib/server/session'
import { requireSupabaseEnv } from '@/lib/server/runtime'
import { readCompleteRest } from '@/lib/server/read-complete-rest'
import { triageRelationship } from '@/lib/relationship-development'
import { saveGeneratedTasks } from '@/lib/server/task-repository'
import type { CRMTask } from '@/lib/tasks'

type Row = Record<string, any> & { id: string }
export const dynamic = 'force-dynamic'
export const maxDuration = 300
const VERSION = 'relationship-triage-v1'
async function scan() {
  const { url, headers } = requireSupabaseEnv()
  const startedAt = new Date().toISOString()
  const read = (table: string) => readCompleteRest<Row>(`${url}/rest/v1/${table}?select=*`, headers)
  // All reads must succeed. Never turn failed/truncated evidence into an empty queue.
  const [contacts, touches, tasks, appointments, referrals, leads] = await Promise.all([
    read('market_contacts'), read('market_touches'), read('crm_tasks'), read('market_appointments'), read('partner_referrals'), read('crm_leads'),
  ])
  const group = (rows: Row[], key: (row: Row) => string) => {
    const m = new Map<string, Row[]>()
    for (const r of rows) { const k=key(r); const a=m.get(k)||[]; a.push(r); m.set(k,a) }
    return m
  }
  const tg=group(touches,r=>r.contact_id), kg=group(tasks,r=>r.related_id), ag=group(appointments,r=>r.contact_id), rg=group(referrals,r=>r.contact_id)
  const hg=group(leads.filter(r=>!r.deleted),r=>r.data?.partnerReferralContactId)
  const now=new Date().toISOString()
  const actions=contacts.flatMap(contact=>triageRelationship({contact,touches:tg.get(contact.id)||[],tasks:kg.get(contact.id)||[],appointments:ag.get(contact.id)||[],referrals:rg.get(contact.id)||[],handoffs:hg.get(contact.id)||[],now}))
    .sort((a,b)=>Number(b.overdue)-Number(a.overdue)||b.priority-a.priority||a.key.localeCompare(b.key))
  return {version:VERSION,generatedAt:now,coverage:{complete:true,transactional:false,startedAt,contacts:contacts.length,touches:touches.length},actions,contacts}
}
export async function GET(request: Request) {
  const session=await getSessionUser()
  if(session?.role!=='owner')return NextResponse.json({error:'Owner access required'},{status:403})
  const q=new URL(request.url).searchParams,offset=Number(q.get('offset')||0),limit=Number(q.get('limit')||100)
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>500)return NextResponse.json({error:'Invalid pagination'},{status:400})
  try {
    const s=await scan(),active=s.actions.filter(a=>!['suppressed','fulfilled','graph_only'].includes(a.disposition))
    return NextResponse.json({version:s.version,coverage:s.coverage,generatedAt:s.generatedAt,total:active.length,overdue:active.filter(a=>a.overdue).length,
      suppressedActions:s.actions.filter(a=>a.disposition==='suppressed').length,rows:active.slice(offset,offset+limit).map(a=>({...a,contactName:s.contacts.find(c=>c.id===a.contactId)?.name||'Partner'})),outboundSent:false},{headers:{'Cache-Control':'no-store'}})
  }catch {return NextResponse.json({error:'Triage evidence incomplete; no actions executed',coverage:{complete:false}},{status:503})}
}
export async function POST(request: Request) {
  const session=await getSessionUser()
  if(session?.role!=='owner')return NextResponse.json({error:'Owner access required'},{status:403})
  let body: {keys?:unknown}
  try{body=await request.json()}catch{return NextResponse.json({error:'Invalid JSON'},{status:400})}
  if(!Array.isArray(body.keys)||!body.keys.length||body.keys.length>100||body.keys.some(k=>typeof k!=='string'))return NextResponse.json({error:'Select 1–100 action keys'},{status:400})
  try {
    const s=await scan(),keys=new Set(body.keys)
    const chosen=s.actions.filter(a=>keys.has(a.key)&&a.disposition==='review'&&!a.taskId)
    if(chosen.length!==keys.size)return NextResponse.json({error:'Actions changed or already assigned; refresh triage'},{status:409})
    const tasks:CRMTask[]=chosen.map(a=>{const hex=createHash('sha256').update(a.key).digest('hex'),c=s.contacts.find(c=>c.id===a.contactId)
      return {id:`${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`,source:'condition',sourceKey:a.key,title:a.title,
        description:`${a.reason}\nPolicy: ${VERSION}\nEvidence: ${JSON.stringify(a.evidence)}\nInternal review only; no partner message authorized by this task.`,status:'open',priority:a.priority>=90?'urgent':'high',category:'relationship_development',
        ownerName:a.owner||'John',dueAt:a.dueAt,relatedType:'relationship',relatedId:a.contactId,relatedLabel:c?.name||c?.company,branch:c?.city,createdAt:s.generatedAt,updatedAt:s.generatedAt}
    })
    await saveGeneratedTasks(tasks)
    return NextResponse.json({ok:true,taskKeys:tasks.map(t=>t.sourceKey),outboundSent:false})
  }catch{return NextResponse.json({error:'Triage task creation failed; refresh before retry',coverage:{complete:false}},{status:503})}
}
