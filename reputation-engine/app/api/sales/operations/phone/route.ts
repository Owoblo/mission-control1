import { operationsDb, operationsSession, saveOperationsEvent } from '@/lib/server/operations-phone'
import { operationsPhone, type OperationsContact } from '@/lib/operations-phone'
import { listSubcontractors } from '@/lib/server/subcontractors'
export async function GET(request:Request) {
  if (!await operationsSession(request)) return Response.json({error:'Forbidden'},{status:403})
  try {
    const params = new URL(request.url).searchParams
    if (params.has('phone')) {
      const phone = operationsPhone(params.get('phone'))
      if (!phone) return Response.json({error:'Invalid phone'},{status:400})
      const offset = Math.max(0,Math.floor(Number(params.get('offset')) || 0))
      const events = await operationsDb(`operations_phone_events?phone=eq.${encodeURIComponent(phone)}&order=created_at.desc,id.desc&limit=101&offset=${offset}`)
      return Response.json({events:events.slice(0,100),hasMore:events.length>100})
    }
    const [saved,threads,contractors] = await Promise.all([
      operationsDb('operations_phone_contacts?order=name.asc'),
      operationsDb('rpc/list_operations_phone_threads',{method:'POST',body:'{}'}),
      listSubcontractors(),
    ])
    const contacts = new Map<string,OperationsContact>()
    for (const row of contractors) {
      const phone = operationsPhone(row.phone)
      if (phone) contacts.set(phone,{phone,name:row.contactName || row.companyName,company:row.companyName,type:'subcontractor'})
    }
    for (const row of saved) contacts.set(row.phone,row)
    for (const row of threads) if (!contacts.has(row.phone)) contacts.set(row.phone,{phone:row.phone,name:'',company:'',type:'subcontractor'})
    return Response.json({contacts:[...contacts.values()],threads},{headers:{'Cache-Control':'no-store'}})
  } catch { return Response.json({error:'Unable to load Operations history. Please retry.'},{status:503}) }
}
export async function POST(request:Request) {
  const session = await operationsSession(request)
  if (!session) return Response.json({error:'Forbidden'},{status:403})
  try {
    const body = await request.json()
    const phone = operationsPhone(body.phone)
    if (!phone) return Response.json({error:'Enter a valid Canadian or US phone number.'},{status:400})
    if (body.action === 'note') {
      const text = String(body.body || '').trim().slice(0,10000)
      if (!text) return Response.json({error:'Enter a note.'},{status:400})
      await saveOperationsEvent(`note:${crypto.randomUUID()}`,phone,'note','internal',{body:text,repName:session.name || 'Staff'})
    } else {
      if (!['subcontractor','vendor'].includes(body.type)) return Response.json({error:'Choose a contact type.'},{status:400})
      await operationsDb('operations_phone_contacts?on_conflict=phone',{method:'POST',headers:{Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({phone,name:String(body.name || '').trim().slice(0,160),company:String(body.company || '').trim().slice(0,160),type:body.type,notes:String(body.notes || '').slice(0,10000),updated_at:new Date().toISOString()})})
    }
    return Response.json({ok:true})
  } catch { return Response.json({error:'Unable to save. Please retry.'},{status:503}) }
}
