import { operationsDb, operationsSession } from '@/lib/server/operations-phone'
import { getTwilioCredentials, requireSupabaseEnv } from '@/lib/server/runtime'
export async function GET(request:Request) {
  if (!await operationsSession(request)) return Response.json({error:'Forbidden'},{status:403})
  const params = new URL(request.url).searchParams
  const id=params.get('id') || '', index=Number(params.get('index'))
  if (!Number.isInteger(index) || index<0 || index>9) return Response.json({error:'Invalid attachment'},{status:400})
  const rows=await operationsDb(`operations_phone_events?id=eq.${encodeURIComponent(id)}&kind=eq.sms&limit=1`)
  const reference=rows?.[0]?.payload?.mediaUrls?.[index]
  if (typeof reference!=='string') return Response.json({error:'Attachment not found'},{status:404})
  const {url}=requireSupabaseEnv()
  if (reference.startsWith(`${url}/storage/v1/object/public/ops-media/`)) return Response.redirect(reference)
  const {accountSid,authToken}=getTwilioCredentials()
  const allowed=new RegExp(`^https://api\\.twilio\\.com/2010-04-01/Accounts/${accountSid}/Messages/(?:SM|MM)[a-f0-9]{32}/Media/ME[a-f0-9]{32}$`,'i')
  if(!allowed.test(reference)) return Response.json({error:'Unsupported attachment reference'},{status:400})
  try {
    const response=await fetch(reference,{headers:{Authorization:`Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`},signal:AbortSignal.timeout(15000)})
    if(!response.ok)throw new Error('Media unavailable')
    const type=response.headers.get('Content-Type') || 'application/octet-stream'
    const safe=['image/jpeg','image/png','image/gif','image/webp','application/pdf'].includes(type.split(';')[0])
    return new Response(response.body,{headers:{'Content-Type':type,'Content-Disposition':safe?'inline':'attachment','Cache-Control':'private, max-age=300','X-Content-Type-Options':'nosniff'}})
  }catch{return Response.json({error:'Attachment unavailable. Please retry.'},{status:502})}
}
